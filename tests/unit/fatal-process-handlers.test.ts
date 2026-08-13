import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  formatFatalDiagnostic,
  installFatalProcessHandlers,
  type FatalEventSource,
} from '../../src/infrastructure/fatal-process-handlers.js';

const diagnosticSchema = z.object({
  level: z.literal('error'),
  code: z.literal('INTERNAL_ERROR'),
  message: z.string().max(128),
});

describe('fatal process diagnostics', () => {
  it('does not inspect or expose secret-bearing and hostile fatal reasons', () => {
    const secret = 'fatal-token-do-not-expose';
    const throwingGetter = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwingGetter, 'message', {
      get: () => {
        throw new Error(secret);
      },
    });
    const hostileProxy = new Proxy(
      {},
      {
        get: () => {
          throw new Error(secret);
        },
      },
    );

    for (const reason of [new Error(secret), { message: secret }, throwingGetter, hostileProxy]) {
      const diagnostic = formatFatalDiagnostic(reason);
      expect(() => {
        JSON.parse(diagnostic) as unknown;
      }).not.toThrow();
      const parsed: unknown = JSON.parse(diagnostic);
      expect(diagnosticSchema.parse(parsed)).toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(diagnostic).not.toContain(secret);
      expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThan(256);
    }
  });

  it('reports cleanup failure without exposing its raw cause', () => {
    const diagnostic = formatFatalDiagnostic(new Error('password=cleanup-secret'), true);
    const parsed: unknown = JSON.parse(diagnostic);
    expect(diagnosticSchema.parse(parsed).message).toContain('cleanup failed');
    expect(diagnostic).not.toContain('cleanup-secret');
    expect(diagnostic).not.toContain('password');
  });

  it.each([false, true])(
    'cleans up, reports safely, exits non-zero, and disposes listeners (cleanup failure: %s)',
    async (cleanupFails) => {
      const events = new FakeFatalEvents();
      const writes: string[] = [];
      const output = {
        write(value: string): void {
          writes.push(value);
          if (value.includes('first-write-failure')) throw new Error('broken stderr');
        },
      };
      const shutdown = vi.fn(async () => {
        if (cleanupFails) throw new Error('token=cleanup-secret');
      });
      let resolveExit!: (code: number) => void;
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve;
      });
      const dispose = installFatalProcessHandlers({
        shutdown,
        output,
        exit: resolveExit,
        events,
      });
      events.unhandled?.(new Proxy({}, { get: () => new Error('token=reason-secret') }));
      events.uncaught?.(new Error('second fatal must not start another cleanup'));

      await expect(exited).resolves.toBe(1);
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(writes).toHaveLength(cleanupFails ? 2 : 1);
      expect(writes.join('')).not.toContain('secret');
      dispose();
      expect(events.offUncaughtCalls).toBe(1);
      expect(events.offUnhandledCalls).toBe(1);
    },
  );

  it('still performs cleanup and exit when stderr itself throws', async () => {
    const events = new FakeFatalEvents();
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const shutdown = vi.fn(async () => undefined);
    installFatalProcessHandlers({
      shutdown,
      output: {
        write(): never {
          throw new Error('stderr unavailable');
        },
      },
      exit: resolveExit,
      events,
    });
    events.uncaught?.(new Error('fatal'));
    await expect(exited).resolves.toBe(1);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

class FakeFatalEvents implements FatalEventSource {
  uncaught: ((reason: unknown) => void) | undefined;
  unhandled: ((reason: unknown) => void) | undefined;
  offUncaughtCalls = 0;
  offUnhandledCalls = 0;

  onceUncaught(listener: (reason: unknown) => void): void {
    this.uncaught = listener;
  }

  onceUnhandled(listener: (reason: unknown) => void): void {
    this.unhandled = listener;
  }

  offUncaught(listener: (reason: unknown) => void): void {
    expect(listener).toBe(this.uncaught);
    this.offUncaughtCalls += 1;
  }

  offUnhandled(listener: (reason: unknown) => void): void {
    expect(listener).toBe(this.unhandled);
    this.offUnhandledCalls += 1;
  }
}
