import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  ActionWaitCondition,
  BrowserAction,
  ElementTarget,
  Locator,
  SnapshotOptions,
  ScreenshotOptions,
  WaitCondition,
} from '../../domain/models.js';
import { SNAPSHOT_LIMITS } from '../../domain/snapshots.js';
import { BrowserMeshError } from '../../domain/errors.js';
import { BROWSERMESH_VERSION } from '../../infrastructure/generated/version.js';
import type { BrowserMeshRuntime, OperationTarget } from '../../runtime/browsermesh-runtime.js';
import { contextSettingsSchema, contractFor } from './contracts.js';
import { applicationErrorResult, structuredResult } from './results.js';

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
const refSchema = z.string().regex(/^@e[a-f0-9]{32}$/u);
const elementTargetSchema = z.union([locatorSchema, z.object({ ref: refSchema })]);
const elementInputSchema = { locator: locatorSchema.optional(), ref: refSchema.optional() };
const targetSchema = {
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
};
const scrollDeltaSchema = z.number().int().min(-1_000_000).max(1_000_000);
const screenshotCaptureSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('viewport') }),
    z.object({ kind: z.literal('fullPage') }),
    z.object({ kind: z.literal('element'), locator: locatorSchema }),
  ])
  .optional();
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
const browserActionSchema = z.union([
  z.object({ kind: z.literal('click'), target: elementTargetSchema }),
  z.object({ kind: z.literal('click'), locator: locatorSchema }),
  z.object({
    kind: z.literal('press'),
    target: elementTargetSchema,
    key: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal('press'),
    locator: locatorSchema,
    key: z.string().min(1).max(64),
  }),
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
  z.object({ kind: z.literal('popup') }),
  z.object({
    kind: z.literal('dialog'),
    dialogType: z.enum(['alert', 'beforeunload', 'confirm', 'prompt']),
    action: z.enum(['accept', 'dismiss']),
    promptText: z.string().max(2_000).optional(),
  }),
]);

const observationInputSchema = {
  ...targetSchema,
  sinceEventId: z.string().min(1).max(128).optional(),
  limit: z.number().int().positive().max(200).optional(),
  includeText: z.boolean().optional().default(false),
};
const networkObservationInputSchema = {
  ...targetSchema,
  sinceEventId: z.string().min(1).max(128).optional(),
  limit: z.number().int().positive().max(200).optional(),
};
const snapshotInputSchema = {
  ...targetSchema,
  scope: locatorSchema.optional(),
  maxDepth: z.number().int().min(0).max(SNAPSHOT_LIMITS.maxDepth).optional(),
  includeBoundingBoxes: z.boolean().optional().default(false),
  maxChars: z.number().int().positive().max(SNAPSHOT_LIMITS.maxChars).optional(),
  maxBytes: z.number().int().positive().max(SNAPSHOT_LIMITS.maxBytes).optional(),
  includeRefs: z.boolean().optional().default(false),
  maxRefs: z.number().int().positive().max(SNAPSHOT_LIMITS.maxRefs).optional(),
  interactiveOnly: z.boolean().optional().default(false),
  maxChildren: z.number().int().positive().max(SNAPSHOT_LIMITS.maxChildren).optional(),
  cursor: z.string().min(1).max(160).optional(),
};

function elementTarget(input: {
  locator?: z.infer<typeof locatorSchema> | undefined;
  ref?: string | undefined;
}): ElementTarget {
  if ((input.locator === undefined) === (input.ref === undefined))
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      'Provide exactly one of locator or ref for an element action',
    );
  if (input.locator === undefined) {
    if (input.ref === undefined)
      throw new BrowserMeshError('INVALID_ARGUMENT', 'Element ref is required');
    return { ref: input.ref };
  }
  if (input.locator.strategy !== 'role') return input.locator;
  return {
    strategy: 'role',
    value: input.locator.value,
    ...(input.locator.name === undefined ? {} : { name: input.locator.name }),
    exact: input.locator.exact,
  };
}

function target(
  input: {
    sessionId: string;
    pageId: string;
    timeoutMs?: number | undefined;
  },
  signal?: AbortSignal,
): OperationTarget {
  return {
    sessionId: input.sessionId,
    pageId: input.pageId,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  };
}

export function createMcpServer(runtime: BrowserMeshRuntime): McpServer {
  const server = new McpServer({ name: 'browsermesh', version: BROWSERMESH_VERSION });

  server.registerTool(
    'browser_runtime_info',
    {
      ...contractFor('browser_runtime_info'),
      description:
        'Report bounded, read-only BrowserMesh version, launch state, effective configuration, and session counts without launching Chromium. Use this to diagnose setup and capacity safely; it never returns paths, launch arguments, environment values, browser state, or raw errors.',
    },
    () => {
      try {
        const info = runtime.runtimeInfo();
        return {
          structuredContent: { ...info },
          content: [
            {
              type: 'text',
              text: `BrowserMesh ${info.serverVersion}; Chromium ${info.browserLaunchState}; ${String(info.activeSessions)} active and ${String(info.failedSessions)} failed sessions.`,
            },
          ],
        };
      } catch (error) {
        return applicationErrorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_session_create',
    {
      ...contractFor('browser_session_create'),
      description:
        'Create a new isolated browser session with its own cookies, storage, pages, and optional validated contextSettings (viewport, scale, locale, timezone, color scheme, reduced motion, user agent, geolocation, and explicit origin-scoped geolocation grants). Only the geolocation permission is supported; each grant must name one absolute HTTP(S) origin, never a wildcard. Create a separate session whenever a task involves a different user, account, role, authentication state, device profile, accessibility preference, permission profile, or independent parallel workflow; never reuse one session for identities or context settings that must remain isolated. The response directly returns both sessionId and the deterministic initial pageId plus normalized effective settings. Pass stateId only to restore previously saved browser state.',
      inputSchema: {
        name: z.string().min(1).max(128).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
        stateId: z.string().min(1).max(128).optional(),
        contextSettings: contextSettingsSchema.optional(),
      },
    },
    (input, extra) =>
      structuredResult(async () => {
        const created = await runtime.createSession(input, { signal: extra.signal });
        return {
          operationId: created.operationId,
          session: created.value,
          initialPage: { sessionId: created.sessionId, pageId: created.pageId },
        };
      }),
  );
  server.registerTool(
    'browser_session_list',
    {
      ...contractFor('browser_session_list'),
      description:
        'List every browser session with its explicit sessionId, lifecycle status, name, and neutral workflow metadata. Use this to recover the correct session for each role/account; there is no global active session.',
    },
    (extra) =>
      structuredResult(async () => {
        const listed = await runtime.listSessions({ signal: extra.signal });
        return { operationId: listed.operationId, sessions: listed.value };
      }),
  );
  server.registerTool(
    'browser_session_get',
    {
      ...contractFor('browser_session_get'),
      description:
        'Inspect one explicitly addressed browser session. Session names and metadata are workflow labels, not internal AI agents or owners.',
      inputSchema: { sessionId: z.string().min(1) },
    },
    ({ sessionId }, extra) =>
      structuredResult(async () => {
        const found = await runtime.getSession(sessionId, { signal: extra.signal });
        return { operationId: found.operationId, sessionId, session: found.value };
      }),
  );
  server.registerTool(
    'browser_session_close',
    {
      ...contractFor('browser_session_close'),
      description:
        'Close one explicitly addressed session and release all of its pages and isolated browser context. Close each role/account session when its workflow is complete.',
      inputSchema: { sessionId: z.string().min(1) },
    },
    ({ sessionId }, extra) =>
      structuredResult(async () => {
        const closed = await runtime.closeSession(sessionId, { signal: extra.signal });
        return { operationId: closed.operationId, sessionId, session: closed.value };
      }),
  );

  server.registerTool(
    'browser_page_create',
    {
      ...contractFor('browser_page_create'),
      description:
        "Create an additional page inside one explicitly addressed session. Use it for another tab that must share that session's cookies and storage; use a separate session instead when identity or authentication must be isolated.",
      inputSchema: sessionSchema,
    },
    ({ sessionId }, extra) =>
      structuredResult(async () => {
        const created = await runtime.createPage(sessionId, { signal: extra.signal });
        return {
          operationId: created.operationId,
          sessionId: created.sessionId,
          pageId: created.pageId,
          page: created.value,
        };
      }),
  );
  server.registerTool(
    'browser_page_list',
    {
      ...contractFor('browser_page_list'),
      description:
        'List pages belonging only to the addressed session. Session creation already returns the initial pageId; use this tool to rediscover or inspect all pages in that session.',
      inputSchema: sessionSchema,
    },
    ({ sessionId }, extra) =>
      structuredResult(async () => {
        const listed = await runtime.listPages(sessionId, { signal: extra.signal });
        return { operationId: listed.operationId, sessionId, pages: listed.value };
      }),
  );
  server.registerTool(
    'browser_page_close',
    {
      ...contractFor('browser_page_close'),
      description:
        'Close one explicitly addressed page in its owning session. Supply both IDs because BrowserMesh has no global current session or page.',
      inputSchema: { ...sessionSchema, pageId: z.string().min(1) },
    },
    ({ sessionId, pageId }, extra) =>
      structuredResult(async () => {
        const closed = await runtime.closePage(sessionId, pageId, { signal: extra.signal });
        return { operationId: closed.operationId, sessionId, pageId, closed: true };
      }),
  );

  server.registerTool(
    'browser_navigate',
    {
      ...contractFor('browser_navigate'),
      description:
        'Navigate one explicitly addressed page to an absolute HTTP(S) URL. Keep using the sessionId/pageId pair for the intended account or role; navigation never changes a global active page.',
      inputSchema: { ...targetSchema, url: z.url() },
    },
    (input, extra) => pageValue(runtime.navigate(target(input, extra.signal), input.url), 'url'),
  );
  server.registerTool(
    'browser_back',
    {
      ...contractFor('browser_back'),
      description:
        'Navigate backward in the history of one explicitly addressed page without affecting pages or sessions used by other roles.',
      inputSchema: targetSchema,
    },
    (input, extra) => pageValue(runtime.back(target(input, extra.signal)), 'url'),
  );
  server.registerTool(
    'browser_forward',
    {
      ...contractFor('browser_forward'),
      description:
        'Navigate forward in the history of one explicitly addressed page without affecting other isolated sessions.',
      inputSchema: targetSchema,
    },
    (input, extra) => pageValue(runtime.forward(target(input, extra.signal)), 'url'),
  );
  server.registerTool(
    'browser_reload',
    {
      ...contractFor('browser_reload'),
      description:
        'Reload one explicitly addressed page in its existing isolated session and authentication state.',
      inputSchema: targetSchema,
    },
    (input, extra) => pageValue(runtime.reload(target(input, extra.signal)), 'url'),
  );
  server.registerTool(
    'browser_get_url',
    {
      ...contractFor('browser_get_url'),
      description:
        'Read the current URL of one explicitly addressed page. Use the IDs returned for the intended session; there is no global current page.',
      inputSchema: targetSchema,
    },
    (input, extra) => pageValue(runtime.getUrl(target(input, extra.signal)), 'url'),
  );
  server.registerTool(
    'browser_get_title',
    {
      ...contractFor('browser_get_title'),
      description:
        'Read the title of one explicitly addressed page in its owning isolated session.',
      inputSchema: targetSchema,
    },
    (input, extra) => pageValue(runtime.getTitle(target(input, extra.signal)), 'title'),
  );
  server.registerTool(
    'browser_snapshot',
    {
      ...contractFor('browser_snapshot'),
      description:
        'Inspect a bounded accessibility-oriented snapshot of one explicitly addressed page. Use interactiveOnly to retain interactive nodes with ancestor context and maxChildren to limit every node after filtering. A nextCursor continues the immutable captured serialization without rereading a changed DOM; cursors are page-scoped, expire after 30 seconds, and become stale on navigation or close. Semantic scope, depth, boxes, character/byte bounds, omissions, and truncation are explicit. Non-empty password-input values are redacted before content crosses MCP. Optional 30-second element refs are separate short-lived action conveniences.',
      inputSchema: snapshotInputSchema,
    },
    (input, extra) =>
      structuredResult(async () => {
        const options: SnapshotOptions =
          input.cursor === undefined
            ? {
                ...(input.scope === undefined ? {} : { scope: input.scope as Locator }),
                ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
                includeBoundingBoxes: input.includeBoundingBoxes,
                ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
                ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
                includeRefs: input.includeRefs,
                ...(input.maxRefs === undefined ? {} : { maxRefs: input.maxRefs }),
                interactiveOnly: input.interactiveOnly,
                ...(input.maxChildren === undefined ? {} : { maxChildren: input.maxChildren }),
              }
            : { cursor: input.cursor };
        const captured = await runtime.snapshot(target(input, extra.signal), options);
        return {
          operationId: captured.operationId,
          sessionId: captured.sessionId,
          pageId: captured.pageId,
          ...captured.value,
        };
      }),
  );
  server.registerTool(
    'browser_visible_text',
    {
      ...contractFor('browser_visible_text'),
      description:
        'Read visible text from a semantic or CSS locator on one explicitly addressed page. The lookup is confined to that page and session.',
      inputSchema: { ...targetSchema, locator: locatorSchema },
    },
    (input, extra) =>
      pageValue(runtime.visibleText(target(input, extra.signal), input.locator as Locator), 'text'),
  );
  server.registerTool(
    'browser_console_list',
    {
      ...contractFor('browser_console_list'),
      description:
        'List bounded console events captured for one explicitly addressed page. Results are metadata-only unless includeText=true; text is best-effort redacted and bounded, console argument objects are never serialized. Use sinceEventId for a non-destructive checkpoint and inspect gap/droppedCount before treating the evidence as complete.',
      inputSchema: observationInputSchema,
    },
    (input, extra) =>
      structuredResult(async () => {
        const listed = await runtime.listConsole(target(input, extra.signal), {
          ...(input.sinceEventId === undefined ? {} : { sinceEventId: input.sinceEventId }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          includeText: input.includeText,
        });
        return {
          operationId: listed.operationId,
          sessionId: listed.sessionId,
          pageId: listed.pageId,
          ...listed.value,
        };
      }),
  );
  server.registerTool(
    'browser_page_errors_list',
    {
      ...contractFor('browser_page_errors_list'),
      description:
        'List bounded uncaught page errors for one explicitly addressed page. Results omit messages unless includeText=true; exposed messages are best-effort redacted and bounded and raw stacks are never captured. Cursor, gap, and droppedCount make overflow explicit.',
      inputSchema: observationInputSchema,
    },
    (input, extra) =>
      structuredResult(async () => {
        const listed = await runtime.listPageErrors(target(input, extra.signal), {
          ...(input.sinceEventId === undefined ? {} : { sinceEventId: input.sinceEventId }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          includeText: input.includeText,
        });
        return {
          operationId: listed.operationId,
          sessionId: listed.sessionId,
          pageId: listed.pageId,
          ...listed.value,
        };
      }),
  );
  server.registerTool(
    'browser_network_list',
    {
      ...contractFor('browser_network_list'),
      description:
        'List bounded request and response metadata for one explicitly addressed page. Correlated requestId and durationMs support duplicate/retry analysis. URLs remove credentials and fragments and redact sensitive query values; headers, cookies, bodies, storage, WebSockets, service-worker traffic, data URLs, and blob URLs are never captured. Inspect gap and droppedCount before treating the evidence as complete.',
      inputSchema: networkObservationInputSchema,
    },
    (input, extra) =>
      structuredResult(async () => {
        const listed = await runtime.listNetwork(target(input, extra.signal), {
          ...(input.sinceEventId === undefined ? {} : { sinceEventId: input.sinceEventId }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
        return {
          operationId: listed.operationId,
          sessionId: listed.sessionId,
          pageId: listed.pageId,
          ...listed.value,
        };
      }),
  );
  server.registerTool(
    'browser_failed_requests_list',
    {
      ...contractFor('browser_failed_requests_list'),
      description:
        'List bounded transport-level request failures for one explicitly addressed page. HTTP error responses such as 500 remain response events in browser_network_list; this tool reports request_failed events with correlated IDs, duration, and a bounded safe failure message. No headers, cookies, or bodies are captured.',
      inputSchema: networkObservationInputSchema,
    },
    (input, extra) =>
      structuredResult(async () => {
        const listed = await runtime.listFailedRequests(target(input, extra.signal), {
          ...(input.sinceEventId === undefined ? {} : { sinceEventId: input.sinceEventId }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
        return {
          operationId: listed.operationId,
          sessionId: listed.sessionId,
          pageId: listed.pageId,
          ...listed.value,
        };
      }),
  );
  server.registerTool(
    'browser_click',
    {
      ...contractFor('browser_click'),
      description:
        'Click exactly one semantic/CSS locator or short-lived snapshot ref on one explicitly addressed page. Role locator names match exactly by default; ambiguous locators return LOCATOR_AMBIGUOUS and stale or cross-page refs return STALE_ELEMENT_REFERENCE. Prefer semantic locators for durable workflows.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.click(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_double_click',
    {
      ...contractFor('browser_double_click'),
      description:
        'Double-click a semantic or CSS locator on one explicitly addressed page. Use this only when the application assigns distinct double-click behavior; the action is serialized with all browser work in that session and an ambiguous locator returns LOCATOR_AMBIGUOUS.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.doubleClick(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_hover',
    {
      ...contractFor('browser_hover'),
      description:
        'Move the pointer over a semantic or CSS locator on one explicitly addressed page. Use this to reveal hover-driven controls or state before inspecting or interacting; BrowserMesh preserves same-session accepted order.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.hover(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_focus',
    {
      ...contractFor('browser_focus'),
      description:
        'Focus a semantic or CSS locator on one explicitly addressed page without entering a value. Use this for focus-driven UI state or before a separate key action; the locator remains scoped to the supplied sessionId and pageId.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.focus(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_check',
    {
      ...contractFor('browser_check'),
      description:
        'Ensure a checkbox or radio located semantically or by CSS is checked on one explicitly addressed page. The operation is idempotent, bounded by timeoutMs, and isolated to the supplied session.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.check(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_uncheck',
    {
      ...contractFor('browser_uncheck'),
      description:
        'Ensure a checkbox located semantically or by CSS is unchecked on one explicitly addressed page. The operation is idempotent, bounded by timeoutMs, and isolated to the supplied session.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.uncheck(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_scroll_into_view',
    {
      ...contractFor('browser_scroll_into_view'),
      description:
        'Scroll one semantic or CSS locator into the viewport of an explicitly addressed page. Use this before inspection or interaction when an off-screen target must become visible; it never accepts arbitrary JavaScript or coordinates.',
      inputSchema: { ...targetSchema, ...elementInputSchema },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.scrollIntoView(target(input, extra.signal), elementTarget(input)),
        ),
      ),
  );
  server.registerTool(
    'browser_scroll',
    {
      ...contractFor('browser_scroll'),
      description:
        'Scroll an explicitly addressed page by bounded integer pixel deltas. Use deltaX for horizontal and deltaY for vertical movement; this typed operation exposes no arbitrary JavaScript and remains serialized within the session.',
      inputSchema: { ...targetSchema, deltaX: scrollDeltaSchema, deltaY: scrollDeltaSchema },
    },
    (input, extra) =>
      pageCompleted(runtime.scroll(target(input, extra.signal), input.deltaX, input.deltaY)),
  );
  server.registerTool(
    'browser_drag_and_drop',
    {
      ...contractFor('browser_drag_and_drop'),
      description:
        'Drag one semantic or CSS-located element onto another on one explicitly addressed page. Source and target are resolved in the same page and session, with bounded timeout and strict ambiguity errors.',
      inputSchema: { ...targetSchema, source: locatorSchema, target: locatorSchema },
    },
    (input, extra) =>
      pageCompleted(
        runtime.dragAndDrop(
          target(input, extra.signal),
          input.source as Locator,
          input.target as Locator,
        ),
      ),
  );
  server.registerTool(
    'browser_fill',
    {
      ...contractFor('browser_fill'),
      description:
        'Fill a form field located on one explicitly addressed page. The value is entered only in that session; use separate sessions for different identities.',
      inputSchema: { ...targetSchema, ...elementInputSchema, value: z.string() },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.fill(target(input, extra.signal), elementTarget(input), input.value),
        ),
      ),
  );
  server.registerTool(
    'browser_press',
    {
      ...contractFor('browser_press'),
      description:
        'Press a key on a locator within one explicitly addressed page, preserving deterministic ordering with other operations in that session. A missing or unsuitable element returns OPERATION_TIMEOUT within timeoutMs (10 seconds by default) without closing MCP or browser sessions.',
      inputSchema: { ...targetSchema, ...elementInputSchema, key: z.string().min(1).max(64) },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.press(target(input, extra.signal), elementTarget(input), input.key),
        ),
      ),
  );
  server.registerTool(
    'browser_select_option',
    {
      ...contractFor('browser_select_option'),
      description:
        'Select an option on one explicitly addressed page using a semantic or CSS locator. A missing or unsuitable select returns OPERATION_TIMEOUT within timeoutMs (10 seconds by default), and the supplied session plus all other sessions remain usable.',
      inputSchema: { ...targetSchema, ...elementInputSchema, value: z.string() },
    },
    (input, extra) =>
      pageCompleted(
        Promise.resolve().then(() =>
          runtime.selectOption(target(input, extra.signal), elementTarget(input), input.value),
        ),
      ),
  );
  server.registerTool(
    'browser_screenshot',
    {
      ...contractFor('browser_screenshot'),
      description:
        'Capture an in-memory PNG screenshot of one explicitly addressed page. BrowserMesh returns image content and does not write to a caller-controlled path or inspect another session.',
      inputSchema: { ...targetSchema, capture: screenshotCaptureSchema },
    },
    async (input, extra) => {
      try {
        const options: ScreenshotOptions =
          input.capture?.kind === 'fullPage'
            ? { fullPage: true }
            : input.capture?.kind === 'element'
              ? { locator: input.capture.locator as Locator }
              : {};
        const capture = await runtime.screenshot(target(input, extra.signal), options);
        const structuredContent = {
          operationId: capture.operationId,
          sessionId: capture.sessionId,
          pageId: capture.pageId,
          mimeType: 'image/png' as const,
        };
        return {
          structuredContent,
          content: [
            { type: 'image', mimeType: 'image/png', data: capture.value },
            { type: 'text', text: JSON.stringify(structuredContent) },
          ],
        };
      } catch (error) {
        return applicationErrorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_wait',
    {
      ...contractFor('browser_wait'),
      description:
        'Wait for one deterministic passive condition on an explicitly addressed page: an exact/safe-glob URL, domcontentloaded/load state, locator state, or case-sensitive text presence/absence. The wait occupies that session queue, is bounded by timeoutMs, and must not depend on a later action queued in the same session; use browser_action_and_wait for action-triggered events.',
      inputSchema: { ...targetSchema, condition: waitConditionSchema },
    },
    (input, extra) =>
      structuredResult(async () => {
        const completed = await runtime.wait(
          target(input, extra.signal),
          input.condition as WaitCondition,
        );
        return {
          operationId: completed.operationId,
          sessionId: completed.sessionId,
          pageId: completed.pageId,
          condition: completed.value.condition,
        };
      }),
  );
  server.registerTool(
    'browser_action_and_wait',
    {
      ...contractFor('browser_action_and_wait'),
      description:
        'Atomically register a navigation, response, popup, or dialog waiter first, then click or press on the explicitly addressed page under one shared deadline. Popup pages receive a new BrowserMesh pageId in the same session with isDefault=false and are closed if the page limit is exceeded. Dialogs must be handled atomically because they cannot be inspected later; specify the expected type and accept/dismiss action. Returned dialog text is bounded. Use this instead of parallel same-session calls when an action triggers the event.',
      inputSchema: { ...targetSchema, action: browserActionSchema, wait: actionWaitSchema },
    },
    (input, extra) =>
      structuredResult(async () => {
        const completed = await runtime.actionAndWait(
          target(input, extra.signal),
          input.action as BrowserAction,
          input.wait as ActionWaitCondition,
        );
        return {
          operationId: completed.operationId,
          sessionId: completed.sessionId,
          pageId: completed.pageId,
          action: completed.value.action,
          wait: completed.value.wait,
          event: completed.value.event,
        };
      }),
  );

  server.registerTool(
    'browser_state_save',
    {
      ...contractFor('browser_state_save'),
      description:
        'Save cookies and supported storage from one explicitly addressed session under a safe logical stateId. Use this only when a later new isolated session should restore that authentication state.',
      inputSchema: { ...sessionSchema, stateId: z.string().min(1).max(128) },
    },
    ({ sessionId, stateId }, extra) =>
      structuredResult(async () => {
        const saved = await runtime.saveSessionState(sessionId, stateId, { signal: extra.signal });
        return { operationId: saved.operationId, sessionId, state: saved.value };
      }),
  );
  server.registerTool(
    'browser_state_list',
    {
      ...contractFor('browser_state_list'),
      description:
        'List logical saved-state IDs available for optional restoration when creating a new isolated session; state contents and secrets are not returned.',
    },
    (extra) =>
      structuredResult(async () => {
        const listed = await runtime.listSavedStates({ signal: extra.signal });
        return { operationId: listed.operationId, states: listed.value };
      }),
  );
  server.registerTool(
    'browser_state_remove',
    {
      ...contractFor('browser_state_remove'),
      description:
        'Delete persisted browser state by its safe logical stateId when it should no longer be restorable. This does not close or alter currently live sessions.',
      inputSchema: { stateId: z.string().min(1).max(128) },
    },
    ({ stateId }, extra) =>
      structuredResult(async () => {
        const removed = await runtime.removeSavedState(stateId, { signal: extra.signal });
        return { operationId: removed.operationId, stateId, removed: true };
      }),
  );

  return server;
}

function pageValue(
  operation: Promise<{
    readonly operationId: string;
    readonly sessionId: string;
    readonly pageId: string;
    readonly value: string;
  }>,
  key: string,
) {
  return structuredResult(async () => {
    const completed = await operation;
    return {
      operationId: completed.operationId,
      sessionId: completed.sessionId,
      pageId: completed.pageId,
      [key]: completed.value,
    };
  });
}

function pageCompleted(
  operation: Promise<{
    readonly operationId: string;
    readonly sessionId: string;
    readonly pageId: string;
  }>,
) {
  return structuredResult(async () => {
    const completed = await operation;
    return {
      operationId: completed.operationId,
      sessionId: completed.sessionId,
      pageId: completed.pageId,
      completed: true,
    };
  });
}
