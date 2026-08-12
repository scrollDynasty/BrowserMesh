import { describe, expect, it } from 'vitest';
import { FakeEngine, testRuntime } from '../support/fakes.js';

describe('BrowserMeshRuntime', () => {
  it('returns the initial page, correlates operations, and closes idempotently', async () => {
    const { runtime, engine } = testRuntime();
    const createdA = await runtime.createSession({ name: 'a' });
    const createdB = await runtime.createSession({ name: 'b' });
    expect(createdA.sessionId).not.toBe(createdB.sessionId);
    expect(createdA.pageId).toMatch(/^page_/);
    expect(createdA.operationId).toMatch(/^operation_/);
    expect(engine.contexts.size).toBe(2);
    const pages = await runtime.listPages(createdA.sessionId);
    expect(pages.value).toHaveLength(1);
    expect(pages.value[0]?.pageId).toBe(createdA.pageId);
    expect(pages.operationId).not.toBe(createdA.operationId);
    expect((await runtime.closeSession(createdA.sessionId)).value.status).toBe('closed');
    expect((await runtime.closeSession(createdA.sessionId)).value.status).toBe('closed');
    expect(engine.contexts.size).toBe(1);
    await runtime.shutdown();
    expect(engine.contexts.size).toBe(0);
  });

  it('serializes one session but runs different sessions concurrently', async () => {
    const { runtime, engine } = testRuntime();
    engine.delayMs = 20;
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    await Promise.all([
      runtime.navigate({ sessionId: a.sessionId, pageId: a.pageId }, 'https://a.example/1'),
      runtime.navigate({ sessionId: a.sessionId, pageId: a.pageId }, 'https://a.example/2'),
      runtime.navigate({ sessionId: b.sessionId, pageId: b.pageId }, 'https://b.example/1'),
    ]);
    expect(engine.maxActiveGlobal).toBeGreaterThan(1);
    expect([...engine.maxActiveByContext.values()]).toEqual([1, 1]);
    expect((await runtime.getUrl({ sessionId: a.sessionId, pageId: a.pageId })).value).toBe(
      'https://a.example/2',
    );
    await runtime.shutdown();
  });

  it('rejects cross-session page references and operations after close', async () => {
    const { runtime } = testRuntime();
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    await expect(
      runtime.getUrl({ sessionId: a.sessionId, pageId: b.pageId }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    await runtime.closeSession(a.sessionId);
    await expect(runtime.createPage(a.sessionId)).rejects.toMatchObject({
      code: 'SESSION_CLOSED',
    });
    await runtime.shutdown();
  });

  it('creates, lists, and closes pages in the addressed session registry', async () => {
    const { runtime, engine } = testRuntime();
    const session = await runtime.createSession();
    const created = await runtime.createPage(session.sessionId);
    expect(created.sessionId).toBe(session.sessionId);
    expect((await runtime.listPages(session.sessionId)).value.map(({ pageId }) => pageId)).toEqual([
      session.pageId,
      created.pageId,
    ]);
    await runtime.closePage(session.sessionId, created.pageId);
    expect((await runtime.listPages(session.sessionId)).value.map(({ pageId }) => pageId)).toEqual([
      session.pageId,
    ]);
    expect(engine.pages.size).toBe(1);
    await runtime.shutdown();
  });

  it('recovers its session queue after a browser operation fails', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    engine.failNextNavigation = true;
    await expect(runtime.navigate(target, 'https://failure.example')).rejects.toMatchObject({
      code: 'NAVIGATION_FAILED',
    });
    await expect(runtime.navigate(target, 'https://success.example')).resolves.toMatchObject({
      value: 'https://success.example/',
    });
    await runtime.shutdown();
  });

  it('correlates rejected operations and enforces the HTTP(S) navigation policy', async () => {
    const { runtime, events } = testRuntime();
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    await expect(runtime.navigate(target, 'file:///private.txt')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    const rejectedEvents = events.slice(-2);
    expect(rejectedEvents.map(({ type }) => type)).toEqual([
      'operation.started',
      'operation.failed',
    ]);
    expect(rejectedEvents[0]?.operationId).toBe(rejectedEvents[1]?.operationId);
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Fake' });
    await runtime.shutdown();
  });

  it('drains accepted work and rejects operations arriving after close begins', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    let releaseNavigation: (() => void) | undefined;
    engine.navigationGate = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    let navigationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      navigationStarted = resolve;
    });
    engine.onNavigationStart = navigationStarted;
    const accepted = runtime.navigate(target, 'https://accepted.example');
    await started;
    const close = runtime.closeSession(created.sessionId);
    await expect(runtime.getTitle(target)).rejects.toMatchObject({ code: 'SESSION_CLOSING' });
    releaseNavigation?.();
    await expect(accepted).resolves.toMatchObject({ value: 'https://accepted.example/' });
    await expect(close).resolves.toMatchObject({ value: { status: 'closed' } });
    expect(engine.contexts.size).toBe(0);
    await runtime.shutdown();
  });

  it('marks live sessions failed on browser disconnect and permits fresh sessions', async () => {
    const { runtime, engine } = testRuntime();
    const original = await runtime.createSession();
    engine.disconnect();
    expect((await runtime.getSession(original.sessionId)).value.status).toBe('failed');
    await expect(
      runtime.getUrl({ sessionId: original.sessionId, pageId: original.pageId }),
    ).rejects.toMatchObject({ code: 'BROWSER_DISCONNECTED' });
    const fresh = await runtime.createSession({ name: 'after-crash' });
    expect(fresh.value.status).toBe('ready');
    expect(fresh.sessionId).not.toBe(original.sessionId);
    await runtime.shutdown();
  });

  it('cleans a context created after a disconnect raced with session initialization', async () => {
    let releaseCreation: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    class GatedEngine extends FakeEngine {
      override async createContext() {
        await gate;
        return super.createContext();
      }
    }
    const { runtime, engine } = testRuntime(new GatedEngine());
    const creation = runtime.createSession();
    await Promise.resolve();
    engine.disconnect();
    releaseCreation?.();
    await expect(creation).rejects.toMatchObject({ code: 'BROWSER_DISCONNECTED' });
    expect(engine.contexts.size).toBe(0);
    expect((await runtime.listSessions()).value).toMatchObject([{ status: 'failed' }]);
    await runtime.shutdown();
  });

  it('bounds failed session-creation records', async () => {
    class FailingEngine extends FakeEngine {
      override async createContext(): Promise<never> {
        throw new Error('simulated context creation failure');
      }
    }
    const { runtime } = testRuntime(new FailingEngine(), { maxSessions: 2 });
    for (let index = 0; index < 6; index += 1) {
      await expect(runtime.createSession()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    }
    expect((await runtime.listSessions()).value).toHaveLength(2);
    expect((await runtime.listSessions()).value.every(({ status }) => status === 'failed')).toBe(
      true,
    );
    await runtime.shutdown();
  });

  it('queues shutdown behind session creation and does not leak its context', async () => {
    let releaseCreation: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    class SlowEngine extends FakeEngine {
      override async createContext() {
        await gate;
        return super.createContext();
      }
    }
    const { runtime, engine } = testRuntime(new SlowEngine());
    const creation = runtime.createSession();
    await Promise.resolve();
    const shutdown = runtime.shutdown();
    releaseCreation?.();
    await creation;
    await shutdown;
    expect(engine.contexts.size).toBe(0);
    expect(engine.pages.size).toBe(0);
  });

  it('enforces session/page limits and reports disabled persistence distinctly', async () => {
    const limited = testRuntime(new FakeEngine(), {
      maxSessions: 1,
      maxPagesPerSession: 1,
      persistenceEnabled: false,
    });
    const created = await limited.runtime.createSession();
    await expect(limited.runtime.createSession()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(limited.runtime.createPage(created.sessionId)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    await expect(limited.runtime.listSavedStates()).rejects.toMatchObject({
      code: 'PERSISTENCE_DISABLED',
    });
    await limited.runtime.shutdown();
  });

  it('saves, lists, and removes logical persistence states through runtime operations', async () => {
    const { runtime } = testRuntime();
    const created = await runtime.createSession();
    await runtime.saveSessionState(created.sessionId, 'buyer-auth');
    expect((await runtime.listSavedStates()).value).toMatchObject([{ stateId: 'buyer-auth' }]);
    await runtime.removeSavedState('buyer-auth');
    expect((await runtime.listSavedStates()).value).toEqual([]);
    await runtime.shutdown();
  });

  it('drains a queued operation during shutdown and rejects new external work', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    let releaseNavigation: (() => void) | undefined;
    engine.navigationGate = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    engine.onNavigationStart = notifyStarted;
    const accepted = runtime.navigate(
      { sessionId: created.sessionId, pageId: created.pageId },
      'https://queued.example',
    );
    await started;
    const shutdown = runtime.shutdown();
    await expect(runtime.listSessions()).rejects.toMatchObject({
      code: 'RUNTIME_SHUTTING_DOWN',
    });
    releaseNavigation?.();
    await expect(accepted).resolves.toMatchObject({ value: 'https://queued.example/' });
    await shutdown;
    expect(engine.contexts.size).toBe(0);
  });

  it('bounds closed-session tombstones while keeping recent close idempotent', async () => {
    const { runtime } = testRuntime(new FakeEngine(), { maxSessions: 3 });
    const closedIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const created = await runtime.createSession({ name: `cycle-${index}` });
      closedIds.push(created.sessionId);
      await runtime.closeSession(created.sessionId);
    }

    expect((await runtime.listSessions()).value).toHaveLength(3);
    await expect(runtime.closeSession(closedIds.at(-1) ?? '')).resolves.toMatchObject({
      value: { status: 'closed' },
    });
    await expect(runtime.closeSession(closedIds[0] ?? '')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    await runtime.shutdown();
  });
});
