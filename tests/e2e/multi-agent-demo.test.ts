import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';
import { realRuntime } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('buyer/seller multi-agent scenario', () => {
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

  it('coordinates through messages while browser state remains explicitly owned', async () => {
    const buyer = runtime.createAgent({ name: 'Buyer' });
    const seller = runtime.createAgent({ name: 'Seller' });
    const buyerSession = await runtime.createSession({ ownerAgentId: buyer.id });
    const sellerSession = await runtime.createSession({ ownerAgentId: seller.id });
    const buyerPage = runtime.listPages(buyerSession.id, buyer.id)[0];
    const sellerPage = runtime.listPages(sellerSession.id, seller.id)[0];
    if (buyerPage === undefined || sellerPage === undefined) throw new Error('missing pages');
    const buyerTarget = { sessionId: buyerSession.id, pageId: buyerPage.id, agentId: buyer.id };
    const sellerTarget = { sessionId: sellerSession.id, pageId: sellerPage.id, agentId: seller.id };
    await runtime.navigate(buyerTarget, `${web.baseUrl}/buyer`);
    await runtime.fill(buyerTarget, { strategy: 'label', value: 'Item' }, 'book');
    await runtime.click(buyerTarget, { strategy: 'role', value: 'button', name: 'Create order' });
    expect(
      (await runtime.visibleText(buyerTarget, { strategy: 'testId', value: 'status' })).value,
    ).toBe('created:book');
    const request = runtime.sendMessage({
      fromAgentId: buyer.id,
      toAgentId: seller.id,
      type: 'request',
      payload: { action: 'approve', item: 'book' },
    });
    expect(runtime.listMessages(seller.id, true)[0]?.id).toBe(request.id);
    await runtime.navigate(sellerTarget, `${web.baseUrl}/seller`);
    expect(
      (await runtime.visibleText(sellerTarget, { strategy: 'testId', value: 'order' })).value,
    ).toBe('book');
    await runtime.click(sellerTarget, { strategy: 'role', value: 'link', name: 'Approve' });
    runtime.sendMessage({
      fromAgentId: seller.id,
      toAgentId: buyer.id,
      type: 'response',
      payload: { approved: true },
      correlationId: request.correlationId,
      replyTo: request.id,
    });
    await runtime.navigate(buyerTarget, `${web.baseUrl}/buyer-status`);
    expect(
      (await runtime.visibleText(buyerTarget, { strategy: 'testId', value: 'status' })).value,
    ).toBe('approved');
    expect(runtime.listMessages(buyer.id, true)[0]?.correlationId).toBe(request.correlationId);
    await expect(
      runtime.getUrl({ sessionId: buyerSession.id, pageId: buyerPage.id, agentId: seller.id }),
    ).rejects.toMatchObject({ code: 'SESSION_OWNED_BY_ANOTHER_AGENT' });
  });
});
