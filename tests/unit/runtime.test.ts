import { describe, expect, it } from 'vitest';
import { FakeEngine, testRuntime } from '../support/fakes.js';
import type { BrowserContextSettingsInput } from '../../src/domain/context-settings.js';

describe('BrowserMeshRuntime', () => {
  it('paginates an immutable snapshot and rejects cursors outside their lifecycle scope', async () => {
    let nowMs = 0;
    const { runtime, engine } = testRuntime(undefined, { now: () => new Date(nowMs) });
    const firstSession = await runtime.createSession();
    const secondPage = await runtime.createPage(firstSession.sessionId);
    const secondSession = await runtime.createSession();
    engine.snapshotText = '- document:\n  - button "Original immutable value"\n';
    const first = await runtime.snapshot(firstSession, { maxChars: 12, maxBytes: 100 });
    expect(first.value.pagination.nextCursor).toBeTruthy();
    engine.snapshotText = '- document:\n  - button "Mutated live DOM"\n';
    const cursor = first.value.pagination.nextCursor;
    if (cursor === null) throw new Error('Expected a paginated snapshot');
    let nextCursor: string | null = cursor;
    let reconstructed = first.value.snapshot;
    while (nextCursor !== null) {
      const continued = await runtime.snapshot(firstSession, { cursor: nextCursor });
      reconstructed += continued.value.snapshot;
      expect(first.value.pagination.snapshotId).toBe(continued.value.pagination.snapshotId);
      nextCursor = continued.value.pagination.nextCursor;
    }
    expect(reconstructed).toContain('Original immutable value');
    expect(reconstructed).not.toContain('Mutated live DOM');

    await expect(
      runtime.snapshot(
        { sessionId: firstSession.sessionId, pageId: secondPage.value.pageId },
        { cursor },
      ),
    ).rejects.toMatchObject({ code: 'STALE_SNAPSHOT_CURSOR' });
    await expect(runtime.snapshot(secondSession, { cursor })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT_CURSOR',
    });

    for (let capture = 0; capture < 4; capture += 1)
      await runtime.snapshot(firstSession, { maxChars: 12 });
    await expect(runtime.snapshot(firstSession, { cursor })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT_CURSOR',
    });

    const expiring = await runtime.snapshot(firstSession, { maxChars: 12 });
    const expiringCursor = expiring.value.pagination.nextCursor;
    if (expiringCursor === null) throw new Error('Expected a paginated snapshot');
    nowMs = 30_000;
    await expect(runtime.snapshot(firstSession, { cursor: expiringCursor })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT_CURSOR',
    });
    await runtime.shutdown();
  });

  it('invalidates immutable snapshot cursors on navigation and page close', async () => {
    const { runtime, engine } = testRuntime();
    const session = await runtime.createSession();
    engine.snapshotText = '- document:\n  - button "Long enough to paginate"\n';
    const captured = await runtime.snapshot(session, { maxChars: 10 });
    const cursor = captured.value.pagination.nextCursor;
    if (cursor === null) throw new Error('Expected a paginated snapshot');
    await runtime.navigate(session, 'https://example.test/next');
    await expect(runtime.snapshot(session, { cursor })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT_CURSOR',
    });

    const page = await runtime.createPage(session.sessionId);
    const pageTarget = { sessionId: session.sessionId, pageId: page.value.pageId };
    const onPage = await runtime.snapshot(pageTarget, { maxChars: 10 });
    await runtime.closePage(session.sessionId, page.value.pageId);
    const pageCursor = onPage.value.pagination.nextCursor;
    if (pageCursor === null) throw new Error('Expected a paginated snapshot');
    await expect(runtime.snapshot(pageTarget, { cursor: pageCursor })).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
    });
    await runtime.shutdown();
  });
  it('registers popup handles as non-default managed pages and closes overflow popups', async () => {
    const { runtime, engine } = testRuntime(undefined, { maxPagesPerSession: 2 });
    const created = await runtime.createSession();
    const opened = await runtime.actionAndWait(
      created,
      { kind: 'click', locator: { strategy: 'testId', value: 'popup' } },
      { kind: 'popup' },
    );
    expect(opened.value.event).toMatchObject({
      kind: 'popup',
      page: { sessionId: created.sessionId, isDefault: false },
    });
    expect((await runtime.listPages(created.sessionId)).value).toHaveLength(2);
    const enginePagesBefore = engine.pages.size;
    await expect(
      runtime.actionAndWait(
        created,
        { kind: 'click', locator: { strategy: 'testId', value: 'popup' } },
        { kind: 'popup' },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(engine.pages.size).toBe(enginePagesBefore);
    expect((await runtime.listPages(created.sessionId)).value).toHaveLength(2);
    await runtime.shutdown();
  });

  it('returns bounded typed dialog metadata and validates prompt handling', async () => {
    const { runtime } = testRuntime();
    const created = await runtime.createSession();
    const handled = await runtime.actionAndWait(
      created,
      { kind: 'press', locator: { strategy: 'testId', value: 'prompt' }, key: 'Enter' },
      { kind: 'dialog', dialogType: 'prompt', action: 'accept', promptText: 'answer' },
    );
    expect(handled.value.event).toEqual({
      kind: 'dialog',
      dialogType: 'prompt',
      action: 'accept',
      message: 'Fake dialog',
      defaultValue: 'default',
    });
    await expect(
      runtime.actionAndWait(
        created,
        { kind: 'click', locator: { strategy: 'testId', value: 'confirm' } },
        { kind: 'dialog', dialogType: 'confirm', action: 'dismiss', promptText: 'invalid' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await runtime.shutdown();
  });

  it('normalizes, exposes, and isolates immutable context settings', async () => {
    const { runtime, engine } = testRuntime();
    const supplied = {
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 2,
      locale: 'EN-us',
      timezoneId: 'Etc/UTC',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      userAgent: 'BrowserMesh test agent',
      geolocation: { latitude: 41.3111, longitude: 69.2797, accuracy: 25 },
      permissions: [{ permission: 'geolocation', origin: 'HTTPS://Example.COM:443/' }],
    } as const;
    const first = await runtime.createSession({ contextSettings: supplied });
    const second = await runtime.createSession({ contextSettings: { locale: 'fr-FR' } });
    expect(first.value.contextSettings).toEqual({
      ...supplied,
      locale: 'en-US',
      timezoneId: 'UTC',
      permissions: [{ permission: 'geolocation', origin: 'https://example.com' }],
    });
    expect(second.value.contextSettings).toEqual({ locale: 'fr-FR' });
    expect(Array.from(engine.contexts.values(), ({ settings }) => settings)).toEqual([
      first.value.contextSettings,
      second.value.contextSettings,
    ]);
    (first.value.contextSettings.viewport as { width: number }).width = 1;
    expect((await runtime.getSession(first.sessionId)).value.contextSettings.viewport?.width).toBe(
      800,
    );
    await runtime.shutdown();
  });

  it('rejects unsafe context settings before creating browser resources', async () => {
    const { runtime, engine } = testRuntime();
    const invalidSettings: BrowserContextSettingsInput[] = [
      { viewport: { width: 0, height: 600 } },
      { deviceScaleFactor: Number.POSITIVE_INFINITY },
      { locale: 'not_a_locale' },
      { timezoneId: 'Mars/Olympus' },
      { userAgent: 'unsafe\nheader' },
      { geolocation: { latitude: 91, longitude: 0 } },
      { geolocation: { latitude: 0, longitude: -181 } },
      { geolocation: { latitude: 0, longitude: 0, accuracy: -1 } },
      {
        geolocation: { latitude: 0, longitude: 0 },
        permissions: [{ permission: 'geolocation', origin: '*' }],
      },
      {
        geolocation: { latitude: 0, longitude: 0 },
        permissions: [{ permission: 'geolocation', origin: 'https://example.com/path' }],
      },
      {
        geolocation: { latitude: 0, longitude: 0 },
        permissions: [{ permission: 'geolocation', origin: 'https://user@example.com' }],
      },
      {
        geolocation: { latitude: 0, longitude: 0 },
        permissions: [{ permission: 'camera', origin: 'https://example.com' }],
      },
      {
        geolocation: { latitude: 0, longitude: 0 },
        permissions: [
          { permission: 'geolocation', origin: 'https://example.com' },
          { permission: 'geolocation', origin: 'HTTPS://EXAMPLE.COM:443/' },
        ],
      },
      { permissions: [{ permission: 'geolocation', origin: 'https://example.com' }] },
    ];
    for (const contextSettings of invalidSettings) {
      await expect(runtime.createSession({ contextSettings })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    }
    expect(engine.contexts.size).toBe(0);
    expect((await runtime.listSessions()).value).toEqual([]);
    await runtime.shutdown();
  });

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

  it('cancels queued work before execution without overtaking in-flight work or blocking another session', async () => {
    const { runtime, engine } = testRuntime();
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    let releaseNavigation!: () => void;
    engine.navigationGate = new Promise<void>((resolve) => (releaseNavigation = resolve));
    let navigationStarted!: () => void;
    const started = new Promise<void>((resolve) => (navigationStarted = resolve));
    engine.onNavigationStart = navigationStarted;

    const first = runtime.navigate(a, 'https://first.example');
    await started;
    const controller = new AbortController();
    const cancelled = runtime.navigate(
      { ...a, signal: controller.signal },
      'https://must-not-run.example',
    );
    controller.abort(new DOMException('cancelled by test', 'AbortError'));

    await expect(runtime.getTitle(b)).resolves.toMatchObject({ value: 'Fake' });
    releaseNavigation();
    await first;
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    engine.navigationGate = undefined;
    await expect(runtime.navigate(a, 'https://recovered.example')).resolves.toMatchObject({
      value: 'https://recovered.example/',
    });
    await runtime.shutdown();
  });

  it('routes typed interactions through the owning session queue and recovers after failure', async () => {
    const { runtime, engine } = testRuntime();
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    const locator = { strategy: 'testId', value: 'control' } as const;

    engine.failNextInteraction = true;
    await expect(runtime.hover(a, locator)).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await runtime.focus(a, locator);
    await runtime.check(a, locator);
    await runtime.uncheck(a, locator);
    await runtime.doubleClick(a, locator);
    await runtime.scrollIntoView(a, locator);
    await runtime.scroll(a, 0, 100);
    await runtime.dragAndDrop(a, locator, locator);
    expect(engine.interactionOrder).toEqual([
      'hover',
      'focus',
      'check',
      'uncheck',
      'double-click',
      'scroll-into-view',
      'scroll',
      'drag-and-drop',
    ]);

    await expect(
      runtime.focus({ sessionId: a.sessionId, pageId: b.pageId }, locator),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    await runtime.shutdown();
  });

  it('does not execute a cancelled queued interaction or let later same-session work overtake', async () => {
    const { runtime, engine } = testRuntime();
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    const locator = { strategy: 'role', value: 'button', name: 'Control' } as const;
    let release!: () => void;
    engine.interactionGate = new Promise<void>((resolve) => (release = resolve));
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => (notifyStarted = resolve));
    engine.onInteractionStart = notifyStarted;

    const first = runtime.hover(a, locator);
    await started;
    const controller = new AbortController();
    const cancelled = runtime.focus({ ...a, signal: controller.signal }, locator);
    const later = runtime.doubleClick(a, locator);
    const independent = runtime.check(b, locator);
    controller.abort(new DOMException('cancelled by test', 'AbortError'));

    release();
    await expect(first).resolves.toMatchObject({ sessionId: a.sessionId, pageId: a.pageId });
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.all([later, independent]);
    expect(engine.interactionOrder).toEqual(['hover', 'check', 'double-click']);
    await runtime.shutdown();
  });

  it('cleans up a session cancelled during creation instead of leaving a creating tombstone', async () => {
    let releaseCreation!: () => void;
    let creationStarted!: () => void;
    const started = new Promise<void>((resolve) => (creationStarted = resolve));
    const gate = new Promise<void>((resolve) => (releaseCreation = resolve));
    class GatedEngine extends FakeEngine {
      override async createContext() {
        creationStarted();
        await gate;
        return super.createContext();
      }
    }
    const { runtime, engine } = testRuntime(new GatedEngine());
    const controller = new AbortController();
    const creation = runtime.createSession({}, { signal: controller.signal });
    await started;
    controller.abort(new DOMException('cancelled by test', 'AbortError'));
    releaseCreation();
    await expect(creation).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.contexts.size).toBe(0);
    expect((await runtime.listSessions()).value).toMatchObject([{ status: 'failed' }]);
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

  it('serializes waits, recovers after timeout, and validates bounded matchers', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    await runtime.navigate(target, 'https://wait.example/ready');
    const success = await runtime.wait(target, {
      kind: 'url',
      matcher: { kind: 'glob', value: 'https://wait.example/**' },
    });
    expect(success.value.condition).toEqual({
      kind: 'url',
      matcher: { kind: 'glob', value: 'https://wait.example/**' },
    });
    engine.failNextWait = true;
    await expect(
      runtime.wait(target, { kind: 'text', text: 'missing', state: 'present' }),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(runtime.getUrl(target)).resolves.toMatchObject({
      value: 'https://wait.example/ready',
    });
    await expect(
      runtime.wait(target, {
        kind: 'url',
        matcher: { kind: 'glob', value: '*'.repeat(33) },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await runtime.shutdown();
  });

  it('registers a composite waiter before its action and normalizes navigation load state', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    const result = await runtime.actionAndWait(
      { sessionId: created.sessionId, pageId: created.pageId },
      { kind: 'click', locator: { strategy: 'role', value: 'button', name: 'Continue' } },
      { kind: 'navigation', matcher: { kind: 'exact', value: 'https://next.example/' } },
    );
    expect(engine.compositeOrder).toEqual(['waiter', 'click']);
    expect(result.value.wait).toMatchObject({ kind: 'navigation', loadState: 'load' });
    expect(result.value.event).toEqual({ kind: 'navigation', url: 'https://next.example/' });
    await runtime.shutdown();
  });

  it('keeps the session queue slot until an accepted composite operation settles', async () => {
    const { runtime, engine } = testRuntime();
    const created = await runtime.createSession();
    const target = { sessionId: created.sessionId, pageId: created.pageId };
    let releaseComposite: (() => void) | undefined;
    engine.compositeGate = new Promise<void>((resolve) => {
      releaseComposite = resolve;
    });
    let startedComposite: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedComposite = resolve;
    });
    engine.onCompositeStart = startedComposite;
    const composite = runtime.actionAndWait(
      target,
      { kind: 'press', locator: { strategy: 'testId', value: 'submit' }, key: 'Enter' },
      { kind: 'response', matcher: { kind: 'exact', value: 'https://api.example/result' } },
    );
    await started;
    let readSettled = false;
    const read = runtime.getUrl(target).finally(() => {
      readSettled = true;
    });
    await Promise.resolve();
    expect(readSettled).toBe(false);
    releaseComposite?.();
    await composite;
    await read;
    await runtime.shutdown();
  });
});
