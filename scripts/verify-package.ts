import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const packageName = 'multi-agent-browser-mcp';
const npmCliPath = process.env.npm_execpath;
if (npmCliPath === undefined) {
  throw new Error('verify-package must be launched through npm so npm_execpath is available');
}
const npmCli = npmCliPath;

const packSchema = z.array(
  z.object({
    filename: z.string(),
    files: z.array(z.object({ path: z.string() })),
  }),
);
const mcpEnvelopeSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    operationId: z.string().min(1),
    sessionId: z.string().min(1),
    pageId: z.string().min(1),
  }),
});
const installedManifestSchema = z.object({
  name: z.literal(packageName),
  version: z.string().min(1),
  type: z.literal('module'),
  license: z.literal('Apache-2.0'),
  main: z.never().optional(),
  bin: z.object({ browsermesh: z.literal('dist/cli.js') }),
  exports: z.object({
    '.': z.object({ import: z.literal('./dist/index.js'), types: z.literal('./dist/index.d.ts') }),
  }),
  publishConfig: z.object({
    access: z.literal('public'),
    registry: z.literal('https://registry.npmjs.org/'),
  }),
});

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'browsermesh-package-'));
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  try {
    const packOutput = await execFileAsync(
      process.execPath,
      [npmCli, 'pack', '--json', '--pack-destination', temporaryRoot],
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
    );
    const packed = packSchema.parse(JSON.parse(packOutput.stdout));
    const artifact = packed[0];
    if (artifact === undefined) throw new Error('npm pack did not produce an artifact');
    const paths = new Set(artifact.files.map(({ path }) => path));
    for (const required of [
      'dist/cli.js',
      'dist/index.js',
      'dist/index.d.ts',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'NOTICE',
    ]) {
      if (!paths.has(required)) throw new Error(`Packed artifact is missing ${required}`);
    }
    if ([...paths].some((path) => path.startsWith('src/') || path.startsWith('tests/'))) {
      throw new Error('Packed artifact unexpectedly contains source or test files');
    }

    const consumerDirectory = join(temporaryRoot, 'consumer');
    await mkdir(consumerDirectory);
    await writeFile(
      join(consumerDirectory, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
      'utf8',
    );
    const archivePath = resolve(temporaryRoot, artifact.filename);
    await execFileAsync(process.execPath, [npmCli, 'install', '--ignore-scripts', archivePath], {
      cwd: consumerDirectory,
      maxBuffer: 10 * 1024 * 1024,
    });

    await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import('${packageName}').then((module) => { if (typeof module.createRuntime !== 'function') process.exit(1); })`,
      ],
      { cwd: consumerDirectory },
    );

    const installedRoot = join(consumerDirectory, 'node_modules', packageName);
    installedManifestSchema.parse(
      JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8')),
    );
    const binPath = join(
      consumerDirectory,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'browsermesh.cmd' : 'browsermesh',
    );
    const installedCliPath = join(installedRoot, 'dist', 'cli.js');
    await assertInstalledBin(binPath, installedCliPath);
    transport = new StdioClientTransport({
      command: process.platform === 'win32' ? process.execPath : binPath,
      ...(process.platform === 'win32' ? { args: [installedCliPath] } : {}),
      cwd: consumerDirectory,
      env: {
        ...getDefaultEnvironment(),
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_DATA_DIR: join(consumerDirectory, '.browsermesh'),
      },
      stderr: 'pipe',
    });
    client = new Client({ name: 'browsermesh-package-verifier', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    if (!tools.tools.some(({ name }) => name === 'browser_session_create')) {
      throw new Error('Packaged MCP server did not expose browser_session_create');
    }
    const created = await client.callTool({
      name: 'browser_session_create',
      arguments: { name: 'package-smoke' },
    });
    const createdIds = readSuccessfulTextResult(created);
    const url = await client.callTool({
      name: 'browser_get_url',
      arguments: { sessionId: createdIds.sessionId, pageId: createdIds.pageId },
    });
    if (url.isError === true || !JSON.stringify(url).includes('about:blank')) {
      throw new Error('Packaged MCP browser URL smoke call failed');
    }
    const closed = await client.callTool({
      name: 'browser_session_close',
      arguments: { sessionId: createdIds.sessionId },
    });
    if (closed.isError === true) throw new Error('Packaged MCP session close failed');
  } finally {
    await client?.close();
    await transport?.close();
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

async function assertInstalledBin(binPath: string, installedCliPath: string): Promise<void> {
  const cli = await readFile(installedCliPath, 'utf8');
  if (!cli.startsWith('#!/usr/bin/env node')) {
    throw new Error('Packaged CLI is missing its Node.js executable shebang');
  }

  if (process.platform === 'win32') {
    const launcher = await readFile(binPath, 'utf8');
    if (!launcher.includes('dist') || !launcher.includes('cli.js')) {
      throw new Error('Installed browsermesh bin does not target the packaged CLI');
    }
    return;
  }

  await access(binPath, constants.X_OK);
}

function readSuccessfulTextResult(result: unknown): z.infer<typeof mcpEnvelopeSchema>['value'] {
  const parsed = z
    .object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
    .parse(result);
  const text = parsed.content.find((block) => block.type === 'text')?.text;
  if (text === undefined) throw new Error('MCP result did not contain text content');
  return mcpEnvelopeSchema.parse(JSON.parse(text)).value;
}

await main();
