export const errorCodes = [
  'SESSION_NOT_FOUND',
  'SESSION_NOT_READY',
  'SESSION_CLOSING',
  'PAGE_NOT_FOUND',
  'SESSION_CLOSED',
  'INVALID_ARGUMENT',
  'OPERATION_TIMEOUT',
  'NAVIGATION_FAILED',
  'ELEMENT_NOT_FOUND',
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

  constructor(
    code: BrowserMeshErrorCode,
    message: string,
    options: { cause?: unknown; details?: Readonly<Record<string, unknown>> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BrowserMeshError';
    this.code = code;
    this.details = options.details;
  }
}

export function asBrowserMeshError(error: unknown): BrowserMeshError {
  if (error instanceof BrowserMeshError) return error;
  return new BrowserMeshError('INTERNAL_ERROR', 'An unexpected internal error occurred', {
    cause: error,
  });
}
