import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { asBrowserMeshError } from '../../domain/errors.js';
import type {
  ActionWaitCondition,
  BrowserAction,
  Locator,
  WaitCondition,
} from '../../domain/models.js';
import { BROWSERMESH_VERSION } from '../../infrastructure/generated/version.js';
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
  z.object({
    strategy: z.literal('role'),
    value: role,
    name: z.string().optional(),
    exact: z.boolean().optional().default(true),
  }),
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
const urlMatcherSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.string().min(1).max(2_048) }),
  z.object({ kind: z.literal('glob'), value: z.string().min(1).max(2_048) }),
]);
const waitConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), matcher: urlMatcherSchema }),
  z.object({ kind: z.literal('load'), state: z.enum(['domcontentloaded', 'load']) }),
  z.object({
    kind: z.literal('locator'),
    locator: locatorSchema,
    state: z.enum(['visible', 'hidden', 'attached', 'detached', 'enabled', 'disabled']),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1).max(2_000),
    state: z.enum(['present', 'absent']),
  }),
]);
const browserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), locator: locatorSchema }),
  z.object({ kind: z.literal('press'), locator: locatorSchema, key: z.string().min(1).max(64) }),
]);
const actionWaitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('navigation'),
    matcher: urlMatcherSchema.optional(),
    loadState: z.enum(['domcontentloaded', 'load']).optional(),
  }),
  z.object({
    kind: z.literal('response'),
    matcher: urlMatcherSchema,
    method: z
      .string()
      .regex(/^[A-Z]{1,16}$/u)
      .optional(),
    status: z.number().int().min(100).max(599).optional(),
  }),
]);

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
  const server = new McpServer({ name: 'browsermesh', version: BROWSERMESH_VERSION });

  server.registerTool(
    'browser_session_create',
    {
      description:
        'Create a new isolated browser session with its own cookies, storage, and pages. Create a separate session whenever a task involves a different user, account, role, authentication state, or independent parallel workflow; never reuse one session for identities that must remain isolated. The response directly returns both sessionId and the deterministic initial pageId for immediate navigation. Pass stateId only to restore previously saved browser state.',
      inputSchema: {
        name: z.string().min(1).max(128).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
        stateId: z.string().min(1).max(128).optional(),
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
    {
      description:
        "Create an additional page inside one explicitly addressed session. Use it for another tab that must share that session's cookies and storage; use a separate session instead when identity or authentication must be isolated.",
      inputSchema: sessionSchema,
    },
    ({ sessionId }) => result(() => runtime.createPage(sessionId)),
  );
  server.registerTool(
    'browser_page_list',
    {
      description:
        'List pages belonging only to the addressed session. Session creation already returns the initial pageId; use this tool to rediscover or inspect all pages in that session.',
      inputSchema: sessionSchema,
    },
    ({ sessionId }) => result(() => runtime.listPages(sessionId)),
  );
  server.registerTool(
    'browser_page_close',
    {
      description:
        'Close one explicitly addressed page in its owning session. Supply both IDs because BrowserMesh has no global current session or page.',
      inputSchema: { ...sessionSchema, pageId: z.string().min(1) },
    },
    ({ sessionId, pageId }) => result(() => runtime.closePage(sessionId, pageId)),
  );

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Navigate one explicitly addressed page to an absolute HTTP(S) URL. Keep using the sessionId/pageId pair for the intended account or role; navigation never changes a global active page.',
      inputSchema: { ...targetSchema, url: z.url() },
    },
    (input) => result(() => runtime.navigate(target(input), input.url)),
  );
  server.registerTool(
    'browser_back',
    {
      description:
        'Navigate backward in the history of one explicitly addressed page without affecting pages or sessions used by other roles.',
      inputSchema: targetSchema,
    },
    (input) => result(() => runtime.back(target(input))),
  );
  server.registerTool(
    'browser_forward',
    {
      description:
        'Navigate forward in the history of one explicitly addressed page without affecting other isolated sessions.',
      inputSchema: targetSchema,
    },
    (input) => result(() => runtime.forward(target(input))),
  );
  server.registerTool(
    'browser_reload',
    {
      description:
        'Reload one explicitly addressed page in its existing isolated session and authentication state.',
      inputSchema: targetSchema,
    },
    (input) => result(() => runtime.reload(target(input))),
  );
  server.registerTool(
    'browser_get_url',
    {
      description:
        'Read the current URL of one explicitly addressed page. Use the IDs returned for the intended session; there is no global current page.',
      inputSchema: targetSchema,
    },
    (input) => result(() => runtime.getUrl(target(input))),
  );
  server.registerTool(
    'browser_get_title',
    {
      description:
        'Read the title of one explicitly addressed page in its owning isolated session.',
      inputSchema: targetSchema,
    },
    (input) => result(() => runtime.getTitle(target(input))),
  );
  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Inspect an accessibility-oriented snapshot of one explicitly addressed page. Non-empty password-input values are redacted before content crosses MCP. Use the snapshot to understand page structure before semantic interaction while preserving session isolation.',
      inputSchema: targetSchema,
    },
    (input) => result(() => runtime.snapshot(target(input))),
  );
  server.registerTool(
    'browser_visible_text',
    {
      description:
        'Read visible text from a semantic or CSS locator on one explicitly addressed page. The lookup is confined to that page and session.',
      inputSchema: { ...targetSchema, locator: locatorSchema },
    },
    (input) => result(() => runtime.visibleText(target(input), input.locator as Locator)),
  );
  server.registerTool(
    'browser_click',
    {
      description:
        'Click a semantic or CSS locator on one explicitly addressed page. Role locator names match exactly by default for deterministic selection; pass exact=false only for intentional partial matching. An ambiguous locator returns LOCATOR_AMBIGUOUS without damaging the session. Prefer semantic locators and keep the IDs associated with the intended user/account session.',
      inputSchema: { ...targetSchema, locator: locatorSchema },
    },
    (input) => result(() => runtime.click(target(input), input.locator as Locator)),
  );
  server.registerTool(
    'browser_fill',
    {
      description:
        'Fill a form field located on one explicitly addressed page. The value is entered only in that session; use separate sessions for different identities.',
      inputSchema: { ...targetSchema, locator: locatorSchema, value: z.string() },
    },
    (input) => result(() => runtime.fill(target(input), input.locator as Locator, input.value)),
  );
  server.registerTool(
    'browser_press',
    {
      description:
        'Press a key on a locator within one explicitly addressed page, preserving deterministic ordering with other operations in that session. A missing or unsuitable element returns OPERATION_TIMEOUT within timeoutMs (10 seconds by default) without closing MCP or browser sessions.',
      inputSchema: { ...targetSchema, locator: locatorSchema, key: z.string().min(1).max(64) },
    },
    (input) => result(() => runtime.press(target(input), input.locator as Locator, input.key)),
  );
  server.registerTool(
    'browser_select_option',
    {
      description:
        'Select an option on one explicitly addressed page using a semantic or CSS locator. A missing or unsuitable select returns OPERATION_TIMEOUT within timeoutMs (10 seconds by default), and the supplied session plus all other sessions remain usable.',
      inputSchema: { ...targetSchema, locator: locatorSchema, value: z.string() },
    },
    (input) =>
      result(() => runtime.selectOption(target(input), input.locator as Locator, input.value)),
  );
  server.registerTool(
    'browser_screenshot',
    {
      description:
        'Capture an in-memory PNG screenshot of one explicitly addressed page. BrowserMesh returns image content and does not write to a caller-controlled path or inspect another session.',
      inputSchema: targetSchema,
    },
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
    'browser_wait',
    {
      description:
        'Wait for one deterministic passive condition on an explicitly addressed page: an exact/safe-glob URL, domcontentloaded/load state, locator state, or case-sensitive text presence/absence. The wait occupies that session queue, is bounded by timeoutMs, and must not depend on a later action queued in the same session; use browser_action_and_wait for action-triggered events.',
      inputSchema: { ...targetSchema, condition: waitConditionSchema },
    },
    (input) => result(() => runtime.wait(target(input), input.condition as WaitCondition)),
  );
  server.registerTool(
    'browser_action_and_wait',
    {
      description:
        'Atomically register a navigation or response waiter first, then click or press on the explicitly addressed page under one shared deadline. Use this instead of parallel same-session calls when an action triggers the event; BrowserMesh preserves queue serialization and returns bounded event metadata.',
      inputSchema: { ...targetSchema, action: browserActionSchema, wait: actionWaitSchema },
    },
    (input) =>
      result(() =>
        runtime.actionAndWait(
          target(input),
          input.action as BrowserAction,
          input.wait as ActionWaitCondition,
        ),
      ),
  );

  server.registerTool(
    'browser_state_save',
    {
      description:
        'Save cookies and supported storage from one explicitly addressed session under a safe logical stateId. Use this only when a later new isolated session should restore that authentication state.',
      inputSchema: { ...sessionSchema, stateId: z.string().min(1).max(128) },
    },
    ({ sessionId, stateId }) => result(() => runtime.saveSessionState(sessionId, stateId)),
  );
  server.registerTool(
    'browser_state_list',
    {
      description:
        'List logical saved-state IDs available for optional restoration when creating a new isolated session; state contents and secrets are not returned.',
    },
    () => result(() => runtime.listSavedStates()),
  );
  server.registerTool(
    'browser_state_remove',
    {
      description:
        'Delete persisted browser state by its safe logical stateId when it should no longer be restorable. This does not close or alter currently live sessions.',
      inputSchema: { stateId: z.string().min(1).max(128) },
    },
    ({ stateId }) => result(() => runtime.removeSavedState(stateId)),
  );

  return server;
}
