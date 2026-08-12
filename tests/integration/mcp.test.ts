import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../../src/adapters/mcp/server.js';
import { testRuntime } from '../support/fakes.js';

describe('MCP adapter', () => {
  it('discovers tools, validates input, routes calls, and maps errors', async () => {
    const { runtime } = testRuntime();
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map(({ name }) => name)).toContain('browser_session_create');
    expect(
      tools.tools.some(
        ({ name }) =>
          name.startsWith('browser_agent_') ||
          name.startsWith('browser_message_') ||
          name === 'browser_session_assign' ||
          name === 'browser_session_release',
      ),
    ).toBe(false);
    const createTool = tools.tools.find(({ name }) => name === 'browser_session_create');
    expect(createTool?.description).toContain('different user, account, role');
    const created = await client.callTool({
      name: 'browser_session_create',
      arguments: { name: 'mcp' },
    });
    expect(created.isError).not.toBe(true);
    const missing = await client.callTool({
      name: 'browser_session_get',
      arguments: { sessionId: 'missing' },
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain('SESSION_NOT_FOUND');
    const invalid = await client.callTool({ name: 'browser_session_get', arguments: {} });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain('Input validation error');
    await client.close();
    await server.close();
    await runtime.shutdown();
  });
});
