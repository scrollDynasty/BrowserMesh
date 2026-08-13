import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { asBrowserMeshError, type BrowserMeshErrorCode } from '../../domain/errors.js';

const MAX_MESSAGE_LENGTH = 512;
const installRemediation = 'Run: npx -y multi-agent-browser-mcp --install-browser';
const safeOperations = new Set(['click', 'fill', 'press', 'select option', 'read visible text']);
const safeLocatorStrategies = new Set(['role', 'text', 'label', 'placeholder', 'testId', 'css']);

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
  const details = safeDetails(mapped.details);
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
    NAVIGATION_FAILED: 'Navigation failed',
    ELEMENT_NOT_FOUND: 'The requested element was not found',
    LOCATOR_AMBIGUOUS: 'The locator matched multiple elements',
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
): Readonly<Record<string, unknown>> | undefined {
  if (details === undefined) return undefined;
  try {
    const sanitized: Record<string, unknown> = {};
    const timeoutMs = details.timeoutMs;
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
      sanitized.timeoutMs = timeoutMs;
    }
    const operation = details.operation;
    if (typeof operation === 'string' && safeOperations.has(operation)) {
      sanitized.operation = operation;
    }
    if (details.remediation === installRemediation) {
      sanitized.remediation = installRemediation;
    }
    const locator = details.locator;
    if (typeof locator === 'object' && locator !== null) {
      const locatorRecord = locator as Readonly<Record<string, unknown>>;
      const strategy = locatorRecord.strategy;
      if (typeof strategy === 'string' && safeLocatorStrategies.has(strategy)) {
        sanitized.locator = {
          strategy,
          ...(typeof locatorRecord.exact === 'boolean' ? { exact: locatorRecord.exact } : {}),
        };
      }
    }
    return Object.keys(sanitized).length === 0 ? undefined : sanitized;
  } catch {
    // Untrusted detail objects may contain getters/proxies; omitting details is always safe.
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
