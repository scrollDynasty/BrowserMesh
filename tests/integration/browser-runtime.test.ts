import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import type { Browser, BrowserContext } from 'playwright';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import { createOperationControl } from '../../src/application/operation-control.js';
import { BrowserMeshError, type BrowserMeshErrorCode } from '../../src/domain/errors.js';
import type { BrowserMeshRuntime, OperationTarget } from '../../src/runtime/browsermesh-runtime.js';
import { createRealRuntimeHarness, type RealRuntimeHarness } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

function requireRef(ref: string | undefined): string {
  if (ref === undefined) throw new Error('Expected snapshot element ref');
  return ref;
}

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

  it('applies different effective context settings to concurrent isolated sessions', async () => {
    const a = await runtime.createSession({
      contextSettings: {
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 2,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        userAgent: 'BrowserMesh-A',
      },
    });
    const b = await runtime.createSession({
      contextSettings: {
        viewport: { width: 1024, height: 700 },
        deviceScaleFactor: 1,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
        colorScheme: 'light',
        reducedMotion: 'no-preference',
        userAgent: 'BrowserMesh-B',
      },
    });
    await Promise.all([
      runtime.navigate(a, `${web.baseUrl}/context-settings`),
      runtime.navigate(b, `${web.baseUrl}/context-settings`),
    ]);
    const locator = { strategy: 'testId', value: 'context' } as const;
    expect((await runtime.visibleText(a, locator)).value).toBe(
      '800|600|2|en-US|UTC|dark|reduce|BrowserMesh-A',
    );
    expect((await runtime.visibleText(b, locator)).value).toBe(
      '1024|700|1|fr-FR|Europe/Paris|light|no-preference|BrowserMesh-B',
    );
    expect(a.value.contextSettings).not.toEqual(b.value.contextSettings);
  });

  it('isolates origin-scoped geolocation grants between concurrent sessions', async () => {
    const allowed = await runtime.createSession({
      contextSettings: {
        geolocation: { latitude: 41.3111, longitude: 69.2797, accuracy: 25 },
        permissions: [{ permission: 'geolocation', origin: web.baseUrl }],
      },
    });
    const denied = await runtime.createSession({
      contextSettings: { geolocation: { latitude: -33.8688, longitude: 151.2093 } },
    });
    await Promise.all([
      runtime.navigate(allowed, `${web.baseUrl}/geolocation`),
      runtime.navigate(denied, `${web.baseUrl}/geolocation`),
    ]);
    const locator = { strategy: 'testId', value: 'geolocation' } as const;
    await runtime.wait(allowed, {
      kind: 'text',
      text: 'granted|41.3111|69.2797|25',
      state: 'present',
    });
    expect((await runtime.visibleText(allowed, locator)).value).toBe('granted|41.3111|69.2797|25');
    expect((await runtime.visibleText(denied, locator)).value).not.toContain('41.3111');
    expect(allowed.value.contextSettings.permissions).toEqual([
      { permission: 'geolocation', origin: web.baseUrl },
    ]);
    expect(denied.value.contextSettings.permissions).toBeUndefined();
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

  it('spends one absolute navigation deadline across queue wait and Playwright', async () => {
    const target = await createTarget();
    const blocking = runtime.navigate(
      { ...target, timeoutMs: 1_000 },
      `${web.baseUrl}/delay?ms=200&value=blocking-deadline`,
    );
    const expired = runtime.navigate(
      { ...target, timeoutMs: 250 },
      `${web.baseUrl}/delay?ms=100&value=must-time-out`,
    );

    await blocking;
    await expect(expired).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await runtime.navigate(target, `${web.baseUrl}/delay?ms=0&value=deadline-recovery`);
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect((await runtime.getTitle(target)).value).toBe('Delay deadline-recovery');
  });

  it('restores cookies and localStorage from a logical stateId', async () => {
    const original = await createTarget();
    await runtime.navigate(original, `${web.baseUrl}/?value=restored`);
    const saved = await runtime.saveSessionState(original.sessionId, 'auth-state');
    expect(saved.value.stateId).toBe('auth-state');
    await runtime.closeSession(original.sessionId);
    const restored = await runtime.createSession({
      stateId: 'auth-state',
      contextSettings: {
        locale: 'fr-FR',
        geolocation: { latitude: 41.3111, longitude: 69.2797 },
        permissions: [{ permission: 'geolocation', origin: web.baseUrl }],
      },
    });
    const target = { sessionId: restored.sessionId, pageId: restored.pageId };
    await runtime.navigate(target, web.baseUrl);
    expect((await runtime.visibleText(target, { strategy: 'testId', value: 'state' })).value).toBe(
      'restored|identity=restored',
    );
    expect(restored.value.restoredFromStateId).toBe('auth-state');
    expect(restored.value.contextSettings).toEqual({
      locale: 'fr-FR',
      geolocation: { latitude: 41.3111, longitude: 69.2797 },
      permissions: [{ permission: 'geolocation', origin: web.baseUrl }],
    });
    await runtime.navigate(target, `${web.baseUrl}/geolocation`);
    await runtime.wait(target, {
      kind: 'text',
      text: 'granted|41.3111|69.2797|0',
      state: 'present',
    });
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
    expect((await runtime.snapshot(target)).value.snapshot).toContain('Submit');
    const screenshot = await runtime.screenshot(target);
    expect(screenshot.value.startsWith('iVBOR')).toBe(true);
    expect(screenshot).toMatchObject({ width: 1280, height: 720 });
    expect(screenshot.bytes).toBeGreaterThan(100);
  });

  it('performs typed semantic interactions and exposes their resulting page state', async () => {
    const target = await createTarget();
    const status = { strategy: 'testId', value: 'status' } as const;
    await runtime.navigate(target, `${web.baseUrl}/interactions`);

    await runtime.hover(target, { strategy: 'role', value: 'button', name: 'Hover target' });
    expect((await runtime.visibleText(target, status)).value).toBe('hovered');
    await runtime.focus(target, { strategy: 'label', value: 'Focus target' });
    expect((await runtime.visibleText(target, status)).value).toBe('focused');
    await runtime.check(target, { strategy: 'role', value: 'checkbox', name: 'Enabled' });
    expect((await runtime.visibleText(target, status)).value).toBe('checked');
    await runtime.check(target, { strategy: 'role', value: 'checkbox', name: 'Enabled' });
    await runtime.uncheck(target, { strategy: 'label', value: 'Enabled' });
    expect((await runtime.visibleText(target, status)).value).toBe('unchecked');
    await runtime.uncheck(target, { strategy: 'label', value: 'Enabled' });
    await runtime.doubleClick(target, {
      strategy: 'role',
      value: 'button',
      name: 'Double target',
    });
    expect((await runtime.visibleText(target, status)).value).toBe('double-clicked');
    await runtime.dragAndDrop(
      target,
      { strategy: 'testId', value: 'drag-source' },
      { strategy: 'testId', value: 'drop-target' },
    );
    expect((await runtime.visibleText(target, status)).value).toBe('dropped');
    await runtime.scroll(target, 0, 1200);
    await runtime.wait(target, { kind: 'text', text: 'scrolled', state: 'present' });
    await runtime.scrollIntoView(target, { strategy: 'testId', value: 'offscreen' });
    await runtime.wait(target, { kind: 'text', text: 'scrolled', state: 'present' });
    expect((await runtime.visibleText(target, status)).value).toBe('scrolled');
    const elementCapture = await runtime.screenshot(target, {
      locator: { strategy: 'testId', value: 'drop-target' },
    });
    const fullPageCapture = await runtime.screenshot(target, { fullPage: true });
    expect(elementCapture.value.startsWith('iVBOR')).toBe(true);
    expect(fullPageCapture.value.length).toBeGreaterThan(elementCapture.value.length);
  });

  it('targets nested same-origin and cross-origin iframes across inspection and actions', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/iframes`);
    const outer = {
      kind: 'iframe',
      chain: [{ strategy: 'testId', value: 'outer-frame' }],
    } as const;
    const nested = {
      kind: 'iframe',
      chain: [
        { strategy: 'testId', value: 'outer-frame' },
        { strategy: 'testId', value: 'nested-frame' },
      ],
    } as const;

    await runtime.wait(target, {
      kind: 'locator',
      locator: { strategy: 'testId', value: 'frame-status', frame: outer },
      state: 'visible',
    });
    await runtime.fill(
      target,
      { strategy: 'label', value: 'Frame input', frame: outer },
      'isolated-frame-value',
    );
    await runtime.click(target, {
      strategy: 'role',
      value: 'button',
      name: 'Frame action',
      frame: outer,
    });
    expect(
      (
        await runtime.visibleText(target, {
          strategy: 'testId',
          value: 'frame-status',
          frame: outer,
        })
      ).value,
    ).toBe('frame-clicked');

    await runtime.click(target, { strategy: 'testId', value: 'nested-action', frame: nested });
    expect(
      (
        await runtime.visibleText(target, {
          strategy: 'testId',
          value: 'nested-status',
          frame: nested,
        })
      ).value,
    ).toBe('nested-clicked');
    const captured = (
      await runtime.snapshot(target, {
        scope: { strategy: 'css', value: 'body', frame: nested },
        includeRefs: true,
        maxRefs: 2,
      })
    ).value;
    expect(captured.snapshot).toContain('Nested action');
    expect(captured.appliedBounds.scope).toMatchObject({ frame: nested });
    expect(captured.refs.some((item) => item.tag === 'button')).toBe(true);
    expect(
      (
        await runtime.screenshot(target, {
          locator: { strategy: 'testId', value: 'nested-status', frame: nested },
        })
      ).value,
    ).toMatch(/^iVBOR/u);
    expect(
      (
        await runtime.visibleText(target, {
          strategy: 'testId',
          value: 'detach-frame',
          frame: { kind: 'main' },
        })
      ).value,
    ).toBe('Detach frame');
  });

  it('reports iframe-chain ambiguity exactly and recovers its session queue', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/iframes`);
    const ambiguous = {
      strategy: 'css',
      value: 'body',
      frame: {
        kind: 'iframe',
        chain: [{ strategy: 'testId', value: 'duplicate-frame' }],
      },
    } as const;

    await expect(runtime.visibleText(target, ambiguous)).rejects.toMatchObject({
      code: 'LOCATOR_AMBIGUOUS',
      details: { frameIndex: 0 },
    });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Iframe targeting' });
  });

  it('makes iframe refs stale after descendant navigation or detach', async () => {
    const target = await createTarget();
    const scope = {
      strategy: 'css',
      value: 'body',
      frame: {
        kind: 'iframe',
        chain: [{ strategy: 'testId', value: 'outer-frame' }],
      },
    } as const;
    await runtime.navigate(target, `${web.baseUrl}/iframes`);
    const navigatedRef = requireRef(
      (await runtime.snapshot(target, { scope, includeRefs: true, maxRefs: 3 })).value.refs.find(
        (item) => item.tag === 'button',
      )?.ref,
    );
    await runtime.click(target, { strategy: 'testId', value: 'navigate-frame' });
    await expect(runtime.click(target, { ref: navigatedRef })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });

    await runtime.reload(target);
    const detachedRef = requireRef(
      (await runtime.snapshot(target, { scope, includeRefs: true, maxRefs: 3 })).value.refs.find(
        (item) => item.tag === 'button',
      )?.ref,
    );
    await runtime.click(target, { strategy: 'testId', value: 'detach-frame' });
    await expect(runtime.click(target, { ref: detachedRef })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Iframe targeting' });
  });

  it('keeps typed-interaction failures bounded and the real session queue usable', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/interactions`);
    await expect(
      runtime.hover(
        { ...target, timeoutMs: 25 },
        { strategy: 'testId', value: 'missing-interaction-target' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Typed interactions' });
  });

  it('captures scoped, depth-limited snapshots with boxes and explicit response bounds', async () => {
    const target = await createTarget();
    await runtime.navigate(target, web.baseUrl);
    const captured = (
      await runtime.snapshot(target, {
        scope: { strategy: 'role', value: 'button', name: 'Submit' },
        maxDepth: 1,
        includeBoundingBoxes: true,
        maxChars: 80,
        maxBytes: 100,
      })
    ).value;

    expect(captured.appliedBounds).toEqual({
      scope: { strategy: 'role', value: 'button', name: 'Submit' },
      maxDepth: 1,
      includeBoundingBoxes: true,
      maxChars: 80,
      maxBytes: 100,
      includeRefs: false,
      maxRefs: 50,
      interactiveOnly: false,
      maxChildren: null,
    });
    expect(captured.snapshot).toContain('[box=');
    expect(captured.snapshot).not.toContain('Choice');
    expect(captured.truncation.returnedChars).toBeLessThanOrEqual(80);
    expect(captured.truncation.returnedBytes).toBeLessThanOrEqual(100);
    expect(captured.contentFormat).toBe(captured.partial ? 'aria-yaml-fragment' : 'aria-yaml');
  });

  it('captures bounded refs, acts through them, and rejects cross-page/session use', async () => {
    const first = await createTarget();
    const secondPage = await runtime.createPage(first.sessionId);
    const otherPage = { sessionId: first.sessionId, pageId: secondPage.pageId };
    const otherSession = await createTarget();
    await Promise.all([
      runtime.navigate(first, `${web.baseUrl}/element-refs`),
      runtime.navigate(otherPage, `${web.baseUrl}/element-refs`),
      runtime.navigate(otherSession, `${web.baseUrl}/element-refs`),
    ]);

    const captured = (await runtime.snapshot(first, { includeRefs: true, maxRefs: 2 })).value;
    expect(captured.refs).toHaveLength(2);
    expect(captured.appliedBounds).toMatchObject({ includeRefs: true, maxRefs: 2 });
    const inputRef = captured.refs.find((item) => item.tag === 'input')?.ref;
    const buttonRef = captured.refs.find((item) => item.tag === 'button')?.ref;
    expect(inputRef).toMatch(/^@e[a-f0-9]{32}$/u);
    expect(buttonRef).toMatch(/^@e[a-f0-9]{32}$/u);

    await runtime.fill(first, { ref: requireRef(inputRef) }, 'through-ref');
    await runtime.click(first, { ref: requireRef(buttonRef) });
    await expect(runtime.click(first, { ref: requireRef(buttonRef) })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });
    await expect(runtime.click(otherPage, { ref: requireRef(inputRef) })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });
    await expect(runtime.click(otherSession, { ref: requireRef(inputRef) })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });
  });

  it('invalidates refs on navigation, page close, and replacement by a later snapshot', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/element-refs`);
    const firstRef = requireRef(
      (await runtime.snapshot(target, { includeRefs: true, maxRefs: 1 })).value.refs[0]?.ref,
    );
    const replacementRef = requireRef(
      (await runtime.snapshot(target, { includeRefs: true, maxRefs: 1 })).value.refs[0]?.ref,
    );
    await expect(runtime.focus(target, { ref: firstRef })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });
    await expect(runtime.focus(target, { ref: replacementRef })).resolves.toMatchObject({
      value: null,
    });
    await runtime.reload(target);
    await expect(runtime.focus(target, { ref: replacementRef })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });

    const closeRef = requireRef(
      (await runtime.snapshot(target, { includeRefs: true, maxRefs: 1 })).value.refs[0]?.ref,
    );
    await runtime.closePage(target.sessionId, target.pageId);
    await expect(runtime.focus(target, { ref: closeRef })).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
    });
  });

  it('expires refs after the bounded TTL and leaves the queue usable', async () => {
    await harness.cleanup();
    let clock = 0;
    harness = await createRealRuntimeHarness(
      new PlaywrightBrowserEngine({ headless: true, timeoutMs: 5_000 }, () => clock),
    );
    runtime = harness.runtime;
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/element-refs`);
    const ref = requireRef(
      (await runtime.snapshot(target, { includeRefs: true, maxRefs: 1 })).value.refs[0]?.ref,
    );
    clock = 30_001;
    await expect(runtime.focus(target, { ref })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Element refs' });
  });

  it('cancels snapshot capture and leaves its session queue usable', async () => {
    const target = await createTarget();
    await runtime.navigate(target, web.baseUrl);
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled by test', 'AbortError'));

    await expect(runtime.snapshot({ ...target, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'BrowserMesh Test' });
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
    expect(failures.events.length).toBeGreaterThanOrEqual(2);
    expect(failures.events[0]).toMatchObject({
      kind: 'request_failed',
      method: 'GET',
      resourceType: 'fetch',
    });
    expect(failures.events[0]?.failure).toMatch(/ERR_[A-Z_]+|Request failed/u);
    expect(JSON.stringify(failures)).not.toContain('transport-secret');
    expect(JSON.stringify(failures)).not.toContain('stream-secret');
    const truncatedResponse = network.events.find(
      (event) => event.kind === 'response' && event.url?.includes('/api/headers-then-fail'),
    );
    const truncatedFailure = failures.events.find(
      (event) => event.kind === 'request_failed' && event.url?.includes('/api/headers-then-fail'),
    );
    expect(truncatedResponse).toBeDefined();
    expect(truncatedFailure).toBeDefined();
    expect(truncatedFailure?.requestId).toBe(truncatedResponse?.requestId);
  });

  it('redacts password input values from accessibility snapshots', async () => {
    const target = await createTarget();
    const secretPrefix = 'BrowserMesh-"quoted"-\\secret';
    const secret = `${secretPrefix}-Do-Not-Echo`;
    await runtime.navigate(target, `${web.baseUrl}/password`);
    await runtime.fill(target, { strategy: 'label', value: 'Password' }, secretPrefix);
    await runtime.fill(target, { strategy: 'label', value: 'Confirm password' }, secret);

    const captured = (await runtime.snapshot(target)).value.snapshot;

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

  it('cancels an active passive wait promptly and leaves its session queue usable', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/waits`);
    const controller = new AbortController();
    const waiting = runtime.wait(
      { ...target, timeoutMs: 5_000, signal: controller.signal },
      { kind: 'text', text: 'will-never-appear', state: 'present' },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const startedAt = Date.now();
    controller.abort(new DOMException('cancelled by test', 'AbortError'));
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await expect(runtime.getUrl(target)).resolves.toMatchObject({ value: `${web.baseUrl}/waits` });
  });

  it('registers composite navigation and response waiters before click actions', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/action-waits`);
    await expect(
      runtime.actionAndWait(
        { ...target, timeoutMs: 50 },
        { kind: 'click', target: { strategy: 'testId', value: 'request' } },
        {
          kind: 'response',
          matcher: { kind: 'exact', value: `${web.baseUrl}/api/never` },
        },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({ value: 'Action waits' });
    const response = await runtime.actionAndWait(
      target,
      { kind: 'click', target: { strategy: 'testId', value: 'request' } },
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
      { kind: 'press', target: { strategy: 'testId', value: 'request' }, key: 'Enter' },
      {
        kind: 'response',
        matcher: { kind: 'glob', value: `${web.baseUrl}/api/*` },
        status: 200,
      },
    );
    expect(pressedResponse.value.event).toMatchObject({ kind: 'response', status: 200 });

    const navigation = await runtime.actionAndWait(
      target,
      { kind: 'click', target: { strategy: 'testId', value: 'navigate' } },
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

  it('atomically manages popup pages and dialogs without leaking ownership', async () => {
    const target = await createTarget();
    const other = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/popup-dialog-actions`);

    const popup = await runtime.actionAndWait(
      target,
      { kind: 'click', target: { strategy: 'testId', value: 'popup' } },
      { kind: 'popup' },
    );
    expect(popup.value.event.kind).toBe('popup');
    if (popup.value.event.kind !== 'popup') throw new Error('Expected popup event');
    expect(popup.value.event.page).toMatchObject({
      sessionId: target.sessionId,
      isDefault: false,
    });
    await expect(
      runtime.getTitle({ sessionId: other.sessionId, pageId: popup.value.event.page.pageId }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    await expect(
      runtime.getTitle({ sessionId: target.sessionId, pageId: popup.value.event.page.pageId }),
    ).resolves.toMatchObject({ value: 'Popup destination' });
    const popupTarget = {
      sessionId: target.sessionId,
      pageId: popup.value.event.page.pageId,
    };
    const popupRef = requireRef(
      (await runtime.snapshot(popupTarget, { includeRefs: true, maxRefs: 1 })).value.refs[0]?.ref,
    );
    await runtime.focus(popupTarget, { ref: popupRef });
    await runtime.navigate(popupTarget, web.baseUrl);
    await expect(runtime.focus(popupTarget, { ref: popupRef })).rejects.toMatchObject({
      code: 'STALE_ELEMENT_REFERENCE',
    });

    const prompt = await runtime.actionAndWait(
      target,
      { kind: 'click', target: { strategy: 'testId', value: 'prompt' } },
      { kind: 'dialog', dialogType: 'prompt', action: 'accept', promptText: 'typed answer' },
    );
    expect(prompt.value.event).toMatchObject({
      kind: 'dialog',
      dialogType: 'prompt',
      action: 'accept',
      message: 'Prompt message',
      defaultValue: 'seed',
    });
    await expect(
      runtime.visibleText(target, { strategy: 'testId', value: 'status' }),
    ).resolves.toMatchObject({ value: 'typed answer' });

    const confirm = await runtime.actionAndWait(
      target,
      { kind: 'click', target: { strategy: 'testId', value: 'confirm' } },
      { kind: 'dialog', dialogType: 'confirm', action: 'dismiss' },
    );
    expect(confirm.value.event).toMatchObject({ kind: 'dialog', action: 'dismiss' });
    await expect(
      runtime.actionAndWait(
        target,
        { kind: 'click', target: { strategy: 'testId', value: 'alert' } },
        { kind: 'dialog', dialogType: 'confirm', action: 'dismiss' },
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
    await expect(
      runtime.visibleText(target, { strategy: 'testId', value: 'status' }),
    ).resolves.toMatchObject({ value: 'handled' });
    await expect(runtime.getTitle(target)).resolves.toMatchObject({
      value: 'Popup and dialog actions',
    });

    const page = requireListenerCountingPage(firstPrivateValue(harness.engine, 'pages'));
    const context = requireBrowserContext(firstPrivateValue(harness.engine, 'contexts'));
    const baselineDialogListeners = page.listenerCount('dialog');
    const baselinePopupListeners = page.listenerCount('popup');
    const baselineManagedPages = (await runtime.listPages(target.sessionId)).value.length;
    const baselineContextPages = context.pages().length;
    await expect(
      runtime.actionAndWait(
        target,
        { kind: 'click', target: { strategy: 'testId', value: 'unexpected-dialog' } },
        { kind: 'response', matcher: { kind: 'exact', value: `${web.baseUrl}/api/result` } },
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
    expect(page.listenerCount('dialog')).toBe(baselineDialogListeners);
    expect(page.listenerCount('popup')).toBe(baselinePopupListeners);
    await expect(runtime.getTitle(target)).resolves.toMatchObject({
      value: 'Popup and dialog actions',
    });

    await expect(
      runtime.actionAndWait(
        target,
        { kind: 'click', target: { strategy: 'testId', value: 'unexpected-popup' } },
        {
          kind: 'response',
          matcher: { kind: 'exact', value: `${web.baseUrl}/api/delayed-result` },
        },
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
    expect((await runtime.listPages(target.sessionId)).value).toHaveLength(baselineManagedPages);
    expect(context.pages()).toHaveLength(baselineContextPages);
    expect(page.listenerCount('dialog')).toBe(baselineDialogListeners);
    expect(page.listenerCount('popup')).toBe(baselinePopupListeners);
    await expect(runtime.getTitle(target)).resolves.toMatchObject({
      value: 'Popup and dialog actions',
    });
  });

  it('closes a real overflow popup and recovers the same-session queue', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/popup-dialog-actions`);
    for (let index = 1; index < 10; index += 1) await runtime.createPage(target.sessionId);
    await expect(
      runtime.actionAndWait(
        target,
        { kind: 'click', target: { strategy: 'testId', value: 'popup' } },
        { kind: 'popup' },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect((await runtime.listPages(target.sessionId)).value).toHaveLength(10);
    await expect(runtime.getTitle(target)).resolves.toMatchObject({
      value: 'Popup and dialog actions',
    });
  });

  it('closes the expected popup when an unexpected dialog fails the same operation', async () => {
    const target = await createTarget();
    await runtime.navigate(target, `${web.baseUrl}/popup-dialog-actions`);
    const context = requireBrowserContext(firstPrivateValue(harness.engine, 'contexts'));
    const managedPages = (await runtime.listPages(target.sessionId)).value.length;
    const contextPages = context.pages().length;

    // One click opens the awaited popup and raises a dialog. Chromium may deliver
    // those two events in either order and each order runs different compensation
    // code, so this asserts only the outcome both must reach: the operation fails
    // and no tab is left behind. The orderings themselves are pinned
    // deterministically in tests/unit/action-wait-popup-ownership.test.ts.
    await expect(
      runtime.actionAndWait(
        target,
        { kind: 'click', target: { strategy: 'testId', value: 'popup-and-dialog' } },
        { kind: 'popup' },
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_ERROR' });

    expect((await runtime.listPages(target.sessionId)).value).toHaveLength(managedPages);
    // Wait for the context to settle rather than sampling it: the close can still
    // be in flight when the operation rejects, and which of the two event orders
    // Chromium picked decides that. A tab nothing ever closes still fails here,
    // which is the leak this guards.
    await expect.poll(() => context.pages().length, { timeout: 5_000 }).toBe(contextPages);
    await expect(runtime.getTitle(target)).resolves.toMatchObject({
      value: 'Popup and dialog actions',
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
      reason: 'timeout',
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

  it('classifies a real connection navigation failure without breaking the session', async () => {
    const target = await createTarget();
    const refusalServer = createServer();
    await new Promise<void>((resolve) => refusalServer.listen(0, '127.0.0.1', resolve));
    const address = refusalServer.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP address');
    await new Promise<void>((resolve, reject) =>
      refusalServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
    const url = `http://127.0.0.1:${String(address.port)}/`;

    const error = await captureBrowserMeshError(
      runtime.navigate({ ...target, timeoutMs: 5_000 }, url),
      'NAVIGATION_FAILED',
    );
    expect(error.message).toContain('ERR_');
    expect(error.details).toMatchObject({ url, timeoutMs: 5_000, reason: 'connection' });
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

function firstPrivateValue(engine: PlaywrightBrowserEngine, property: string): unknown {
  const value: unknown = Reflect.get(engine, property);
  if (!(value instanceof Map)) throw new Error(`${property} registry is unavailable`);
  const first: unknown = value.values().next().value;
  if (first === undefined) throw new Error(`${property} registry is empty`);
  return first;
}

function requireListenerCountingPage(value: unknown): { listenerCount(event: string): number } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('listenerCount' in value) ||
    typeof value.listenerCount !== 'function'
  )
    throw new Error('Page does not expose listenerCount');
  return value as { listenerCount(event: string): number };
}

function requireBrowserContext(value: unknown): BrowserContext {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('pages' in value) ||
    typeof value.pages !== 'function'
  )
    throw new Error('Browser context does not expose pages');
  return value as BrowserContext;
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
  it('reaps a Chromium launch accepted immediately before stop and can restart cleanly', async () => {
    const engine = new PlaywrightBrowserEngine({ headless: true, timeoutMs: 5_000 });
    const starting = engine.start();
    const stopping = engine.stop();
    await Promise.all([starting, stopping]);
    expect(engine.diagnostics()).toMatchObject({
      launchState: 'not_started',
      browserVersion: null,
    });
    expect(Reflect.get(engine, 'browser')).toBeUndefined();
    expect(privateMapSize(engine, 'contexts')).toBe(0);
    expect(privateMapSize(engine, 'pages')).toBe(0);

    await engine.start();
    expect(engine.diagnostics().launchState).toBe('ready');
    await engine.stop();
  });

  it('closes an unregistered context when cancellation races permission granting', async () => {
    const engine = new PlaywrightBrowserEngine({ headless: true, timeoutMs: 5_000 });
    await engine.start();
    const browser = Reflect.get(engine, 'browser') as Browser;
    const originalNewContext = browser.newContext.bind(browser);
    let releaseGrant: (() => void) | undefined;
    let grantStarted: (() => void) | undefined;
    const grantGate = new Promise<void>((resolve) => {
      releaseGrant = resolve;
    });
    const enteredGrant = new Promise<void>((resolve) => {
      grantStarted = resolve;
    });
    Reflect.set(browser, 'newContext', async (...args: Parameters<Browser['newContext']>) => {
      const context: BrowserContext = await originalNewContext(...args);
      const originalGrant = context.grantPermissions.bind(context);
      Reflect.set(
        context,
        'grantPermissions',
        async (...grantArgs: Parameters<BrowserContext['grantPermissions']>) => {
          grantStarted?.();
          await grantGate;
          return originalGrant(...grantArgs);
        },
      );
      return context;
    });
    const cancellation = new AbortController();
    try {
      const creation = engine.createContext({
        control: createOperationControl(5_000, cancellation.signal),
        settings: {
          geolocation: { latitude: 41.3111, longitude: 69.2797 },
          permissions: [{ permission: 'geolocation', origin: 'https://example.com' }],
        },
      });
      await enteredGrant;
      cancellation.abort();
      releaseGrant?.();
      await expect(creation).rejects.toMatchObject({ name: 'AbortError' });
      expect(browser.contexts()).toHaveLength(0);
      expect(privateMapSize(engine, 'contexts')).toBe(0);
    } finally {
      releaseGrant?.();
      await engine.stop();
    }
  });

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
