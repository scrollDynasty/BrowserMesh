import { describe, expect, it } from 'vitest';
import { sanitizeObservationUrl } from '../../src/domain/observability.js';
import { testRuntime } from '../support/fakes.js';

describe('network observability safety and ownership', () => {
  it('removes credentials/fragments and redacts encoded sensitive query keys before bounding URLs', () => {
    const sanitized = sanitizeObservationUrl(
      'https://user:password@example.test/path?%2574oken=secret&safe=visible#private',
      180,
    );
    expect(sanitized).not.toContain('user');
    expect(sanitized).not.toContain('password');
    expect(sanitized).not.toContain('private');
    expect(sanitized).not.toContain('secret');
    expect(sanitized).toContain('%5BREDACTED%5D');
    const longPath = sanitizeObservationUrl(`https://example.test/${'p'.repeat(400)}`, 180);
    expect(Array.from(longPath ?? '')).toHaveLength(180);
    expect(sanitizeObservationUrl('data:text/plain,secret', 100)).toBeNull();
    expect(sanitizeObservationUrl('blob:https://example.test/id', 100)).toBeNull();
    expect(sanitizeObservationUrl('wss://example.test/socket?token=secret', 100)).toBeNull();
  });

  it('correlates bounded metadata, reports mixed-store overflow, and keeps stable cursors', async () => {
    const { runtime, engine } = testRuntime(undefined, {
      observability: {
        maxEventsPerPage: 3,
        maxStringLength: 128,
        maxPageSize: 2,
        maxResponseBytes: 4_096,
      },
    });
    const created = await runtime.createSession();
    const handle = required(Array.from(engine.pages.values())[0]);
    engine.emitObservation(handle, networkEvent('request', 'one'));
    const checkpoint = (await runtime.listNetwork(created, { limit: 1 })).value;
    const cursor = required(checkpoint.nextCursor);
    engine.emitObservation(handle, networkEvent('response', 'one'));
    engine.emitObservation(handle, networkEvent('request', 'two'));
    engine.emitObservation(handle, networkEvent('response', 'two'));
    engine.emitObservation(handle, networkEvent('request', 'three'));

    const first = (await runtime.listNetwork(created, { sinceEventId: cursor, limit: 1 })).value;
    expect(first).toMatchObject({ droppedCount: 2, gap: true });
    expect(first.events).toHaveLength(1);
    const second = (
      await runtime.listNetwork(created, {
        sinceEventId: required(first.nextCursor),
        limit: 2,
      })
    ).value;
    expect(second.events).toHaveLength(2);
    expect(second.nextCursor).not.toBe(first.nextCursor);
    const repeated = (
      await runtime.listNetwork(created, {
        sinceEventId: required(second.nextCursor),
      })
    ).value;
    expect(repeated.events).toEqual([]);
    expect(repeated.nextCursor).toBe(second.nextCursor);
    await runtime.shutdown();
  });

  it('separates failed requests across pages and sessions and detaches on close/disconnect', async () => {
    const { runtime, engine } = testRuntime();
    const first = await runtime.createSession();
    const second = await runtime.createSession();
    const firstHandle = required(Array.from(engine.pages.values())[0]);
    engine.emitObservation(firstHandle, {
      kind: 'request_failed',
      requestId: 'failure_1',
      method: 'post-with-an-unreasonably-long-method',
      url: 'https://user:password@example.test/fail?api%5Fkey=secret#fragment',
      resourceType: 'fetch-with-an-unreasonably-long-resource-type',
      durationMs: Number.POSITIVE_INFINITY,
      failure: `Bearer private-token ${'x'.repeat(5_000)}`,
    });
    const failures = (await runtime.listFailedRequests(first, {})).value.events;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.method?.length).toBeLessThanOrEqual(32);
    expect(failures[0]?.resourceType?.length).toBeLessThanOrEqual(64);
    expect(failures[0]?.durationMs).toBe(0);
    expect(failures[0]?.failure).not.toContain('private-token');
    expect(failures[0]?.url).not.toContain('secret');
    expect((await runtime.listFailedRequests(second, {})).value.events).toEqual([]);
    await expect(
      runtime.listFailedRequests({ sessionId: second.sessionId, pageId: first.pageId }, {}),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    await runtime.closePage(first.sessionId, first.pageId);
    expect(engine.observerCount).toBe(1);
    engine.disconnect();
    expect(engine.observerCount).toBe(0);
    await runtime.shutdown();
  });
});

function networkEvent(kind: 'request' | 'response', id: string) {
  const common = {
    requestId: id,
    method: 'GET',
    url: `https://example.test/${id}?token=secret`,
    resourceType: 'fetch',
  } as const;
  return kind === 'request'
    ? ({ kind, ...common } as const)
    : ({ kind, ...common, status: 200, durationMs: 10 } as const);
}

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected test value');
  return value;
}
