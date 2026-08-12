import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

describe('stdio executable', () => {
  it('starts, negotiates MCP, discovers tools, and exits when the client closes', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_PERSISTENCE: 'false',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(20);
    expect(tools.tools.some(({ name }) => name === 'browser_navigate')).toBe(true);
    await client.close();
  });
});
