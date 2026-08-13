import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
    };
    const serverJson = JSON.parse(await readFile('server.json', 'utf8')) as {
      name: string;
      version: string;
      packages: Array<{ identifier: string; version: string; transport: { type: string } }>;
    };
    const releaseConfig = await readFile('release-please-config.json', 'utf8');

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
  });
});
