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
    expect(tools.tools.map(({ name }) => name).sort()).toEqual(expectedToolNames);
    expect(tools.tools.every(({ description }) => (description?.length ?? 0) > 40)).toBe(true);
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
    expect(createTool?.description).toContain('independent parallel workflow');
    const created = await client.callTool({
      name: 'browser_session_create',
      arguments: { name: 'mcp' },
    });
    expect(created.isError).not.toBe(true);
    const serializedCreated = JSON.stringify(created);
    expect(serializedCreated).toContain('operation_');
    expect(serializedCreated).toContain('session_');
    expect(serializedCreated).toContain('page_');
    expect(createTool?.inputSchema).toHaveProperty('properties.stateId');
    expect(createTool?.inputSchema).not.toHaveProperty('properties.fromState');
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

const expectedToolNames = [
  'browser_back',
  'browser_click',
  'browser_fill',
  'browser_forward',
  'browser_get_title',
  'browser_get_url',
  'browser_navigate',
  'browser_page_close',
  'browser_page_create',
  'browser_page_list',
  'browser_press',
  'browser_reload',
  'browser_screenshot',
  'browser_select_option',
  'browser_session_close',
  'browser_session_create',
  'browser_session_get',
  'browser_session_list',
  'browser_snapshot',
  'browser_state_list',
  'browser_state_remove',
  'browser_state_save',
  'browser_visible_text',
].sort();
