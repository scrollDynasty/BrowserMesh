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
  geolocation: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(100_000).optional(),
    })
    .optional(),
  permissions: z
    .array(
      z.object({
        permission: z.literal('geolocation'),
        origin: safeContextText(2_000),
      }),
    )
    .max(100)
    .optional(),
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
const locatorSelectorSchema = z.discriminatedUnion('strategy', [
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
const frameScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('main') }),
  z.object({
    kind: z.literal('iframe'),
    chain: z.array(locatorSelectorSchema).min(1).max(5),
  }),
]);
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
    frame: frameScopeSchema.optional(),
  }),
  z.object({
    strategy: z.enum(['text', 'label', 'placeholder', 'testId', 'css']),
    value: z.string(),
    frame: frameScopeSchema.optional(),
  }),
]);
const nullableLocatorSchema = locatorSchema.nullable();
const waitedEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigation'), url: z.string() }),
  z.object({
    kind: z.literal('response'),
    url: z.string(),
    method: z.string().optional(),
    status: z.number().int().optional(),
  }),
  z.object({ kind: z.literal('popup'), page: pageViewSchema }),
  z.object({
    kind: z.literal('dialog'),
    dialogType: z.enum(['alert', 'beforeunload', 'confirm', 'prompt']),
    action: z.enum(['accept', 'dismiss']),
    message: z.string(),
    defaultValue: z.string(),
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
/**
 * The four observation sources a page records. They differ only in which
 * events they select, so they are selected by argument rather than by four
 * tools carrying four copies of one contract (ADR 0020).
 */
export const observationSources = ['console', 'pageError', 'network', 'requestFailed'] as const;
export type ObservationSource = (typeof observationSources)[number];

const observationList = {
  ...pageOperation,
  source: z.enum(observationSources),
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
    resourceLimits: z.object({
      session: z.object({
        maxNameChars: z.number().int().positive(),
        maxNameBytes: z.number().int().positive(),
        maxMetadataEntries: z.number().int().positive(),
        maxMetadataKeyChars: z.number().int().positive(),
        maxMetadataKeyBytes: z.number().int().positive(),
        maxMetadataValueChars: z.number().int().positive(),
        maxMetadataValueBytes: z.number().int().positive(),
        maxMetadataBytes: z.number().int().positive(),
      }),
      screenshot: z.object({
        maxDimensionPixels: z.number().int().positive(),
        maxPixels: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
      }),
      visibleText: z.object({
        maxChars: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
      }),
      persistence: z.object({
        maxStates: z.number().int().positive(),
        maxStateBytes: z.number().int().positive(),
        maxTotalBytes: z.number().int().positive(),
      }),
    }),
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
      interactiveOnly: z.boolean(),
      maxChildren: z.number().int().positive().nullable(),
    }),
    omissions: z.object({
      nonInteractiveNodes: z.number().int().nonnegative(),
      maxChildrenNodes: z.number().int().nonnegative(),
      sourceLimitReached: z.boolean(),
    }),
    pagination: z.object({
      snapshotId: z.string().nullable(),
      nextCursor: z.string().nullable(),
      offsetChars: z.number().int().nonnegative(),
      expiresAt: z.iso.datetime().nullable(),
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
  browser_visible_text: z.object({
    ...pageOperation,
    text: z.string(),
    truncation: z.object({
      truncated: z.boolean(),
      originalChars: z.number().int().nonnegative(),
      originalBytes: z.number().int().nonnegative(),
      returnedChars: z.number().int().nonnegative(),
      returnedBytes: z.number().int().nonnegative(),
      maxChars: z.number().int().positive(),
      maxBytes: z.number().int().positive(),
    }),
  }),
  browser_observe: z.object(observationList),
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
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
  }),
  // Neither result restates the request. The caller already holds the
  // condition, action, and wait it sent, and `operationId` correlates the
  // result without them; `event` reports what was actually observed, which is
  // the only part the caller could not already know. Echoing the arguments back
  // put the whole locator union on the result side of the two largest
  // contracts for no information (ADR 0020).
  browser_wait: z.object({ ...pageOperation, satisfied: z.literal(true) }),
  browser_action_and_wait: z.object({ ...pageOperation, event: waitedEventSchema }),
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
  browser_observe: presentation('Read page observations', true, false, true, true),
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
