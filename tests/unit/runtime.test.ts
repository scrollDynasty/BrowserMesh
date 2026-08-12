import { describe, expect, it } from 'vitest';
import { FakeEngine, testRuntime } from '../support/fakes.js';

describe('BrowserMeshRuntime', () => {
  it('returns the initial page, correlates operations, and closes idempotently', async () => {
    const { runtime, engine } = testRuntime();
    const createdA = await runtime.createSession({ name: 'a' });
    const createdB = await runtime.createSession({ name: 'b' });
    if (createdA.sessionId === undefined || createdA.pageId === undefined)
      throw new Error('missing A IDs');
    if (createdB.sessionId === undefined) throw new Error('missing B session ID');
    expect(createdA.sessionId).not.toBe(createdB.sessionId);
    expect(createdA.pageId).toMatch(/^page_/);
    expect(createdA.operationId).toMatch(/^operation_/);
    expect(engine.contexts.size).toBe(2);
    const pages = await runtime.listPages(createdA.sessionId);
    expect(pages.value).toHaveLength(1);
    expect(pages.value[0]?.id).toBe(createdA.pageId);
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
    if (a.sessionId === undefined || a.pageId === undefined) throw new Error('missing A IDs');
    if (b.sessionId === undefined || b.pageId === undefined) throw new Error('missing B IDs');
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
    if (a.sessionId === undefined || a.pageId === undefined) throw new Error('missing A IDs');
    if (b.pageId === undefined) throw new Error('missing B page ID');
    await expect(
      runtime.getUrl({ sessionId: a.sessionId, pageId: b.pageId }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    await runtime.closeSession(a.sessionId);
    await expect(runtime.createPage(a.sessionId)).rejects.toMatchObject({
      code: 'SESSION_CLOSED',
    });
    await runtime.shutdown();
  });

  it('recovers its session queue after a browser operation fails', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    if (created.sessionId === undefined || created.pageId === undefined) throw new Error('IDs');
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

  it('drains accepted work and rejects operations arriving after close begins', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    if (created.sessionId === undefined || created.pageId === undefined) throw new Error('IDs');
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
    if (original.sessionId === undefined || original.pageId === undefined) throw new Error('IDs');
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
    if (created.sessionId === undefined) throw new Error('missing session ID');
    await expect(limited.runtime.createSession()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(limited.runtime.createPage(created.sessionId)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    await expect(limited.runtime.listSavedStates()).rejects.toMatchObject({
      code: 'PERSISTENCE_DISABLED',
    });
    await limited.runtime.shutdown();
  });

  it('drains a queued operation during shutdown and rejects new external work', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    if (created.sessionId === undefined || created.pageId === undefined) throw new Error('IDs');
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
      if (created.sessionId === undefined) throw new Error('missing session ID');
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
