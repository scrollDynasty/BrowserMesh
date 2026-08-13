import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { asBrowserMeshError, type BrowserMeshErrorCode } from '../../domain/errors.js';

const MAX_MESSAGE_LENGTH = 512;
const MAX_CONTEXT_LENGTH = 256;
const installRemediation = 'Run: npx -y multi-agent-browser-mcp --install-browser';
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
