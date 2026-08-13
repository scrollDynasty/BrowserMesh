import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const operationId = z.string().min(1);
const sessionId = z.string().min(1);
const pageId = z.string().min(1);
const timestamp = z.string().min(1);
const safeContextText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        Array.from(value, (character) => character.codePointAt(0) ?? 0).every(
          (codePoint) => codePoint > 31 && (codePoint < 127 || codePoint > 159),
        ),
      'Control characters are not allowed',
    );

export const contextSettingsSchema = z.object({
  viewport: z
    .object({
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
    })
    .optional(),
  deviceScaleFactor: z.number().min(0.1).max(10).optional(),
  locale: safeContextText(64).optional(),
  timezoneId: safeContextText(128).optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  reducedMotion: z.enum(['reduce', 'no-preference']).optional(),
  userAgent: safeContextText(512).optional(),
});

export const sessionViewSchema = z.object({
  sessionId,
  name: z.string().optional(),
  status: z.enum(['creating', 'ready', 'closing', 'closed', 'failed']),
  createdAt: timestamp,
  lastActivityAt: timestamp,
  metadata: z.record(z.string(), z.string()),
  restoredFromStateId: z.string().optional(),
  contextSettings: contextSettingsSchema,
});

export const pageViewSchema = z.object({
  pageId,
  sessionId,
  createdAt: timestamp,
  url: z.string(),
  isDefault: z.boolean(),
});

export const savedStateViewSchema = z.object({
  stateId: z.string().min(1),
  createdAt: timestamp,
});

const pageOperation = { operationId, sessionId, pageId } as const;
const locatorSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('role'),
    value: z.enum([
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
    ]),
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  z.object({
    strategy: z.enum(['text', 'label', 'placeholder', 'testId', 'css']),
    value: z.string(),
  }),
]);
const nullableLocatorSchema = locatorSchema.nullable();
const elementTargetSchema = z.union([
  locatorSchema,
  z.object({ ref: z.string().regex(/^@e[a-f0-9]{32}$/u) }),
]);
const urlMatcherSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.string() }),
  z.object({ kind: z.literal('glob'), value: z.string() }),
]);
const waitConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), matcher: urlMatcherSchema }),
  z.object({ kind: z.literal('load'), state: z.enum(['domcontentloaded', 'load']) }),
  z.object({
    kind: z.literal('locator'),
    locator: locatorSchema,
    state: z.enum(['visible', 'hidden', 'attached', 'detached', 'enabled', 'disabled']),
  }),
  z.object({ kind: z.literal('text'), text: z.string(), state: z.enum(['present', 'absent']) }),
]);
const browserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), target: elementTargetSchema }),
  z.object({ kind: z.literal('press'), target: elementTargetSchema, key: z.string() }),
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
    method: z.string().optional(),
    status: z.number().int().optional(),
  }),
]);
const waitedEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigation'), url: z.string() }),
  z.object({
    kind: z.literal('response'),
    url: z.string(),
    method: z.string().optional(),
    status: z.number().int().optional(),
  }),
]);

const observationCommon = {
  eventId: z.string().min(1),
  timestamp,
  sessionId,
  pageId,
} as const;
const observationEventSchema = z.discriminatedUnion('kind', [
  z.object({
    ...observationCommon,
    kind: z.literal('console'),
    level: z.string(),
    text: z.string().optional(),
  }),
  z.object({ ...observationCommon, kind: z.literal('page_error'), text: z.string().optional() }),
  z.object({
    ...observationCommon,
    kind: z.literal('request'),
    requestId: z.string().min(1),
    method: z.string().min(1),
    url: z.url(),
    resourceType: z.string().min(1),
  }),
  z.object({
    ...observationCommon,
    kind: z.literal('response'),
    requestId: z.string().min(1),
    method: z.string().min(1),
    url: z.url(),
    resourceType: z.string().min(1),
    status: z.number().int().min(0).max(999),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...observationCommon,
    kind: z.literal('request_failed'),
    requestId: z.string().min(1),
    method: z.string().min(1),
    url: z.url(),
    resourceType: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    failure: z.string(),
  }),
]);
const observationList = {
  ...pageOperation,
  events: z.array(observationEventSchema),
  nextCursor: z.string().nullable(),
  droppedCount: z.number().int().nonnegative(),
  gap: z.boolean(),
} as const;

export const outputSchemas = {
  browser_runtime_info: z.object({
    serverVersion: z.string().min(1),
    nodeVersion: z.string().min(1),
    playwrightVersion: z.string().min(1),
    browserProduct: z.literal('chromium'),
    browserVersion: z.string().min(1).nullable(),
    browserLaunchState: z.enum(['not_started', 'ready', 'failed']),
    headless: z.boolean(),
    persistenceEnabled: z.boolean(),
    defaultTimeoutMs: z.number().int().positive(),
    maxSessions: z.number().int().positive(),
    maxPagesPerSession: z.number().int().positive(),
    activeSessions: z.number().int().nonnegative(),
    failedSessions: z.number().int().nonnegative(),
  }),
  browser_session_create: z.object({
    operationId,
    session: sessionViewSchema,
    initialPage: z.object({ sessionId, pageId }),
  }),
  browser_session_list: z.object({ operationId, sessions: z.array(sessionViewSchema) }),
  browser_session_get: z.object({ operationId, sessionId, session: sessionViewSchema }),
  browser_session_close: z.object({ operationId, sessionId, session: sessionViewSchema }),
  browser_page_create: z.object({ ...pageOperation, page: pageViewSchema }),
  browser_page_list: z.object({ operationId, sessionId, pages: z.array(pageViewSchema) }),
  browser_page_close: z.object({ ...pageOperation, closed: z.literal(true) }),
  browser_navigate: z.object({ ...pageOperation, url: z.string() }),
  browser_back: z.object({ ...pageOperation, url: z.string() }),
  browser_forward: z.object({ ...pageOperation, url: z.string() }),
  browser_reload: z.object({ ...pageOperation, url: z.string() }),
  browser_get_url: z.object({ ...pageOperation, url: z.string() }),
  browser_get_title: z.object({ ...pageOperation, title: z.string() }),
  browser_snapshot: z.object({
    ...pageOperation,
    snapshot: z.string(),
    contentFormat: z.enum(['aria-yaml', 'aria-yaml-fragment']),
    partial: z.boolean(),
    refs: z.array(
      z.object({
        ref: z.string().regex(/^@e[a-f0-9]{32}$/u),
        tag: z.string().min(1).max(32),
        role: z.string().max(64).optional(),
        name: z.string().max(120).optional(),
      }),
    ),
    appliedBounds: z.object({
      scope: nullableLocatorSchema,
      maxDepth: z.number().int().nonnegative().nullable(),
      includeBoundingBoxes: z.boolean(),
      maxChars: z.number().int().positive(),
      maxBytes: z.number().int().positive(),
      includeRefs: z.boolean(),
      maxRefs: z.number().int().positive(),
    }),
    truncation: z.object({
      truncated: z.boolean(),
      byMaxChars: z.boolean(),
      byMaxBytes: z.boolean(),
      originalChars: z.number().int().nonnegative(),
      originalBytes: z.number().int().nonnegative(),
      returnedChars: z.number().int().nonnegative(),
      returnedBytes: z.number().int().nonnegative(),
    }),
  }),
  browser_visible_text: z.object({ ...pageOperation, text: z.string() }),
  browser_console_list: z.object(observationList),
  browser_page_errors_list: z.object(observationList),
  browser_network_list: z.object(observationList),
  browser_failed_requests_list: z.object(observationList),
  browser_click: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_double_click: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_hover: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_focus: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_check: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_uncheck: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_scroll_into_view: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_scroll: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_drag_and_drop: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_fill: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_press: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_select_option: z.object({ ...pageOperation, completed: z.literal(true) }),
  browser_screenshot: z.object({
    ...pageOperation,
    mimeType: z.literal('image/png'),
  }),
  browser_wait: z.object({ ...pageOperation, condition: waitConditionSchema }),
  browser_action_and_wait: z.object({
    ...pageOperation,
    action: browserActionSchema,
    wait: actionWaitSchema,
    event: waitedEventSchema,
  }),
  browser_state_save: z.object({ operationId, sessionId, state: savedStateViewSchema }),
  browser_state_list: z.object({ operationId, states: z.array(savedStateViewSchema) }),
  browser_state_remove: z.object({
    operationId,
    stateId: z.string().min(1),
    removed: z.literal(true),
  }),
} as const;

export type ToolName = keyof typeof outputSchemas;

interface ToolPresentation {
  readonly title: string;
  readonly annotations: Required<
    Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>
  >;
}

function presentation(
  title: string,
  readOnlyHint: boolean,
  destructiveHint: boolean,
  idempotentHint: boolean,
  openWorldHint: boolean,
): ToolPresentation {
  return {
    title,
    annotations: { readOnlyHint, destructiveHint, idempotentHint, openWorldHint },
  };
}

/** Reviewed UX/risk hints. These are never used as authorization. */
export const toolPresentation: Readonly<Record<ToolName, ToolPresentation>> = {
  browser_runtime_info: presentation('Inspect BrowserMesh runtime', true, false, true, false),
  browser_session_create: presentation(
    'Create isolated browser session',
    false,
    false,
    false,
    false,
  ),
  browser_session_list: presentation('List browser sessions', true, false, true, false),
  browser_session_get: presentation('Get browser session', true, false, true, false),
  browser_session_close: presentation('Close browser session', false, true, true, false),
  browser_page_create: presentation('Create browser page', false, false, false, false),
  browser_page_list: presentation('List browser pages', true, false, true, false),
  browser_page_close: presentation('Close browser page', false, true, false, false),
  browser_navigate: presentation('Navigate browser page', false, false, false, true),
  browser_back: presentation('Navigate browser page back', false, false, false, true),
  browser_forward: presentation('Navigate browser page forward', false, false, false, true),
  browser_reload: presentation('Reload browser page', false, false, false, true),
  browser_get_url: presentation('Get browser page URL', true, false, true, false),
  browser_get_title: presentation('Get browser page title', true, false, true, true),
  browser_snapshot: presentation('Get accessibility snapshot', true, false, true, true),
  browser_visible_text: presentation('Get visible page text', true, false, true, true),
  browser_console_list: presentation('List browser console events', true, false, true, true),
  browser_page_errors_list: presentation('List browser page errors', true, false, true, true),
  browser_network_list: presentation('List browser network events', true, false, true, true),
  browser_failed_requests_list: presentation(
    'List failed browser requests',
    true,
    false,
    true,
    true,
  ),
  browser_click: presentation('Click page element', false, true, false, true),
  browser_double_click: presentation('Double-click page element', false, true, false, true),
  browser_hover: presentation('Hover over page element', false, false, true, true),
  browser_focus: presentation('Focus page element', false, false, true, true),
  browser_check: presentation('Check page control', false, false, true, true),
  browser_uncheck: presentation('Uncheck page control', false, false, true, true),
  browser_scroll_into_view: presentation('Scroll page element into view', false, false, true, true),
  browser_scroll: presentation('Scroll browser page', false, false, false, true),
  browser_drag_and_drop: presentation('Drag and drop page element', false, true, false, true),
  browser_fill: presentation('Fill page field', false, false, false, true),
  browser_press: presentation('Press key on page element', false, true, false, true),
  browser_select_option: presentation('Select page option', false, false, false, true),
  browser_screenshot: presentation('Capture page screenshot', true, false, true, true),
  browser_wait: presentation('Wait for browser condition', true, false, true, true),
  browser_action_and_wait: presentation(
    'Perform browser action and wait',
    false,
    true,
    false,
    true,
  ),
  browser_state_save: presentation('Save browser state', false, true, false, false),
  browser_state_list: presentation('List saved browser states', true, false, true, false),
  browser_state_remove: presentation('Remove saved browser state', false, true, false, false),
};

export function contractFor(name: ToolName): {
  readonly title: string;
  readonly outputSchema: (typeof outputSchemas)[ToolName];
  readonly annotations: ToolAnnotations;
} {
  const metadata = toolPresentation[name];
  return {
    title: metadata.title,
    outputSchema: outputSchemas[name],
    annotations: { title: metadata.title, ...metadata.annotations },
  };
}
