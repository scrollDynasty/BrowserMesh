import { describe, expect, it } from 'vitest';
import { testRuntime } from '../support/fakes.js';

describe('bounded browser observability', () => {
  it('uses stable page-owned cursors and reports overflow gaps', async () => {
    const { runtime, engine } = testRuntime(undefined, {
      observability: {
        maxEventsPerPage: 2,
        maxStringLength: 128,
        maxPageSize: 2,
        maxResponseBytes: 4_096,
      },
    });
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    const handle = required(Array.from(engine.pages.values())[0]);
    engine.emitObservation(handle, { kind: 'console', level: 'log', text: 'first' });
    const checkpoint = (await runtime.listConsole(target, { includeText: false })).value;
    expect(checkpoint.events[0]).not.toHaveProperty('text');
    const cursor = required(checkpoint.nextCursor);

    engine.emitObservation(handle, { kind: 'console', level: 'warning', text: 'second' });
    engine.emitObservation(handle, { kind: 'console', level: 'error', text: 'third' });
    engine.emitObservation(handle, {
      kind: 'console',
      level: 'error',
      text: 'token=unsafe fourth',
    });

    const firstPage = (
      await runtime.listConsole(target, { sinceEventId: cursor, limit: 1, includeText: true })
    ).value;
    expect(firstPage).toMatchObject({ droppedCount: 2, gap: true });
    expect(firstPage.events).toHaveLength(1);
    const secondPage = (
      await runtime.listConsole(target, {
        sinceEventId: required(firstPage.nextCursor),
        limit: 1,
        includeText: true,
      })
    ).value;
    expect(secondPage.events[0]?.text).toBe('token=[REDACTED] fourth');
    expect(secondPage.nextCursor).not.toBe(firstPage.nextCursor);

    const other = await runtime.createPage(created.sessionId);
    await expect(
      runtime.listConsole(
        { sessionId: created.sessionId, pageId: other.pageId },
        { sinceEventId: cursor },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await runtime.shutdown();
  });

  it('bounds strings and the serialized list, and cleans a failed page subscription', async () => {
    const { runtime, engine } = testRuntime(undefined, {
      observability: {
        maxEventsPerPage: 20,
        maxStringLength: 128,
        maxPageSize: 20,
        maxResponseBytes: 1_200,
      },
    });
    const created = await runtime.createSession();
    const handle = required(Array.from(engine.pages.values())[0]);
    for (let index = 0; index < 20; index += 1)
      engine.emitObservation(handle, { kind: 'console', level: 'log', text: 'x'.repeat(1_000) });
    const listed = await runtime.listConsole(created, { includeText: true, limit: 20 });
    expect(Buffer.byteLength(JSON.stringify(listed), 'utf8')).toBeLessThanOrEqual(1_200);
    expect(listed.value.events.length).toBeGreaterThan(0);
    expect(listed.value.events.every((event) => (event.text?.length ?? 0) <= 128)).toBe(true);

    engine.failNextObserve = true;
    await expect(runtime.createPage(created.sessionId)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred',
    });
    expect(engine.pages.size).toBe(1);
    expect(engine.observerCount).toBe(1);
    await runtime.shutdown();
  });

  it('separates page errors and detaches every listener on lifecycle cleanup', async () => {
    const { runtime, engine } = testRuntime();
    const first = await runtime.createSession();
    const second = await runtime.createSession();
    expect(engine.observerCount).toBe(2);
    const handles = Array.from(engine.pages.values());
    engine.emitObservation(required(handles[0]), {
      kind: 'page_error',
      text: 'password=hunter2 exploded',
    });
    expect((await runtime.listConsole(first, { includeText: true })).value.events).toEqual([]);
    expect((await runtime.listPageErrors(first, { includeText: true })).value.events[0]?.text).toBe(
      'password=[REDACTED] exploded',
    );
    expect((await runtime.listPageErrors(second, { includeText: true })).value.events).toEqual([]);

    await runtime.closePage(first.sessionId, first.pageId);
    expect(engine.observerCount).toBe(1);
    engine.disconnect();
    expect(engine.observerCount).toBe(0);
    await runtime.shutdown();
  });

  it('serializes reads behind live work and recovers after a bad cursor', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    let release!: () => void;
    engine.navigationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let navigationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      navigationStarted = resolve;
    });
    engine.onNavigationStart = navigationStarted;
    const navigation = runtime.navigate(created, 'https://example.test/slow');
    await started;
    let readSettled = false;
    const read = runtime.listConsole(created, {}).finally(() => {
      readSettled = true;
    });
    await Promise.resolve();
    expect(readSettled).toBe(false);
    release();
    await Promise.all([navigation, read]);

    await expect(runtime.listConsole(created, { sinceEventId: 'foreign' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(runtime.getTitle(created)).resolves.toMatchObject({ value: 'Fake' });
    await runtime.shutdown();
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected test value');
  return value;
}
