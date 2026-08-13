import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpServer } from '../../src/adapters/mcp/server.js';
import { BROWSERMESH_VERSION } from '../../src/infrastructure/generated/version.js';
import { testRuntime } from '../support/fakes.js';

describe('MCP adapter', () => {
  it('discovers tools, validates input, routes calls, and maps errors', async () => {
    const { runtime } = testRuntime();
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(client.getServerVersion()).toEqual({
      name: 'browsermesh',
      version: BROWSERMESH_VERSION,
    });
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
    const clickTool = tools.tools.find(({ name }) => name === 'browser_click');
    expect(clickTool?.description).toContain('exactly by default');
    expect(clickTool?.description).toContain('LOCATOR_AMBIGUOUS');
    expect(clickTool?.inputSchema).toHaveProperty('properties.locator');
    const snapshotTool = tools.tools.find(({ name }) => name === 'browser_snapshot');
    expect(snapshotTool?.description).toContain('password-input values are redacted');
    const created = await client.callTool({
      name: 'browser_session_create',
      arguments: { name: 'mcp' },
    });
    expect(created.isError).not.toBe(true);
    const serializedCreated = JSON.stringify(created);
    expect(serializedCreated).toContain('operation_');
    expect(serializedCreated).toContain('session_');
    expect(serializedCreated).toContain('page_');
    const target = readTarget(created);
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

    const additionalPage = readTarget(
      await expectToolSuccess(client, 'browser_page_create', { sessionId: target.sessionId }),
    );
    await expectToolSuccess(client, 'browser_session_list', {});
    await expectToolSuccess(client, 'browser_session_get', { sessionId: target.sessionId });
    await expectToolSuccess(client, 'browser_page_list', { sessionId: target.sessionId });
    await expectToolSuccess(client, 'browser_navigate', {
      ...target,
      url: 'https://example.test/contract',
    });
    await expectToolSuccess(client, 'browser_back', target);
    await expectToolSuccess(client, 'browser_forward', target);
    await expectToolSuccess(client, 'browser_reload', target);
    await expectToolSuccess(client, 'browser_get_url', target);
    await expectToolSuccess(client, 'browser_get_title', target);
    await expectToolSuccess(client, 'browser_snapshot', target);
    await expectToolSuccess(client, 'browser_visible_text', {
      ...target,
      locator: { strategy: 'testId', value: 'status' },
    });
    await expectToolSuccess(client, 'browser_click', {
      ...target,
      locator: { strategy: 'role', value: 'button', name: 'Submit', exact: true },
    });
    await expectToolSuccess(client, 'browser_fill', {
      ...target,
      locator: { strategy: 'label', value: 'Name' },
      value: 'Alice',
    });
    await expectToolSuccess(client, 'browser_press', {
      ...target,
      locator: { strategy: 'css', value: 'input' },
      key: 'Enter',
    });
    await expectToolSuccess(client, 'browser_select_option', {
      ...target,
      locator: { strategy: 'label', value: 'Choice' },
      value: 'two',
    });
    await expectToolSuccess(client, 'browser_screenshot', target);
    await expectToolSuccess(client, 'browser_state_save', {
      sessionId: target.sessionId,
      stateId: 'contract-state',
    });
    await expectToolSuccess(client, 'browser_state_list', {});
    await expectToolSuccess(client, 'browser_state_remove', { stateId: 'contract-state' });
    await expectToolSuccess(client, 'browser_page_close', {
      sessionId: target.sessionId,
      pageId: additionalPage.pageId,
    });
    await expectToolSuccess(client, 'browser_session_close', { sessionId: target.sessionId });
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

const successfulTargetSchema = z.object({
  ok: z.literal(true),
  value: z.object({ sessionId: z.string().min(1), pageId: z.string().min(1) }),
});

function readTarget(result: unknown): { sessionId: string; pageId: string } {
  const parsed = z
    .object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
    .parse(result);
  const text = parsed.content.find((block) => block.type === 'text')?.text;
  if (text === undefined) throw new Error('MCP result did not include JSON text');
  return successfulTargetSchema.parse(JSON.parse(text)).value;
}

async function expectToolSuccess(
  client: Client,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return result;
}
