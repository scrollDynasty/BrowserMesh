import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import type { BrowserMeshRuntime, OperationTarget } from '../../src/runtime/browsermesh-runtime.js';
import { createRealRuntimeHarness, type RealRuntimeHarness } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('real Chromium runtime', () => {
  let runtime: BrowserMeshRuntime;
  let harness: RealRuntimeHarness;
  let web: TestWebServer;
  beforeEach(async () => {
    harness = await createRealRuntimeHarness();
    runtime = harness.runtime;
    web = await startTestWebServer();
  });
  afterEach(async () => {
    await Promise.all([harness.cleanup(), web.close()]);
  });

  async function createTarget(): Promise<OperationTarget> {
    const created = await runtime.createSession();
    return { sessionId: created.sessionId, pageId: created.pageId };
  }

  it('isolates cookies, localStorage, pages and URLs between contexts', async () => {
    const a = await createTarget();
    const b = await createTarget();
    await Promise.all([
      runtime.navigate(a, `${web.baseUrl}/?value=A`),
      runtime.navigate(b, `${web.baseUrl}/?value=B`),
    ]);
    const locator = { strategy: 'testId', value: 'state' } as const;
    expect((await runtime.visibleText(a, locator)).value).toBe('A|identity=A');
    expect((await runtime.visibleText(b, locator)).value).toBe('B|identity=B');
    expect((await runtime.screenshot(a)).value).not.toBe((await runtime.screenshot(b)).value);
    await expect(
      runtime.getUrl({ sessionId: a.sessionId, pageId: b.pageId }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
  });

  it('creates, lists, routes, and closes additional pages explicitly', async () => {
    const initial = await createTarget();
    const additional = await runtime.createPage(initial.sessionId);
    const second = { sessionId: initial.sessionId, pageId: additional.pageId };
    await Promise.all([
      runtime.navigate(initial, `${web.baseUrl}/?value=initial`),
      runtime.navigate(second, `${web.baseUrl}/?value=additional`),
    ]);
    expect((await runtime.listPages(initial.sessionId)).value).toHaveLength(2);
    expect((await runtime.getUrl(initial)).value).toContain('value=initial');
    expect((await runtime.getUrl(second)).value).toContain('value=additional');
    await runtime.closePage(initial.sessionId, additional.pageId);
    await expect(runtime.getUrl(second)).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    expect((await runtime.listPages(initial.sessionId)).value).toHaveLength(1);
  });

  it('executes different sessions in parallel without a global lock', async () => {
    const a = await createTarget();
    const b = await createTarget();
    await Promise.all([
      runtime.navigate({ ...a, timeoutMs: 2_000 }, `${web.baseUrl}/barrier`),
      runtime.navigate({ ...b, timeoutMs: 2_000 }, `${web.baseUrl}/barrier`),
    ]);
  });

  it('serializes accepted navigation within one real browser session', async () => {
    const target = await createTarget();
    const first = runtime.navigate(target, `${web.baseUrl}/delay?ms=100&value=first`);
    const second = runtime.navigate(target, `${web.baseUrl}/delay?ms=0&value=second`);
    await Promise.all([first, second]);
    expect((await runtime.getTitle(target)).value).toBe('Delay second');
  });

  it('restores cookies and localStorage from a logical stateId', async () => {
    const original = await createTarget();
    await runtime.navigate(original, `${web.baseUrl}/?value=restored`);
    const saved = await runtime.saveSessionState(original.sessionId, 'auth-state');
    expect(saved.value.stateId).toBe('auth-state');
    await runtime.closeSession(original.sessionId);
    const restored = await runtime.createSession({ stateId: 'auth-state' });
    const target = { sessionId: restored.sessionId, pageId: restored.pageId };
    await runtime.navigate(target, web.baseUrl);
    expect((await runtime.visibleText(target, { strategy: 'testId', value: 'state' })).value).toBe(
      'restored|identity=restored',
    );
    expect(restored.value.restoredFromStateId).toBe('auth-state');
  });

  it('supports actions, inspection and capture', async () => {
    const target = await createTarget();
    await runtime.navigate(target, web.baseUrl);
    expect((await runtime.getTitle(target)).value).toBe('BrowserMesh Test');
    await runtime.fill(target, { strategy: 'label', value: 'Name' }, 'Alice');
    expect((await runtime.visibleText(target, { strategy: 'css', value: 'button' })).value).toBe(
      'Submit',
    );
    expect((await runtime.visibleText(target, { strategy: 'text', value: 'Submit' })).value).toBe(
      'Submit',
    );
    await runtime.fill(target, { strategy: 'placeholder', value: 'Your name' }, 'Alice');
    await runtime.press(target, { strategy: 'label', value: 'Name' }, 'End');
    await runtime.selectOption(target, { strategy: 'label', value: 'Choice' }, 'two');
    await runtime.click(target, { strategy: 'role', value: 'button', name: 'Submit' });
    expect((await runtime.visibleText(target, { strategy: 'testId', value: 'status' })).value).toBe(
      'clicked',
    );
    expect((await runtime.snapshot(target)).value).toContain('Submit');
    expect((await runtime.screenshot(target)).value.startsWith('iVBOR')).toBe(true);
  });

  it('supports back, forward, and reload on an explicitly addressed page', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/?value=one`);
    await runtime.navigate(target, `${web.baseUrl}/?value=two`);
    expect((await runtime.back(target)).value).toContain('value=one');
    expect((await runtime.forward(target)).value).toContain('value=two');
    expect((await runtime.reload(target)).value).toContain('value=two');
  });

  it('recovers the session queue after a timed-out element operation', async () => {
    const target = await createTarget();
    await runtime.navigate(target, web.baseUrl);
    await expect(
      runtime.click({ ...target, timeoutMs: 25 }, { strategy: 'testId', value: 'does-not-exist' }),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({
      value: 'BrowserMesh Test',
    });
  });

  it('serializes state capture behind previously accepted navigation', async () => {
    const original = await createTarget();
    const navigation = runtime.navigate(original, `${web.baseUrl}/?value=queued-state`);
    const save = runtime.saveSessionState(original.sessionId, 'queued-state');
    await Promise.all([navigation, save]);
    const restored = await runtime.createSession({ stateId: 'queued-state' });
    const target = { sessionId: restored.sessionId, pageId: restored.pageId };
    await runtime.navigate(target, web.baseUrl);
    expect((await runtime.visibleText(target, { strategy: 'testId', value: 'state' })).value).toBe(
      'queued-state|identity=queued-state',
    );
  });

  it('fails live sessions after an actual Chromium disconnect and restarts only for new sessions', async () => {
    const original = await createTarget();
    const browser: unknown = Reflect.get(harness.engine, 'browser');
    if (!isClosableBrowser(browser)) throw new Error('Playwright browser was not started');
    await browser.close();
    expect((await runtime.getSession(original.sessionId)).value.status).toBe('failed');
    await expect(runtime.getUrl(original)).rejects.toMatchObject({
      code: 'BROWSER_DISCONNECTED',
    });
    const fresh = await runtime.createSession({ name: 'post-disconnect' });
    expect(fresh.value.status).toBe('ready');
    expect(fresh.sessionId).not.toBe(original.sessionId);
  });

  it('drains accepted real navigation, rejects later work, and closes idempotently', async () => {
    const target = await createTarget();
    const accepted = runtime.navigate(target, `${web.baseUrl}/delay?ms=100&value=accepted`);
    const close = runtime.closeSession(target.sessionId);
    await expect(runtime.getTitle(target)).rejects.toMatchObject({ code: 'SESSION_CLOSING' });
    expect((await accepted).value).toContain('accepted');
    await expect(close).resolves.toMatchObject({ value: { status: 'closed' } });
    await expect(runtime.closeSession(target.sessionId)).resolves.toMatchObject({
      value: { status: 'closed' },
    });
    expect(privateMapSize(harness.engine, 'contexts')).toBe(0);
    expect(privateMapSize(harness.engine, 'pages')).toBe(0);
  });

  it('drains accepted real navigation during shutdown and releases browser resources', async () => {
    const target = await createTarget();
    const accepted = runtime.navigate(target, `${web.baseUrl}/delay?ms=100&value=shutdown`);
    const shutdown = runtime.shutdown();
    await expect(runtime.listSessions()).rejects.toMatchObject({
      code: 'RUNTIME_SHUTTING_DOWN',
    });
    expect((await accepted).value).toContain('shutdown');
    await shutdown;
    expect(privateMapSize(harness.engine, 'contexts')).toBe(0);
    expect(privateMapSize(harness.engine, 'pages')).toBe(0);
  });
});

function isClosableBrowser(value: unknown): value is { close(): Promise<void> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'close' in value &&
    typeof value.close === 'function'
  );
}

function privateMapSize(engine: PlaywrightBrowserEngine, property: string): number {
  const value: unknown = Reflect.get(engine, property);
  if (!(value instanceof Map)) throw new Error(`${property} registry is unavailable`);
  return value.size;
}

describe('real Chromium creation/shutdown synchronization', () => {
  it('does not leak a context when shutdown begins during session initialization', async () => {
    let releaseCreation: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    class GatedPlaywrightEngine extends PlaywrightBrowserEngine {
      override async createContext(
        options: Parameters<PlaywrightBrowserEngine['createContext']>[0],
      ) {
        await gate;
        return super.createContext(options);
      }
    }
    const harness = await createRealRuntimeHarness(new GatedPlaywrightEngine(true));
    try {
      const creation = harness.runtime.createSession();
      await Promise.resolve();
      const shutdown = harness.runtime.shutdown();
      releaseCreation?.();
      await creation;
      await shutdown;
      expect(privateMapSize(harness.engine, 'contexts')).toBe(0);
      expect(privateMapSize(harness.engine, 'pages')).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
});
