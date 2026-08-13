import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import { BrowserMeshError, type BrowserMeshErrorCode } from '../../src/domain/errors.js';
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

  it('collects bounded redacted console and page-error evidence from real Chromium', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/observability`);

    const metadata = (await runtime.listConsole(target, {})).value;
    expect(metadata.events.some((event) => event.level === 'warning')).toBe(true);
    expect(metadata.events.every((event) => event.text === undefined)).toBe(true);
    const consoleEvents = (await runtime.listConsole(target, { includeText: true })).value;
    expect(consoleEvents.events.some((event) => event.text?.includes('token=[REDACTED]'))).toBe(
      true,
    );
    const pageErrors = (await runtime.listPageErrors(target, { includeText: true })).value;
    expect(pageErrors.events).toHaveLength(1);
    expect(pageErrors.events[0]?.text).toContain('password=[REDACTED]');
    expect(pageErrors.events[0]?.text).not.toContain('at ');
  });

  it('collects correlated redacted network, 500, duplicate, and failed-request evidence', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/network-observability`);
    await runtime.wait(target, {
      kind: 'text',
      text: 'ready',
      state: 'present',
    });

    const network = (await runtime.listNetwork(target, { limit: 100 })).value;
    const serialized = JSON.stringify(network);
    expect(serialized).not.toContain('encoded-secret');
    expect(serialized).not.toContain('first-secret');
    expect(serialized).not.toContain('second-secret');
    expect(serialized).not.toContain('response-body-must-not-be-captured');
    expect(serialized).not.toContain('private-fragment');
    const serverError = network.events.find(
      (event) => event.kind === 'response' && event.status === 500,
    );
    expect(serverError).toMatchObject({ method: 'GET', resourceType: 'fetch' });
    expect(serverError?.url).toContain('token=%5BREDACTED%5D');
    expect(serverError?.durationMs).toEqual(expect.any(Number));
    const matchingRequest = network.events.find(
      (event) => event.kind === 'request' && event.requestId === serverError?.requestId,
    );
    expect(matchingRequest).toBeDefined();
    const duplicates = network.events.filter(
      (event) => event.kind === 'request' && event.url?.includes('/api/duplicate'),
    );
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates.map((event) => event.requestId)).size).toBe(2);

    const failures = (await runtime.listFailedRequests(target, { limit: 100 })).value;
    expect(failures.events).toHaveLength(1);
    expect(failures.events[0]).toMatchObject({
      kind: 'request_failed',
      method: 'GET',
      resourceType: 'fetch',
    });
    expect(failures.events[0]?.failure).toMatch(/ERR_[A-Z_]+|Request failed/u);
    expect(JSON.stringify(failures)).not.toContain('transport-secret');
  });

  it('redacts password input values from accessibility snapshots', async () => {
    const target = await createTarget();
    const secretPrefix = 'BrowserMesh-"quoted"-\\secret';
    const secret = `${secretPrefix}-Do-Not-Echo`;
    await runtime.navigate(target, `${web.baseUrl}/password`);
    await runtime.fill(target, { strategy: 'label', value: 'Password' }, secretPrefix);
    await runtime.fill(target, { strategy: 'label', value: 'Confirm password' }, secret);

    const captured = (await runtime.snapshot(target)).value;

    expect(captured).not.toContain(secretPrefix);
    expect(captured).not.toContain(secret);
    expect(captured).toContain('[REDACTED]');
  });

  it('matches role names exactly by default and classifies deliberate ambiguity', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/ambiguous`);

    await runtime.click(target, { strategy: 'role', value: 'link', name: 'Employees' });
    expect((await runtime.getUrl(target)).value).toContain('/exact');

    await runtime.back(target);
    const ambiguous = await captureBrowserMeshError(
      runtime.click(target, {
        strategy: 'role',
        value: 'link',
        name: 'Employees',
        exact: false,
      }),
      'LOCATOR_AMBIGUOUS',
    );
    expect(ambiguous.message).toContain('exact=false');
    expect(ambiguous.details).toMatchObject({
      locator: { strategy: 'role', value: 'link', name: 'Employees', exact: false },
    });
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

  it('waits for bounded passive URL, load, locator, and exact-case text conditions', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/waits`);
    await runtime.wait(target, {
      kind: 'url',
      matcher: { kind: 'glob', value: `${web.baseUrl}/wait*` },
    });
    await runtime.wait(target, {
      kind: 'url',
      matcher: { kind: 'exact', value: `${web.baseUrl}/waits` },
    });
    await runtime.wait(target, { kind: 'load', state: 'domcontentloaded' });
    await runtime.wait(target, { kind: 'load', state: 'load' });
    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'delayed' },
      state: 'attached',
    });
    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'disabled' },
      state: 'disabled',
    });
    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'delayed' },
      state: 'visible',
    });
    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'removed' },
      state: 'detached',
    });
    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'hidden-later' },
      state: 'hidden',
    });
    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'toggle' },
      state: 'enabled',
    });
    await runtime.wait(target, { kind: 'text', text: 'Case-Sensitive Ready', state: 'present' });
    await runtime.wait(target, { kind: 'text', text: 'Never Here', state: 'absent' });
    await expect(
      runtime.wait(
        { ...target, timeoutMs: 50 },
        { kind: 'text', text: 'case-sensitive ready', state: 'present' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Wait conditions' });
  });

  it('registers composite navigation and response waiters before click actions', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/action-waits`);
    await expect(
      runtime.actionAndWait(
        { ...target, timeoutMs: 50 },
        { kind: 'click', locator: { strategy: 'testId', value: 'request' } },
        {
          kind: 'response',
          matcher: { kind: 'exact', value: `${web.baseUrl}/api/never` },
        },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Action waits' });
    const response = await runtime.actionAndWait(
      target,
      { kind: 'click', locator: { strategy: 'testId', value: 'request' } },
      {
        kind: 'response',
        matcher: { kind: 'glob', value: `${web.baseUrl}/api/*` },
        method: 'GET',
        status: 200,
      },
    );
    expect(response.value.event).toMatchObject({
      kind: 'response',
      method: 'GET',
      status: 200,
    });
    expect(response.value.event.url).toContain('token=%5BREDACTED%5D');
    expect(response.value.event.url).not.toContain('top-secret');

    const pressedResponse = await runtime.actionAndWait(
      target,
      { kind: 'press', locator: { strategy: 'testId', value: 'request' }, key: 'Enter' },
      {
        kind: 'response',
        matcher: { kind: 'glob', value: `${web.baseUrl}/api/*` },
        status: 200,
      },
    );
    expect(pressedResponse.value.event).toMatchObject({ kind: 'response', status: 200 });

    const navigation = await runtime.actionAndWait(
      target,
      { kind: 'click', locator: { strategy: 'testId', value: 'navigate' } },
      {
        kind: 'navigation',
        matcher: { kind: 'exact', value: `${web.baseUrl}/action-destination` },
        loadState: 'load',
      },
    );
    expect(navigation.value.event).toMatchObject({
      kind: 'navigation',
      url: `${web.baseUrl}/action-destination`,
    });
  });

  it('keeps waits ordered per session, parallel across sessions, and usable after timeout', async () => {
    const a = await createTarget();
    const b = await createTarget();
    await Promise.all([
      runtime.navigate(a, `${web.baseUrl}/waits`),
      runtime.navigate(b, `${web.baseUrl}/waits`),
    ]);
    await Promise.all([
      runtime.wait(a, {
        kind: 'locator',
        locator: { strategy: 'testId', value: 'delayed' },
        state: 'visible',
      }),
      runtime.wait(b, {
        kind: 'locator',
        locator: { strategy: 'testId', value: 'delayed' },
        state: 'visible',
      }),
    ]);
    await expect(
      runtime.wait(
        { ...a, timeoutMs: 25 },
        { kind: 'text', text: 'missing forever', state: 'present' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    const navigation = runtime.navigate(a, `${web.baseUrl}/action-destination`);
    const read = runtime.getTitle(a);
    await expect(navigation).resolves.toMatchObject({ value: `${web.baseUrl}/action-destination` });
    await expect(read).resolves.toMatchObject({ value: 'Action destination' });
    await expect(runtime.getTitle(b)).resolves.toMatchObject({ value: 'Wait conditions' });
  });

  it('returns diagnostic locator errors without losing sessions or queued work', async () => {
    const first = await createTarget();
    const second = await createTarget();
    await Promise.all([
      runtime.navigate(first, web.baseUrl),
      runtime.navigate(second, web.baseUrl),
    ]);
    const missing = { strategy: 'css', value: '#missing-select' } as const;

    const pressError = await captureBrowserMeshError(
      runtime.press({ ...first, timeoutMs: 100 }, missing, 'Enter'),
      'OPERATION_TIMEOUT',
    );
    expect(pressError.message).toContain('css=#missing-select');
    expect(pressError.details).toMatchObject({
      operation: 'press',
      locator: missing,
      timeoutMs: 100,
    });
    expect(pressError.details?.cause).toContain('#missing-select');

    const selectError = await captureBrowserMeshError(
      runtime.selectOption(
        { ...first, timeoutMs: 100 },
        { strategy: 'testId', value: 'status' },
        'two',
      ),
      'OPERATION_TIMEOUT',
    );
    expect(selectError.message).toContain('testId=status');
    expect(selectError.details).toMatchObject({ operation: 'select option', timeoutMs: 100 });

    const invalidCssError = await captureBrowserMeshError(
      runtime.press({ ...first, timeoutMs: 100 }, { strategy: 'css', value: '[invalid' }, 'Enter'),
      'ELEMENT_NOT_FOUND',
    );
    expect(invalidCssError.message).toContain('css=[invalid');

    await expect(runtime.getTitle(first)).resolves.toMatchObject({ value: 'BrowserMesh Test' });
    await expect(runtime.getTitle(second)).resolves.toMatchObject({ value: 'BrowserMesh Test' });
    await expect(runtime.listSessions()).resolves.toMatchObject({
      value: [
        expect.objectContaining({ status: 'ready' }),
        expect.objectContaining({ status: 'ready' }),
      ],
    });
  });

  it('includes the underlying Chromium failure in navigation errors', async () => {
    const target = await createTarget();
    const url = 'http://127.0.0.1:1/';

    const error = await captureBrowserMeshError(
      runtime.navigate({ ...target, timeoutMs: 1_000 }, url),
      'NAVIGATION_FAILED',
    );
    expect(error.message).toContain('ERR_');
    expect(error.details).toMatchObject({ url, timeoutMs: 1_000 });
    expect(error.details?.cause).toContain('ERR_');
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: '' });
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

async function captureBrowserMeshError(
  operation: Promise<unknown>,
  expectedCode: BrowserMeshErrorCode,
): Promise<BrowserMeshError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserMeshError);
    if (!(error instanceof BrowserMeshError)) throw error;
    expect(error.code).toBe(expectedCode);
    return error;
  }
  throw new Error(`Expected ${expectedCode}`);
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
    const harness = await createRealRuntimeHarness(
      new GatedPlaywrightEngine({ headless: true, timeoutMs: 5_000 }),
    );
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
