import { describe, expect, it } from 'vitest';
import { BrowserMeshError } from '../../src/domain/errors.js';
import { FakeEngine, testRuntime } from '../support/fakes.js';

describe('BrowserMeshRuntime', () => {
  it('creates isolated sessions and closes idempotently', async () => {
    const { runtime, engine } = testRuntime();
    const a = await runtime.createSession({ name: 'a' });
    const b = await runtime.createSession({ name: 'b' });
    expect(a.id).not.toBe(b.id);
    expect(engine.contexts.size).toBe(2);
    expect(runtime.listPages(a.id)).toHaveLength(1);
    expect((await runtime.closeSession(a.id)).status).toBe('closed');
    expect((await runtime.closeSession(a.id)).status).toBe('closed');
    expect(engine.contexts.size).toBe(1);
    await runtime.shutdown();
    expect(engine.contexts.size).toBe(0);
  });

  it('serializes one session but runs different sessions concurrently', async () => {
    const { runtime, engine } = testRuntime();
    engine.delayMs = 20;
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    const pageA = runtime.listPages(a.id)[0];
    const pageB = runtime.listPages(b.id)[0];
    if (pageA === undefined || pageB === undefined) throw new Error('missing initial page');
    await Promise.all([
      runtime.navigate({ sessionId: a.id, pageId: pageA.id }, 'https://a.example/1'),
      runtime.navigate({ sessionId: a.id, pageId: pageA.id }, 'https://a.example/2'),
      runtime.navigate({ sessionId: b.id, pageId: pageB.id }, 'https://b.example/1'),
    ]);
    expect(engine.maxActiveGlobal).toBeGreaterThan(1);
    expect([...engine.maxActiveByContext.values()]).toEqual([1, 1]);
    expect((await runtime.getUrl({ sessionId: a.id, pageId: pageA.id })).value).toBe(
      'https://a.example/2',
    );
    await runtime.shutdown();
  });

  it('rejects cross-session page references and operations after close', async () => {
    const { runtime } = testRuntime();
    const a = await runtime.createSession();
    const b = await runtime.createSession();
    const pageB = runtime.listPages(b.id)[0];
    if (pageB === undefined) throw new Error('missing page');
    await expect(runtime.getUrl({ sessionId: a.id, pageId: pageB.id })).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
    });
    await runtime.closeSession(a.id);
    await expect(runtime.createPage(a.id)).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    await runtime.shutdown();
  });

  it('enforces ownership, supports handoff, and orders mailboxes', async () => {
    const { runtime } = testRuntime();
    const buyer = runtime.createAgent({ name: 'buyer' });
    const seller = runtime.createAgent({ name: 'seller' });
    const session = await runtime.createSession({ ownerAgentId: buyer.id });
    expect(() => runtime.listPages(session.id, seller.id)).toThrow(BrowserMeshError);
    runtime.assignSession(session.id, seller.id, buyer.id);
    expect(runtime.listPages(session.id, seller.id)).toHaveLength(1);
    const first = runtime.sendMessage({
      fromAgentId: buyer.id,
      toAgentId: seller.id,
      type: 'request',
      payload: { order: 1 },
    });
    const second = runtime.sendMessage({
      fromAgentId: buyer.id,
      toAgentId: seller.id,
      type: 'message',
      payload: 'next',
    });
    expect(runtime.listMessages(seller.id).map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(runtime.acknowledgeMessage(seller.id, first.id).acknowledgedAt).toBeDefined();
    expect(runtime.listMessages(seller.id, true)).toHaveLength(1);
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
});
