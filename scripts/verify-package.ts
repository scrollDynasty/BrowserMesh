import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
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
const structuredResultSchema = z
  .object({
    operationId: z.string().min(1),
  })
  .catchall(z.unknown());
const doctorCheckIds = [
  'node-version',
  'version-consistency',
  'data-directory-access',
  'chromium-executable',
  'browser-smoke',
] as const;
const doctorResultSchema = z.object({
  schemaVersion: z.literal('1'),
  status: z.literal('passed'),
  checks: z.array(
    z.object({
      id: z.enum(doctorCheckIds),
      status: z.literal('passed'),
      code: z.string().min(1),
      message: z.string().max(256),
      remediation: z.null(),
    }),
  ),
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
  let webServer: PackageTestServer | undefined;
  try {
    const registryManifest = z
      .object({ version: z.string().min(1) })
      .parse(JSON.parse(await readFile(join(process.cwd(), 'server.json'), 'utf8')));
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
      'dist/install-browser.js',
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
    const installedManifest = installedManifestSchema.parse(
      JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8')),
    );
    if (installedManifest.version !== registryManifest.version) {
      throw new Error('Installed package version does not match server.json');
    }
    const binPath = join(
      consumerDirectory,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'browsermesh.cmd' : 'browsermesh',
    );
    const installedCliPath = join(installedRoot, 'dist', 'cli.js');
    await assertInstalledBin(binPath, installedCliPath);
    await execFileAsync(process.execPath, [installedCliPath, '--install-browser'], {
      cwd: consumerDirectory,
      maxBuffer: 10 * 1024 * 1024,
    });
    const doctor = await execFileAsync(process.execPath, [installedCliPath, '--doctor', '--json'], {
      cwd: consumerDirectory,
      env: {
        ...getDefaultEnvironment(),
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_DATA_DIR: join(consumerDirectory, '.browsermesh-doctor'),
      },
      timeout: 45_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const doctorResult = doctorResultSchema.parse(JSON.parse(doctor.stdout));
    if (doctorResult.checks.map(({ id }) => id).join(',') !== doctorCheckIds.join(',')) {
      throw new Error('Packaged doctor check IDs or ordering changed');
    }
    transport = new StdioClientTransport({
      command: process.platform === 'win32' ? process.execPath : binPath,
      ...(process.platform === 'win32' ? { args: [installedCliPath] } : {}),
      cwd: consumerDirectory,
      env: {
        ...getDefaultEnvironment(),
        ...(process.env.DISPLAY === undefined ? {} : { DISPLAY: process.env.DISPLAY }),
        ...(process.env.XAUTHORITY === undefined ? {} : { XAUTHORITY: process.env.XAUTHORITY }),
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_DATA_DIR: join(consumerDirectory, '.browsermesh'),
        BROWSERMESH_HEADLESS: process.env.BROWSERMESH_HEADLESS ?? 'true',
      },
      stderr: 'pipe',
    });
    client = new Client({ name: 'browsermesh-package-verifier', version: '1.0.0' });
    await client.connect(transport);
    const serverInfo = client.getServerVersion();
    if (serverInfo?.name !== 'browsermesh' || serverInfo.version !== installedManifest.version) {
      throw new Error('Packaged MCP serverInfo does not match the installed package version');
    }
    const tools = await client.listTools();
    if (!tools.tools.some(({ name }) => name === 'browser_session_create')) {
      throw new Error('Packaged MCP server did not expose browser_session_create');
    }
    if (
      tools.tools.some(
        ({ title, outputSchema }) => title === undefined || outputSchema?.type !== 'object',
      )
    ) {
      throw new Error('Packaged MCP tool discovery omitted a title or object outputSchema');
    }
    const runtimeInfo = z
      .object({ structuredContent: z.unknown(), isError: z.boolean().optional() })
      .parse(await client.callTool({ name: 'browser_runtime_info', arguments: {} }));
    if (runtimeInfo.isError === true) throw new Error('Packaged runtime info returned an error');
    const installedPlaywright = z
      .object({ version: z.string().min(1) })
      .parse(
        JSON.parse(
          await readFile(
            join(consumerDirectory, 'node_modules', 'playwright', 'package.json'),
            'utf8',
          ),
        ),
      );
    z.object({
      serverVersion: z.literal(installedManifest.version),
      nodeVersion: z.literal(process.versions.node),
      playwrightVersion: z.literal(installedPlaywright.version),
      browserProduct: z.literal('chromium'),
      browserVersion: z.null(),
      browserLaunchState: z.literal('not_started'),
      headless: z.boolean(),
      persistenceEnabled: z.boolean(),
      defaultTimeoutMs: z.number().positive(),
      maxSessions: z.number().positive(),
      maxPagesPerSession: z.number().positive(),
      activeSessions: z.literal(0),
      failedSessions: z.literal(0),
    }).parse(runtimeInfo.structuredContent);
    const created = await client.callTool({
      name: 'browser_session_create',
      arguments: { name: 'package-smoke' },
    });
    const createdIds = z
      .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
      .parse(readStructuredResult(created)).initialPage;
    webServer = await startPackageTestServer();
    readStructuredResult(
      await client.callTool({
        name: 'browser_navigate',
        arguments: {
          sessionId: createdIds.sessionId,
          pageId: createdIds.pageId,
          url: webServer.url,
        },
      }),
    );
    const snapshot = z
      .object({
        partial: z.boolean(),
        contentFormat: z.string(),
        truncation: z.object({ truncated: z.boolean() }),
        appliedBounds: z.object({ maxDepth: z.number(), includeBoundingBoxes: z.boolean() }),
      })
      .parse(
        readStructuredResult(
          await client.callTool({
            name: 'browser_snapshot',
            arguments: {
              sessionId: createdIds.sessionId,
              pageId: createdIds.pageId,
              scope: { strategy: 'role', value: 'button', name: 'Run package action' },
              maxDepth: 1,
              includeBoundingBoxes: true,
              maxChars: 4,
              maxBytes: 4,
            },
          }),
        ),
      );
    if (
      !snapshot.partial ||
      snapshot.contentFormat !== 'aria-yaml-fragment' ||
      !snapshot.truncation.truncated ||
      snapshot.appliedBounds.maxDepth !== 1 ||
      !snapshot.appliedBounds.includeBoundingBoxes
    ) {
      throw new Error('Packaged MCP bounded snapshot contract did not match its applied limits');
    }
    const elementRef = z
      .object({ refs: z.array(z.object({ ref: z.string(), tag: z.string() })).length(1) })
      .parse(
        readStructuredResult(
          await client.callTool({
            name: 'browser_snapshot',
            arguments: {
              sessionId: createdIds.sessionId,
              pageId: createdIds.pageId,
              includeRefs: true,
              maxRefs: 1,
            },
          }),
        ),
      ).refs[0]?.ref;
    if (elementRef === undefined) throw new Error('Packaged MCP snapshot omitted element ref');
    const initialStatus = readStructuredResult(
      await client.callTool({
        name: 'browser_visible_text',
        arguments: {
          sessionId: createdIds.sessionId,
          pageId: createdIds.pageId,
          locator: { strategy: 'testId', value: 'status' },
        },
      }),
    );
    if (initialStatus.text !== 'ready') {
      throw new Error('Packaged MCP browser did not read the expected DOM state');
    }
    readStructuredResult(
      await client.callTool({
        name: 'browser_hover',
        arguments: {
          sessionId: createdIds.sessionId,
          pageId: createdIds.pageId,
          ref: elementRef,
        },
      }),
    );
    const hoveredStatus = readStructuredResult(
      await client.callTool({
        name: 'browser_visible_text',
        arguments: {
          sessionId: createdIds.sessionId,
          pageId: createdIds.pageId,
          locator: { strategy: 'testId', value: 'status' },
        },
      }),
    );
    if (hoveredStatus.text !== 'hovered') {
      throw new Error('Packaged MCP typed hover did not update the DOM');
    }
    readStructuredResult(
      await client.callTool({
        name: 'browser_click',
        arguments: {
          sessionId: createdIds.sessionId,
          pageId: createdIds.pageId,
          ref: elementRef,
        },
      }),
    );
    const updatedStatus = readStructuredResult(
      await client.callTool({
        name: 'browser_visible_text',
        arguments: {
          sessionId: createdIds.sessionId,
          pageId: createdIds.pageId,
          locator: { strategy: 'testId', value: 'status' },
        },
      }),
    );
    if (updatedStatus.text !== 'clicked') {
      throw new Error('Packaged MCP browser action did not update the DOM');
    }
    const url = readStructuredResult(
      await client.callTool({
        name: 'browser_get_url',
        arguments: { sessionId: createdIds.sessionId, pageId: createdIds.pageId },
      }),
    );
    if (url.url !== webServer.url) {
      throw new Error('Packaged MCP browser URL did not match the test server');
    }
    const closed = await client.callTool({
      name: 'browser_session_close',
      arguments: { sessionId: createdIds.sessionId },
    });
    if (closed.isError === true) throw new Error('Packaged MCP session close failed');
  } finally {
    await client?.close();
    await transport?.close();
    await webServer?.close();
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

interface PackageTestServer {
  readonly url: string;
  close(): Promise<void>;
}

async function startPackageTestServer(): Promise<PackageTestServer> {
  const server: Server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(
      '<!doctype html><title>Package smoke</title><button aria-label="Run package action" onmouseenter="document.querySelector(`[data-testid=status]`).textContent=`hovered`" onclick="document.querySelector(`[data-testid=status]`).textContent=`clicked`">Run</button><div data-testid="status">ready</div>',
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Package test server did not bind to TCP');
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    async close(): Promise<void> {
      server.close();
      await once(server, 'close');
    },
  };
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

function readStructuredResult(result: unknown): z.infer<typeof structuredResultSchema> {
  const parsed = z
    .object({ structuredContent: z.unknown(), isError: z.boolean().optional() })
    .parse(result);
  if (parsed.isError === true) throw new Error('Packaged MCP tool returned an application error');
  return structuredResultSchema.parse(parsed.structuredContent);
}

await main();
