import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';
import { realRuntime } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('external MCP client multi-role workflow', () => {
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

  it('uses independent buyer and seller sessions without internal agent orchestration', async () => {
    const buyerSession = await runtime.createSession({
      name: 'buyer',
      metadata: { role: 'buyer', account: 'buyer@example.test' },
    });
    const sellerSession = await runtime.createSession({
      name: 'seller',
      metadata: { role: 'seller', account: 'seller@example.test' },
    });
    const buyerPage = runtime.listPages(buyerSession.id)[0];
    const sellerPage = runtime.listPages(sellerSession.id)[0];
    if (buyerPage === undefined || sellerPage === undefined) throw new Error('missing pages');
    const buyerTarget = { sessionId: buyerSession.id, pageId: buyerPage.id };
    const sellerTarget = { sessionId: sellerSession.id, pageId: sellerPage.id };

    await runtime.navigate(buyerTarget, `${web.baseUrl}/buyer`);
    await runtime.fill(buyerTarget, { strategy: 'label', value: 'Item' }, 'book');
    await runtime.click(buyerTarget, { strategy: 'role', value: 'button', name: 'Create order' });
    expect(
      (await runtime.visibleText(buyerTarget, { strategy: 'testId', value: 'status' })).value,
    ).toBe('created:book');

    await runtime.navigate(sellerTarget, `${web.baseUrl}/seller`);
    expect(
      (await runtime.visibleText(sellerTarget, { strategy: 'testId', value: 'order' })).value,
    ).toBe('book');
    await runtime.click(sellerTarget, { strategy: 'role', value: 'link', name: 'Approve' });

    await runtime.navigate(buyerTarget, `${web.baseUrl}/buyer-status`);
    expect(
      (await runtime.visibleText(buyerTarget, { strategy: 'testId', value: 'status' })).value,
    ).toBe('approved');
    await expect(
      runtime.getUrl({ sessionId: buyerSession.id, pageId: sellerPage.id }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    expect(runtime.getSession(buyerSession.id).metadata).toEqual({
      role: 'buyer',
      account: 'buyer@example.test',
    });
  });
});
