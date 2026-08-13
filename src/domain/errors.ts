export const errorCodes = [
  'SESSION_NOT_FOUND',
  'SESSION_NOT_READY',
  'SESSION_CLOSING',
  'PAGE_NOT_FOUND',
  'SESSION_CLOSED',
  'INVALID_ARGUMENT',
  'OPERATION_TIMEOUT',
  'OPERATION_CANCELLED',
  'NAVIGATION_FAILED',
  'ELEMENT_NOT_FOUND',
  'LOCATOR_AMBIGUOUS',
  'STALE_ELEMENT_REFERENCE',
  'STALE_SNAPSHOT_CURSOR',
  'BROWSER_ERROR',
  'BROWSER_DISCONNECTED',
  'INTERNAL_ERROR',
  'LIMIT_EXCEEDED',
  'RUNTIME_SHUTTING_DOWN',
  'SAVED_STATE_NOT_FOUND',
  'PERSISTENCE_DISABLED',
] as const;

export type BrowserMeshErrorCode = (typeof errorCodes)[number];

export class BrowserMeshError extends Error {
  readonly code: BrowserMeshErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly operationId: string | undefined;

  constructor(
    code: BrowserMeshErrorCode,
    message: string,
    options: {
      cause?: unknown;
      details?: Readonly<Record<string, unknown>>;
      operationId?: string;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BrowserMeshError';
    this.code = code;
    this.details = options.details;
    this.operationId = options.operationId;
  }
}

/** Attach runtime correlation without mutating or exposing an error's raw cause. */
export function correlateBrowserMeshError(error: unknown, operationId: string): BrowserMeshError {
  const mapped = asBrowserMeshError(error);
  if (mapped.operationId !== undefined) return mapped;
  return new BrowserMeshError(mapped.code, mapped.message, {
    cause: mapped,
    ...(mapped.details === undefined ? {} : { details: mapped.details }),
    operationId,
  });
}

export function asBrowserMeshError(error: unknown): BrowserMeshError {
  if (error instanceof BrowserMeshError) return error;
  return new BrowserMeshError('INTERNAL_ERROR', 'An unexpected internal error occurred', {
    cause: error,
  });
}
