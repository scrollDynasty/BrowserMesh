import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';
import { createRealRuntimeHarness, type RealRuntimeHarness } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('external MCP client multi-role workflow', () => {
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

  it('uses independent buyer and seller sessions without internal agent orchestration', async () => {
    const buyer = await runtime.createSession({
      name: 'buyer',
      metadata: { role: 'buyer', account: 'buyer@example.test' },
    });
    const seller = await runtime.createSession({
      name: 'seller',
      metadata: { role: 'seller', account: 'seller@example.test' },
    });
    if (buyer.sessionId === undefined || buyer.pageId === undefined)
      throw new Error('missing buyer IDs');
    if (seller.sessionId === undefined || seller.pageId === undefined)
      throw new Error('missing seller IDs');
    const buyerTarget = { sessionId: buyer.sessionId, pageId: buyer.pageId };
    const sellerTarget = { sessionId: seller.sessionId, pageId: seller.pageId };

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
      runtime.getUrl({ sessionId: buyer.sessionId, pageId: seller.pageId }),
    ).rejects.toMatchObject({ code: 'PAGE_NOT_FOUND' });
    expect((await runtime.getSession(buyer.sessionId)).value.metadata).toEqual({
      role: 'buyer',
      account: 'buyer@example.test',
    });
  });
});
