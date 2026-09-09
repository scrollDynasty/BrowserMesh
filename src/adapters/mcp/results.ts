import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { asBrowserMeshError, type BrowserMeshErrorCode } from '../../domain/errors.js';

const MAX_MESSAGE_LENGTH = 512;
const MAX_CONTEXT_LENGTH = 256;
const installRemediation = 'Run: npx -y browsermesh --install-browser';
const safeOperations = new Set([
  'capture screenshot',
  'capture snapshot',
  'check',
  'click',
  'double-click',
  'drag',
  'fill',
  'focus',
  'hover over',
  'press',
  'read visible text',
  'scroll into view',
  'select option',
  'uncheck',
]);
const safeLocatorStrategies = new Set(['role', 'text', 'label', 'placeholder', 'testId', 'css']);
const safeFailureReasons = new Set([
  'timeout',
  'dns',
  'connection',
  'tls',
  'invalid_url',
  'locator_ambiguous',
  'element_not_found',
  'other',
]);

/**
 * What the caller should do next, keyed only by error code.
 *
 * The public message is deliberately fixed and says only what went wrong. That
 * protects the boundary but leaves the client with nothing to act on: the
 * remediation existed only in `docs-site/reference/errors.md`, which an agent
 * choosing its next tool call never reads. These strings put the same guidance
 * on the wire.
 *
 * Every value is a compile-time constant naming BrowserMesh tools and
 * arguments. Nothing here is interpolated from an error, a page, a locator, or
 * configuration, so the field cannot become a leak channel however the failure
 * arose (ADR 0022).
 */
const NEXT_STEPS: Readonly<Record<BrowserMeshErrorCode, string>> = {
  SESSION_NOT_FOUND:
    'Call browser_session_list to recover live sessionIds, or browser_session_create to start a new isolated session.',
  // readySession raises this for any non-ready status that is not closing,
  // closed, or failed-after-disconnect — so it covers both a session still
  // being created and one that failed to create without a Chromium disconnect.
  // The second is terminal and stays listable, so the next step must not tell
  // the caller to retry unconditionally.
  SESSION_NOT_READY:
    'Read the status with browser_session_get: "creating" resolves on its own, so retry the operation; "failed" is terminal, so create a replacement with browser_session_create.',
  SESSION_CLOSING:
    'Stop sending work to this session. Use another session, or browser_session_create for a fresh one.',
  SESSION_CLOSED:
    'This session and its pages are gone. Create a replacement with browser_session_create; pass stateId to restore saved authentication.',
  PAGE_NOT_FOUND:
    'Call browser_page_list for this sessionId to get its live pageIds. A pageId belonging to another session is always rejected.',
  // Raised from ~30 sites across the runtime, so this cannot assert one cause:
  // the fixed message already cannot name the field, and a next step that
  // guessed wrong would point the agent at an argument the call never sent.
  INVALID_ARGUMENT:
    'Re-read the tool inputSchema and check the per-argument bounds. Some are enforced by the runtime rather than the schema, so a value the schema accepts can still be rejected. browser_runtime_info reports the session, screenshot, visible-text, and persistence limits, but not the snapshot or observability bounds.',
  OPERATION_TIMEOUT:
    'A locator that matches nothing also times out. Confirm the element with browser_snapshot before raising timeoutMs, and try exact:false on a role locator whose name may not match the accessible name character for character.',
  // An in-flight browser action is not aborted: SerialQueue checks the signal
  // again only after the task resolves, so a cancelled click can already have
  // landed. Never tell the caller the operation was discarded.
  OPERATION_CANCELLED:
    'The client cancelled this call. Reissue it if the work is still wanted, unless the action may have already taken effect — confirm the page state first.',
  NAVIGATION_FAILED:
    'Check that the URL is absolute http(s) and reachable. browser_observe with source "requestFailed" reports the transport-level failure.',
  ELEMENT_NOT_FOUND:
    'Capture browser_snapshot with interactiveOnly:true to see what the page actually exposes, then target it by role, label, or test ID.',
  LOCATOR_AMBIGUOUS:
    'This locator matches more than one element. Narrow it with a role name, scope it to a container, or capture browser_snapshot with includeRefs:true and act on one ref.',
  STALE_ELEMENT_REFERENCE:
    'Refs expire 30 seconds after capture and do not survive navigation or another page. Capture browser_snapshot with includeRefs:true again, or use a semantic locator instead.',
  STALE_SNAPSHOT_CURSOR:
    'Snapshot cursors expire 30 seconds after capture and do not survive navigation. Call browser_snapshot again without a cursor and page through the fresh capture.',
  BROWSER_ERROR:
    'Call browser_runtime_info to check the launch state. If the details name a remediation, run it; otherwise retry the operation.',
  BROWSER_DISCONNECTED:
    'Chromium is gone and live sessions cannot be recovered. Create new sessions with browser_session_create; restore authentication from a saved stateId.',
  // Deliberately says nothing about where to report. Bug reporting reaches an
  // agent through the MCP instructions, which an operator can drop with
  // BROWSERMESH_AGENT_GUIDELINES=false (ADR 0021); repeating the solicitation
  // on the error channel would put it back past that opt-out.
  // asBrowserMeshError maps any unexpected throw here, including one raised
  // after the browser action completed, so the retry has to be qualified the
  // same way as OPERATION_CANCELLED.
  INTERNAL_ERROR:
    'Retry once, unless the action may have already taken effect — confirm the page state first. If it recurs, quote the operationId when reporting it.',
  // browser_runtime_info returns ResourceLimits plus the timeout and the
  // session and page counts. The snapshot bounds are fixed in the build and
  // browser_observe's limit is checked against configuration the tool does not
  // echo, so it must not be offered as the way to read back either one.
  LIMIT_EXCEEDED:
    'Ask for less: lower maxChars, maxBytes, maxRefs, or limit, scope a snapshot to one container, or close sessions you no longer need. browser_runtime_info reports the session, screenshot, visible-text, and persistence limits, but not the snapshot or observability bounds.',
  RUNTIME_SHUTTING_DOWN:
    'The server is shutting down and accepts no further browser work. Reconnect before retrying.',
  SAVED_STATE_NOT_FOUND:
    'Call browser_state_list for the stateIds this runtime holds, or save one first with browser_state_save.',
  PERSISTENCE_DISABLED:
    'This runtime was started without persistence. Continue without saved state, or ask the operator to start BrowserMesh with BROWSERMESH_PERSISTENCE=true.',
};

export async function structuredResult(
  action: () => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>,
  extraContent: (
    structured: Readonly<Record<string, unknown>>,
  ) => readonly ContentBlock[] = () => [],
): Promise<CallToolResult> {
  try {
    const structuredContent = await action();
    return {
      structuredContent,
      content: [
        ...extraContent(structuredContent),
        { type: 'text', text: JSON.stringify(structuredContent) },
      ],
    };
  } catch (error) {
    return applicationErrorResult(error);
  }
}

export function applicationErrorResult(error: unknown): CallToolResult {
  const mapped = asBrowserMeshError(error);
  const details = safeDetails(mapped.details, mapped.code);
  const publicError = {
    code: mapped.code,
    message: publicMessage(mapped.code, mapped.message, mapped.details),
    nextStep: NEXT_STEPS[mapped.code],
    ...(details === undefined ? {} : { details }),
    ...(mapped.operationId === undefined ? {} : { operationId: mapped.operationId }),
  };
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, error: publicError }),
      },
    ],
  };
}

function publicMessage(
  code: BrowserMeshErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> | undefined,
): string {
  const fixed: Partial<Record<BrowserMeshErrorCode, string>> = {
    SESSION_NOT_FOUND: 'The requested browser session was not found',
    SESSION_NOT_READY: 'The requested browser session is not ready',
    SESSION_CLOSING: 'The requested browser session is closing',
    PAGE_NOT_FOUND: 'The requested browser page was not found in the addressed session',
    SESSION_CLOSED: 'The requested browser session is closed',
    INVALID_ARGUMENT: 'The request contains an invalid argument',
    OPERATION_TIMEOUT: 'The browser operation timed out',
    OPERATION_CANCELLED: 'The browser operation was cancelled',
    NAVIGATION_FAILED: 'Navigation failed',
    ELEMENT_NOT_FOUND: 'The requested element was not found',
    LOCATOR_AMBIGUOUS: 'The locator matched multiple elements',
    STALE_ELEMENT_REFERENCE: 'The element reference is stale; capture a new snapshot and retry',
    STALE_SNAPSHOT_CURSOR: 'The snapshot cursor is stale; capture a new snapshot and retry',
    BROWSER_DISCONNECTED: 'Chromium disconnected and the existing session cannot be recovered',
    INTERNAL_ERROR: 'An unexpected internal error occurred',
    LIMIT_EXCEEDED: 'A configured BrowserMesh resource limit was exceeded',
    RUNTIME_SHUTTING_DOWN: 'The BrowserMesh runtime is shutting down',
    SAVED_STATE_NOT_FOUND: 'The requested saved browser state was not found',
    PERSISTENCE_DISABLED: 'Browser state persistence is disabled',
  };
  if (code === 'BROWSER_ERROR') {
    return hasInstallRemediation(details)
      ? `Chromium could not be started. ${installRemediation}`
      : 'The browser operation failed';
  }
  return truncate(fixed[code] ?? message, MAX_MESSAGE_LENGTH);
}

function hasInstallRemediation(details: Readonly<Record<string, unknown>> | undefined): boolean {
  try {
    return details?.remediation === installRemediation;
  } catch {
    return false;
  }
}

function safeDetails(
  details: Readonly<Record<string, unknown>> | undefined,
  code: BrowserMeshErrorCode,
): Readonly<Record<string, unknown>> | undefined {
  const sanitized: Record<string, unknown> = {};
  const fallbackReason = defaultReason(code);
  if (fallbackReason !== undefined) sanitized.reason = fallbackReason;
  if (details === undefined) return Object.keys(sanitized).length === 0 ? undefined : sanitized;
  try {
    const timeoutMs = safeRead(details, 'timeoutMs');
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
      sanitized.timeoutMs = Math.max(0, Math.min(300_000, timeoutMs));
    }
    const reason = safeRead(details, 'reason');
    if (typeof reason === 'string' && safeFailureReasons.has(reason)) sanitized.reason = reason;
    const operation = safeRead(details, 'operation');
    if (typeof operation === 'string' && safeOperations.has(operation)) {
      sanitized.operation = operation;
    }
    if (safeRead(details, 'remediation') === installRemediation) {
      sanitized.remediation = installRemediation;
    }
    const url = safeRead(details, 'url');
    if (typeof url === 'string') sanitized.url = safeUrl(url);
    const locator = safeRead(details, 'locator');
    if (typeof locator === 'object' && locator !== null) {
      const locatorRecord = locator as Readonly<Record<string, unknown>>;
      const strategy = safeRead(locatorRecord, 'strategy');
      if (typeof strategy === 'string' && safeLocatorStrategies.has(strategy)) {
        const value = safeRead(locatorRecord, 'value');
        const name = safeRead(locatorRecord, 'name');
        const exact = safeRead(locatorRecord, 'exact');
        sanitized.locator = {
          strategy,
          ...(typeof value === 'string' ? { value: safeContext(value) } : {}),
          ...(typeof name === 'string' ? { name: safeContext(name) } : {}),
          ...(typeof exact === 'boolean' ? { exact } : {}),
        };
      }
    }
  } catch {
    // Individual reads are guarded; this is a final defense against hostile exotic objects.
  }
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function defaultReason(code: BrowserMeshErrorCode): string | undefined {
  switch (code) {
    case 'OPERATION_TIMEOUT':
      return 'timeout';
    case 'LOCATOR_AMBIGUOUS':
      return 'locator_ambiguous';
    case 'ELEMENT_NOT_FOUND':
      return 'element_not_found';
    case 'NAVIGATION_FAILED':
    case 'BROWSER_ERROR':
    case 'BROWSER_DISCONNECTED':
      return 'other';
    default:
      return undefined;
  }
}

function safeRead(record: Readonly<Record<string, unknown>>, key: string): unknown {
  try {
    return Reflect.get(record, key);
  } catch {
    return undefined;
  }
}

function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '<redacted-url>';
    return truncate(`${parsed.origin}${parsed.pathname}`, MAX_CONTEXT_LENGTH);
  } catch {
    return '<invalid-url>';
  }
}

function safeContext(value: string): string {
  const bounded = Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point > 31 && (point < 127 || point > 159);
    })
    .join('');
  return truncate(bounded, MAX_CONTEXT_LENGTH);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
