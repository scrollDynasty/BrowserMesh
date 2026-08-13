/** Engine-independent control metadata owned by the application/runtime layer. */
export interface OperationControl {
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly deadlineAt: number;
}

export function createOperationControl(
  timeoutMs: number,
  signal?: AbortSignal,
  now: () => number = Date.now,
): OperationControl {
  return { signal, timeoutMs, deadlineAt: now() + timeoutMs };
}

/**
 * Throw the sender's cancellation reason without translating it into a public tool result.
 * MCP owns request cancellation and normally exposes this to its client as AbortError.
 */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === 'AbortError') throw signal.reason;
  throw new DOMException(
    signal.reason === undefined
      ? 'The operation was aborted'
      : signal.reason instanceof Error
        ? signal.reason.message
        : String(signal.reason),
    'AbortError',
  );
}

export function isCancellation(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}
