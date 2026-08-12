import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';
import { realRuntime } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('real Chromium runtime', () => {
  let runtime: BrowserMeshRuntime;
  let web: TestWebServer;
  beforeEach(async () => {
    runtime = await realRuntime();
    web = await startTestWebServer();
  });
  afterEach(async () => {
    await runtime.shutdown();
    await web.close();
  });

  it('isolates cookies, localStorage, pages and URLs between contexts', async () => {
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    const pageA = runtime.listPages(a.id)[0];
    const pageB = runtime.listPages(b.id)[0];
    if (pageA === undefined || pageB === undefined) throw new Error('missing pages');
    await Promise.all([
      runtime.navigate({ sessionId: a.id, pageId: pageA.id }, `${web.baseUrl}/?value=A`),
      runtime.navigate({ sessionId: b.id, pageId: pageB.id }, `${web.baseUrl}/?value=B`),
    ]);
    const locator = { strategy: 'testId', value: 'state' } as const;
    expect((await runtime.visibleText({ sessionId: a.id, pageId: pageA.id }, locator)).value).toBe(
      'A|identity=A',
    );
    expect((await runtime.visibleText({ sessionId: b.id, pageId: pageB.id }, locator)).value).toBe(
      'B|identity=B',
    );
    await expect(runtime.getUrl({ sessionId: a.id, pageId: pageB.id })).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
    });
  });

  it('executes different sessions in parallel without a global lock', async () => {
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    const pageA = runtime.listPages(a.id)[0];
    const pageB = runtime.listPages(b.id)[0];
    if (pageA === undefined || pageB === undefined) throw new Error('missing pages');
    await Promise.all([
      runtime.navigate(
        { sessionId: a.id, pageId: pageA.id, timeoutMs: 2_000 },
        `${web.baseUrl}/barrier`,
      ),
      runtime.navigate(
        { sessionId: b.id, pageId: pageB.id, timeoutMs: 2_000 },
        `${web.baseUrl}/barrier`,
      ),
    ]);
  });

  it('restores cookies and localStorage from saved state', async () => {
    const original = await runtime.createSession();
    const originalPage = runtime.listPages(original.id)[0];
    if (originalPage === undefined) throw new Error('missing page');
    await runtime.navigate(
      { sessionId: original.id, pageId: originalPage.id },
      `${web.baseUrl}/?value=restored`,
    );
    await runtime.saveSessionState(original.id, 'auth-state');
    await runtime.closeSession(original.id);
    const restored = await runtime.createSession({ fromState: 'auth-state' });
    const page = runtime.listPages(restored.id)[0];
    if (page === undefined) throw new Error('missing restored page');
    await runtime.navigate({ sessionId: restored.id, pageId: page.id }, web.baseUrl);
    expect(
      (
        await runtime.visibleText(
          { sessionId: restored.id, pageId: page.id },
          { strategy: 'testId', value: 'state' },
        )
      ).value,
    ).toBe('restored|identity=restored');
  });

  it('supports actions, inspection and capture', async () => {
    const session = await runtime.createSession();
    const page = runtime.listPages(session.id)[0];
    if (page === undefined) throw new Error('missing page');
    const target = { sessionId: session.id, pageId: page.id };
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
});
