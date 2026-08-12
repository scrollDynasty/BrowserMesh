import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('stdio executable', () => {
  it('starts, negotiates MCP, discovers tools, and exits when the client closes', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'browsermesh-stdio-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        ...(process.env.DISPLAY === undefined ? {} : { DISPLAY: process.env.DISPLAY }),
        ...(process.env.XAUTHORITY === undefined ? {} : { XAUTHORITY: process.env.XAUTHORITY }),
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_DATA_DIR: dataDirectory,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(20);
      expect(tools.tools.some(({ name }) => name === 'browser_navigate')).toBe(true);
      expect(tools.tools.every(({ description }) => (description?.length ?? 0) > 40)).toBe(true);

      const first = readCreated(
        await client.callTool({ name: 'browser_session_create', arguments: { name: 'first' } }),
      );
      const second = readCreated(
        await client.callTool({ name: 'browser_session_create', arguments: { name: 'second' } }),
      );
      const url = await client.callTool({
        name: 'browser_get_url',
        arguments: { sessionId: first.sessionId, pageId: first.pageId },
      });
      expect(url.isError).not.toBe(true);
      expect(JSON.stringify(url.content)).toContain('about:blank');
      const crossSession = await client.callTool({
        name: 'browser_get_url',
        arguments: { sessionId: first.sessionId, pageId: second.pageId },
      });
      expect(crossSession.isError).toBe(true);
      expect(JSON.stringify(crossSession.content)).toContain('PAGE_NOT_FOUND');
      const invalid = await client.callTool({ name: 'browser_get_url', arguments: {} });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.content)).toContain('Input validation error');
    } finally {
      await client.close();
      await transport.close();
      await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('keeps MCP available and reports actionable setup when Chromium is missing', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'browsermesh-no-browser-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_DATA_DIR: join(temporaryRoot, 'data'),
        PLAYWRIGHT_BROWSERS_PATH: join(temporaryRoot, 'browsers'),
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-missing-browser-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some(({ name }) => name === 'browser_session_create')).toBe(true);

      const creation = await client.callTool({
        name: 'browser_session_create',
        arguments: { name: 'missing-browser' },
      });
      expect(creation.isError).toBe(true);
      expect(JSON.stringify(creation.content)).toContain('BROWSER_ERROR');
      expect(JSON.stringify(creation.content)).toContain(
        'npx -y multi-agent-browser-mcp --install-browser',
      );
    } finally {
      await client.close();
      await transport.close();
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

const createdSchema = z.object({
  ok: z.literal(true),
  value: z.object({ sessionId: z.string(), pageId: z.string() }),
});

function readCreated(result: unknown): z.infer<typeof createdSchema>['value'] {
  const parsed = z
    .object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
    .parse(result);
  const text = parsed.content.find((block) => block.type === 'text')?.text;
  if (text === undefined) throw new Error('MCP create result did not contain text');
  return createdSchema.parse(JSON.parse(text)).value;
}
