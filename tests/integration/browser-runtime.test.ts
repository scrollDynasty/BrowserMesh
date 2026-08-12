import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    if (created.sessionId === undefined || created.pageId === undefined) {
      throw new Error('session creation did not return explicit IDs');
    }
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
    await expect(
      runtime.getUrl({ sessionId: a.sessionId, pageId: b.pageId }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
  });

  it('executes different sessions in parallel without a global lock', async () => {
    const a = await createTarget();
    const b = await createTarget();
    await Promise.all([
      runtime.navigate({ ...a, timeoutMs: 2_000 }, `${web.baseUrl}/barrier`),
      runtime.navigate({ ...b, timeoutMs: 2_000 }, `${web.baseUrl}/barrier`),
    ]);
  });

  it('restores cookies and localStorage from a logical stateId', async () => {
    const original = await createTarget();
    await runtime.navigate(original, `${web.baseUrl}/?value=restored`);
    const saved = await runtime.saveSessionState(original.sessionId, 'auth-state');
    expect(saved.value.stateId).toBe('auth-state');
    await runtime.closeSession(original.sessionId);
    const restored = await runtime.createSession({ stateId: 'auth-state' });
    if (restored.sessionId === undefined || restored.pageId === undefined) {
      throw new Error('restored session did not return explicit IDs');
    }
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
    await runtime.press(target, { strategy: 'label', value: 'Name' }, 'End');
    await runtime.selectOption(target, { strategy: 'label', value: 'Choice' }, 'two');
    await runtime.click(target, { strategy: 'role', value: 'button', name: 'Submit' });
    expect((await runtime.visibleText(target, { strategy: 'testId', value: 'status' })).value).toBe(
      'clicked',
    );
    expect((await runtime.snapshot(target)).value).toContain('Submit');
    expect((await runtime.screenshot(target)).value.startsWith('iVBOR')).toBe(true);
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
    if (restored.sessionId === undefined || restored.pageId === undefined) throw new Error('IDs');
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
});

function isClosableBrowser(value: unknown): value is { close(): Promise<void> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'close' in value &&
    typeof value.close === 'function'
  );
}
