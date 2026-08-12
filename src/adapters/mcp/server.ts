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
  timeoutMs: z.number().int().positive().max(300_000).optional(),
};
const sessionSchema = { sessionId: z.string().min(1) };

function target(input: {
  sessionId: string;
  pageId: string;
  timeoutMs?: number | undefined;
}): OperationTarget {
  return {
    sessionId: input.sessionId,
    pageId: input.pageId,
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
      description:
        'Create a new isolated browser session with its own cookies, storage, and pages. Create a separate session whenever a task involves a different user, account, role, or independent browser state; never reuse one session for identities that must remain isolated. The response returns a sessionId; call browser_page_list to obtain its initial pageId.',
      inputSchema: {
        name: z.string().min(1).max(128).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
        fromState: z.string().min(1).optional(),
      },
    },
    (input) => result(() => runtime.createSession(input)),
  );
  server.registerTool(
    'browser_session_list',
    {
      description:
        'List every browser session with its explicit sessionId, lifecycle status, name, and neutral workflow metadata. Use this to recover the correct session for each role/account; there is no global active session.',
    },
    () => result(() => runtime.listSessions()),
  );
  server.registerTool(
    'browser_session_get',
    {
      description:
        'Inspect one explicitly addressed browser session. Session names and metadata are workflow labels, not internal AI agents or owners.',
      inputSchema: { sessionId: z.string().min(1) },
    },
    ({ sessionId }) => result(() => runtime.getSession(sessionId)),
  );
  server.registerTool(
    'browser_session_close',
    {
      description:
        'Close one explicitly addressed session and release all of its pages and isolated browser context. Close each role/account session when its workflow is complete.',
      inputSchema: { sessionId: z.string().min(1) },
    },
    ({ sessionId }) => result(() => runtime.closeSession(sessionId)),
  );

  server.registerTool(
    'browser_page_create',
    { description: 'Create a page in a session', inputSchema: sessionSchema },
    ({ sessionId }) => result(() => runtime.createPage(sessionId)),
  );
  server.registerTool(
    'browser_page_list',
    {
      description:
        'List pages belonging only to the addressed session. Call this after browser_session_create to obtain the deterministic initial pageId.',
      inputSchema: sessionSchema,
    },
    ({ sessionId }) => result(() => runtime.listPages(sessionId)),
  );
  server.registerTool(
    'browser_page_close',
    { description: 'Close a page', inputSchema: { ...sessionSchema, pageId: z.string().min(1) } },
    ({ sessionId, pageId }) => result(() => runtime.closePage(sessionId, pageId)),
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
    ({ sessionId, name }) => result(() => runtime.saveSessionState(sessionId, name)),
  );
  server.registerTool('browser_state_list', { description: 'List saved states' }, () =>
    result(() => runtime.listSavedStates()),
  );
  server.registerTool(
    'browser_state_remove',
    { description: 'Delete a saved state', inputSchema: { name: z.string().min(1).max(128) } },
    ({ name }) => result(() => runtime.removeSavedState(name)),
  );

  return server;
}
