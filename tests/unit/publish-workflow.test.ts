import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BROWSERMESH_VERSION } from '../../src/infrastructure/generated/version.js';

const execFileAsync = promisify(execFile);

describe('npm publish workflow', () => {
  it('runs headed Chromium verification inside a virtual display', async () => {
    const workflow = await readFile('.github/workflows/publish.yml', 'utf8');

    expect(workflow).toContain('run: xvfb-run --auto-servernum npm run verify\n');
    expect(workflow).toContain('run: xvfb-run --auto-servernum npm run verify:package\n');
    expect(workflow).not.toMatch(/^\s*run: npm run verify(?::package)?\s*$/mu);
  });

  it('publishes the verified npm release to the MCP Registry with GitHub OIDC', async () => {
    const workflow = await readFile('.github/workflows/publish.yml', 'utf8');

    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('run: ./mcp-publisher login github-oidc');
    expect(workflow).toContain('run: ./mcp-publisher publish');
    expect(workflow.indexOf('npm publish --access public')).toBeLessThan(
      workflow.indexOf('./mcp-publisher publish'),
    );
  });
});

describe('MCP Registry metadata', () => {
  it('keeps the server identity and package versions consistent', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      name: string;
      version: string;
      mcpName: string;
      dependencies: { playwright: string };
    };
    const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string; dependencies?: { playwright?: string } }>;
    };
    const serverJson = JSON.parse(await readFile('server.json', 'utf8')) as {
      name: string;
      version: string;
      packages: Array<{ identifier: string; version: string; transport: { type: string } }>;
    };
    const releaseConfig = await readFile('release-please-config.json', 'utf8');

    expect(BROWSERMESH_VERSION).toBe(packageJson.version);
    expect(packageJson.dependencies.playwright).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(packageLock.packages['']?.dependencies?.playwright).toBe(
      packageJson.dependencies.playwright,
    );
    expect(packageLock.packages['node_modules/playwright']?.version).toBe(
      packageJson.dependencies.playwright,
    );
    expect(packageJson.mcpName).toBe('io.github.scrollDynasty/browsermesh');
    expect(serverJson.name).toBe(packageJson.mcpName);
    expect(serverJson.version).toBe(packageJson.version);
    expect(serverJson.packages).toEqual([
      expect.objectContaining({
        identifier: packageJson.name,
        version: packageJson.version,
        transport: { type: 'stdio' },
      }),
    ]);
    expect(releaseConfig).toContain('"jsonpath": "$.version"');
    expect(releaseConfig).toContain('"jsonpath": "$.packages[0].version"');
    expect(releaseConfig).toContain('"path": "src/infrastructure/generated/version.ts"');
    expect(releaseConfig).toContain('"type": "generic"');
  });

  it('rejects generated version drift before verification and packaging', async () => {
    await expect(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'scripts/generate-version.ts',
        '--check',
      ]),
    ).resolves.toEqual(expect.objectContaining({ stdout: '', stderr: '' }));
  });
});
