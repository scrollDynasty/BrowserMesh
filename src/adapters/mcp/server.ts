import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { asBrowserMeshError } from '../../domain/errors.js';
import type { Locator } from '../../domain/models.js';
import type { BrowserMeshRuntime, OperationTarget } from '../../runtime/browsermesh-runtime.js';

const role = z.enum([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'heading',
  'listitem',
  'option',
  'tab',
]);
const locatorSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('role'), value: role, name: z.string().optional() }),
  z.object({
    strategy: z.enum(['text', 'label', 'placeholder', 'testId', 'css']),
    value: z.string().min(1),
  }),
]);
const targetSchema = {
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
};
const sessionSchema = { sessionId: z.string().min(1), agentId: z.string().min(1).optional() };

function target(input: {
  sessionId: string;
  pageId: string;
  agentId?: string | undefined;
  timeoutMs?: number | undefined;
}): OperationTarget {
  return {
    sessionId: input.sessionId,
    pageId: input.pageId,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

async function result(action: () => unknown): Promise<CallToolResult> {
  try {
    const value = await action();
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, value }) }] };
  } catch (error) {
    const mapped = asBrowserMeshError(error);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: { code: mapped.code, message: mapped.message, details: mapped.details },
          }),
        },
      ],
    };
  }
}

export function createMcpServer(runtime: BrowserMeshRuntime): McpServer {
  const server = new McpServer({ name: 'browsermesh', version: '0.1.0' });

  server.registerTool(
    'browser_session_create',
    {
      description: 'Create an isolated browser session with an initial page',
      inputSchema: {
        name: z.string().min(1).max(128).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
        fromState: z.string().min(1).optional(),
        ownerAgentId: z.string().min(1).optional(),
      },
    },
    (input) => result(() => runtime.createSession(input)),
  );
  server.registerTool('browser_session_list', { description: 'List browser sessions' }, () =>
    result(() => runtime.listSessions()),
  );
  server.registerTool(
    'browser_session_get',
    { description: 'Get a browser session', inputSchema: { sessionId: z.string().min(1) } },
    ({ sessionId }) => result(() => runtime.getSession(sessionId)),
  );
  server.registerTool(
    'browser_session_close',
    { description: 'Close a browser session', inputSchema: { sessionId: z.string().min(1) } },
    ({ sessionId }) => result(() => runtime.closeSession(sessionId)),
  );

  server.registerTool(
    'browser_page_create',
    { description: 'Create a page in a session', inputSchema: sessionSchema },
    ({ sessionId, agentId }) => result(() => runtime.createPage(sessionId, agentId)),
  );
  server.registerTool(
    'browser_page_list',
    { description: 'List explicitly managed pages in a session', inputSchema: sessionSchema },
    ({ sessionId, agentId }) => result(() => runtime.listPages(sessionId, agentId)),
  );
  server.registerTool(
    'browser_page_close',
    { description: 'Close a page', inputSchema: { ...sessionSchema, pageId: z.string().min(1) } },
    ({ sessionId, pageId, agentId }) => result(() => runtime.closePage(sessionId, pageId, agentId)),
  );

  server.registerTool(
    'browser_navigate',
    {
      description: 'Navigate an explicitly addressed page',
      inputSchema: { ...targetSchema, url: z.url() },
    },
    (input) => result(() => runtime.navigate(target(input), input.url)),
  );
  server.registerTool(
    'browser_back',
    { description: 'Navigate back', inputSchema: targetSchema },
    (input) => result(() => runtime.back(target(input))),
  );
  server.registerTool(
    'browser_forward',
    { description: 'Navigate forward', inputSchema: targetSchema },
    (input) => result(() => runtime.forward(target(input))),
  );
  server.registerTool(
    'browser_reload',
    { description: 'Reload a page', inputSchema: targetSchema },
    (input) => result(() => runtime.reload(target(input))),
  );
  server.registerTool(
    'browser_get_url',
    { description: 'Get the current page URL', inputSchema: targetSchema },
    (input) => result(() => runtime.getUrl(target(input))),
  );
  server.registerTool(
    'browser_get_title',
    { description: 'Get the page title', inputSchema: targetSchema },
    (input) => result(() => runtime.getTitle(target(input))),
  );
  server.registerTool(
    'browser_snapshot',
    { description: 'Get an accessibility-oriented page snapshot', inputSchema: targetSchema },
    (input) => result(() => runtime.snapshot(target(input))),
  );
  server.registerTool(
    'browser_visible_text',
    {
      description: 'Read visible text from a locator',
      inputSchema: { ...targetSchema, locator: locatorSchema },
    },
    (input) => result(() => runtime.visibleText(target(input), input.locator as Locator)),
  );
  server.registerTool(
    'browser_click',
    {
      description: 'Click a semantic or CSS locator',
      inputSchema: { ...targetSchema, locator: locatorSchema },
    },
    (input) => result(() => runtime.click(target(input), input.locator as Locator)),
  );
  server.registerTool(
    'browser_fill',
    {
      description: 'Fill a form field',
      inputSchema: { ...targetSchema, locator: locatorSchema, value: z.string() },
    },
    (input) => result(() => runtime.fill(target(input), input.locator as Locator, input.value)),
  );
  server.registerTool(
    'browser_press',
    {
      description: 'Press a key on a locator',
      inputSchema: { ...targetSchema, locator: locatorSchema, key: z.string().min(1).max(64) },
    },
    (input) => result(() => runtime.press(target(input), input.locator as Locator, input.key)),
  );
  server.registerTool(
    'browser_select_option',
    {
      description: 'Select an option',
      inputSchema: { ...targetSchema, locator: locatorSchema, value: z.string() },
    },
    (input) =>
      result(() => runtime.selectOption(target(input), input.locator as Locator, input.value)),
  );
  server.registerTool(
    'browser_screenshot',
    { description: 'Capture a PNG screenshot as MCP image content', inputSchema: targetSchema },
    async (input) => {
      try {
        const capture = await runtime.screenshot(target(input));
        return {
          content: [
            { type: 'image', mimeType: 'image/png', data: capture.value },
            {
              type: 'text',
              text: JSON.stringify({
                operationId: capture.operationId,
                sessionId: capture.sessionId,
                pageId: capture.pageId,
              }),
            },
          ],
        };
      } catch (error) {
        return result(() => {
          throw error;
        });
      }
    },
  );

  server.registerTool(
    'browser_state_save',
    {
      description: 'Save session authentication/storage state',
      inputSchema: { ...sessionSchema, name: z.string().min(1).max(128) },
    },
    ({ sessionId, name, agentId }) =>
      result(() => runtime.saveSessionState(sessionId, name, agentId)),
  );
  server.registerTool('browser_state_list', { description: 'List saved states' }, () =>
    result(() => runtime.listSavedStates()),
  );
  server.registerTool(
    'browser_state_remove',
    { description: 'Delete a saved state', inputSchema: { name: z.string().min(1).max(128) } },
    ({ name }) => result(() => runtime.removeSavedState(name)),
  );

  server.registerTool(
    'browser_agent_create',
    {
      description: 'Create an agent',
      inputSchema: {
        name: z.string().min(1).max(128),
        metadata: z.record(z.string(), z.string()).optional(),
      },
    },
    (input) => result(() => runtime.createAgent(input)),
  );
  server.registerTool('browser_agent_list', { description: 'List agents' }, () =>
    result(() => runtime.listAgents()),
  );
  server.registerTool(
    'browser_agent_get',
    { description: 'Get an agent', inputSchema: { agentId: z.string().min(1) } },
    ({ agentId }) => result(() => runtime.getAgent(agentId)),
  );
  server.registerTool(
    'browser_agent_remove',
    {
      description: 'Remove an agent and release its sessions',
      inputSchema: { agentId: z.string().min(1) },
    },
    ({ agentId }) => result(() => runtime.removeAgent(agentId)),
  );
  server.registerTool(
    'browser_session_assign',
    {
      description: 'Assign or hand off a session to an agent',
      inputSchema: {
        sessionId: z.string().min(1),
        agentId: z.string().min(1),
        currentOwnerAgentId: z.string().min(1).optional(),
      },
    },
    ({ sessionId, agentId, currentOwnerAgentId }) =>
      result(() => runtime.assignSession(sessionId, agentId, currentOwnerAgentId)),
  );
  server.registerTool(
    'browser_session_release',
    {
      description: 'Release an owned session',
      inputSchema: { sessionId: z.string().min(1), agentId: z.string().min(1) },
    },
    ({ sessionId, agentId }) => result(() => runtime.releaseSession(sessionId, agentId)),
  );

  server.registerTool(
    'browser_message_send',
    {
      description: 'Send a deterministic mailbox message',
      inputSchema: {
        fromAgentId: z.string().min(1),
        toAgentId: z.string().min(1),
        type: z.enum(['message', 'request', 'response', 'event', 'handoff']),
        payload: z.json(),
        correlationId: z.string().optional(),
        replyTo: z.string().optional(),
      },
    },
    (input) => result(() => runtime.sendMessage({ ...input, type: input.type })),
  );
  server.registerTool(
    'browser_message_list',
    {
      description: 'List an agent mailbox',
      inputSchema: { agentId: z.string().min(1), unreadOnly: z.boolean().default(false) },
    },
    ({ agentId, unreadOnly }) => result(() => runtime.listMessages(agentId, unreadOnly)),
  );
  server.registerTool(
    'browser_message_acknowledge',
    {
      description: 'Acknowledge a mailbox message',
      inputSchema: { agentId: z.string().min(1), messageId: z.string().min(1) },
    },
    ({ agentId, messageId }) => result(() => runtime.acknowledgeMessage(agentId, messageId)),
  );
  return server;
}
