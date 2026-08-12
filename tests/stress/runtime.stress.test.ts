import { describe, expect, it } from 'vitest';
import { testRuntime } from '../support/fakes.js';

describe('runtime stress', () => {
  it('routes 50 concurrent sessions without cross-session leakage or leaked handles', async () => {
    const { runtime, engine } = testRuntime();
    engine.delayMs = 1;
    const sessions = await Promise.all(
      Array.from({ length: 50 }, (_, index) => runtime.createSession({ name: `session-${index}` })),
    );
    await Promise.all(
      sessions.map(async (session, index) => {
        if (session.sessionId === undefined || session.pageId === undefined)
          throw new Error('missing explicit IDs');
        await runtime.navigate(
          { sessionId: session.sessionId, pageId: session.pageId },
          `https://example.test/${index}`,
        );
        expect(
          (await runtime.getUrl({ sessionId: session.sessionId, pageId: session.pageId })).value,
        ).toBe(`https://example.test/${index}`);
      }),
    );
    expect(engine.maxActiveGlobal).toBeGreaterThan(25);
    await runtime.shutdown();
    expect(engine.contexts.size).toBe(0);
    expect(engine.pages.size).toBe(0);
  });
});
