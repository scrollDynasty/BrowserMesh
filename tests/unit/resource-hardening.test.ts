import { describe, expect, it } from 'vitest';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/domain/resource-limits.js';
import { FakeEngine, testRuntime } from '../support/fakes.js';

const png = (width: number, height: number, bytes = 24): Uint8Array => {
  const value = Buffer.alloc(Math.max(bytes, 24));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
};

describe('runtime resource hardening', () => {
  it('rejects unsafe or excessive session labels before allocating a browser context', async () => {
    const { runtime, engine } = testRuntime();
    const dangerous = Object.create(null) as Record<string, string>;
    dangerous.__proto__ = 'pollute';

    await expect(runtime.createSession({ name: 'bad\nname' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(runtime.createSession({ metadata: dangerous })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      runtime.createSession({ metadata: { label: 'x'.repeat(513) } }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(engine.contexts).toHaveLength(0);
    expect((await runtime.listSessions()).value).toEqual([]);
    await runtime.shutdown();
  });

  it('truncates visible text on Unicode code-point and UTF-8 boundaries with explicit metadata', async () => {
    const resources = {
      ...DEFAULT_RESOURCE_LIMITS,
      visibleText: { maxChars: 10, maxBytes: 5 },
    };
    const { runtime } = testRuntime(new FakeEngine(), { resources });
    await runtime.start();
    const created = await runtime.createSession();
    const result = await runtime.visibleText(
      { sessionId: created.sessionId, pageId: created.pageId },
      { strategy: 'text', value: 'a😀b' },
    );
    expect(result.value).toBe('a😀');
    expect(result.truncation).toEqual({
      truncated: true,
      originalChars: 3,
      originalBytes: 6,
      returnedChars: 2,
      returnedBytes: 5,
      maxChars: 10,
      maxBytes: 5,
    });
    await runtime.shutdown();
  });

  it('enforces screenshot preflight and encoded quotas without poisoning the session queue', async () => {
    class OversizedEngine extends FakeEngine {
      oversizedDimensions = true;
      oversizedBytes = false;
      override async screenshotDimensions(): Promise<{ width: number; height: number }> {
        return this.oversizedDimensions ? { width: 101, height: 1 } : { width: 1, height: 1 };
      }
      override async screenshot(): Promise<Uint8Array> {
        return this.oversizedBytes ? png(1, 1, 65) : png(1, 1);
      }
    }
    const engine = new OversizedEngine();
    const resources = {
      ...DEFAULT_RESOURCE_LIMITS,
      screenshot: { maxDimensionPixels: 100, maxPixels: 10_000, maxBytes: 64 },
    };
    const { runtime } = testRuntime(engine, { resources });
    await runtime.start();
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    await expect(runtime.screenshot(target)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    engine.oversizedDimensions = false;
    engine.oversizedBytes = true;
    await expect(runtime.screenshot(target)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    engine.oversizedBytes = false;
    await expect(runtime.screenshot(target)).resolves.toMatchObject({
      width: 1,
      height: 1,
      bytes: 24,
    });
    await expect(
      runtime.visibleText(target, { strategy: 'text', value: 'queue recovered' }),
    ).resolves.toMatchObject({ value: 'queue recovered' });
    await runtime.shutdown();
  });
});
