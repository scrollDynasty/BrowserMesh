const FATAL_MESSAGE = 'BrowserMesh encountered a fatal internal error and is shutting down';
const CLEANUP_FAILURE_MESSAGE = 'BrowserMesh fatal shutdown cleanup failed; exiting';

export interface FatalEventSource {
  onceUncaught(listener: (reason: unknown) => void): void;
  onceUnhandled(listener: (reason: unknown) => void): void;
  offUncaught(listener: (reason: unknown) => void): void;
  offUnhandled(listener: (reason: unknown) => void): void;
}

interface FatalProcessHandlerOptions {
  readonly shutdown: () => Promise<void>;
  readonly output?: { write(value: string): unknown };
  readonly exit?: (code: number) => void;
  readonly events?: FatalEventSource;
}

/**
 * Produce one stable diagnostic without inspecting an untrusted fatal reason.
 * Fatal reasons may contain browser data, local paths, hostile getters, or cycles.
 */
export function formatFatalDiagnostic(_reason: unknown, cleanupFailed = false): string {
  return JSON.stringify({
    level: 'error',
    code: 'INTERNAL_ERROR',
    message: cleanupFailed ? CLEANUP_FAILURE_MESSAGE : FATAL_MESSAGE,
  });
}

/** Install process-wide fatal handlers that report safely, clean up, and exit non-zero. */
export function installFatalProcessHandlers(options: FatalProcessHandlerOptions): () => void {
  const output = options.output ?? process.stderr;
  const exit = options.exit ?? ((code: number): never => process.exit(code));
  const events =
    options.events ??
    ({
      onceUncaught: (listener) => process.once('uncaughtException', listener),
      onceUnhandled: (listener) => process.once('unhandledRejection', listener),
      offUncaught: (listener) => process.off('uncaughtException', listener),
      offUnhandled: (listener) => process.off('unhandledRejection', listener),
    } satisfies FatalEventSource);
  let handling = false;

  const writeDiagnostic = (reason: unknown, cleanupFailed = false): void => {
    try {
      output.write(`${formatFatalDiagnostic(reason, cleanupFailed)}\n`);
    } catch {
      // A broken stderr cannot be repaired here; cleanup and non-zero exit still proceed.
    }
  };

  const handleFatal = (reason: unknown): void => {
    if (handling) return;
    handling = true;
    writeDiagnostic(reason);
    void options.shutdown().then(
      () => exit(1),
      (cleanupError: unknown) => {
        writeDiagnostic(cleanupError, true);
        exit(1);
      },
    );
  };

  events.onceUncaught(handleFatal);
  events.onceUnhandled(handleFatal);
  return () => {
    events.offUncaught(handleFatal);
    events.offUnhandled(handleFatal);
  };
}
