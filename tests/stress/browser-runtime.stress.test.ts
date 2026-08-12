import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';
import { createRealRuntimeHarness, type RealRuntimeHarness } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('real Chromium bounded stress', () => {
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

  it('isolates and releases eight concurrently active browser contexts', async () => {
    const sessions = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runtime.createSession({ name: `chromium-stress-${index}` }),
      ),
    );

    await Promise.all(
      sessions.map((session, index) =>
        runtime.navigate(
          { sessionId: session.sessionId, pageId: session.pageId, timeoutMs: 5_000 },
          `${web.baseUrl}/?value=chromium-${index}`,
        ),
      ),
    );

    await Promise.all(
      sessions.map(async (session, index) => {
        const target = { sessionId: session.sessionId, pageId: session.pageId };
        await expect(
          runtime.visibleText(target, { strategy: 'testId', value: 'state' }),
        ).resolves.toMatchObject({ value: `chromium-${index}|identity=chromium-${index}` });
      }),
    );

    await Promise.all(sessions.map((session) => runtime.closeSession(session.sessionId)));
    expect(privateMapSize(harness.engine, 'contexts')).toBe(0);
    expect(privateMapSize(harness.engine, 'pages')).toBe(0);
  });
});

function privateMapSize(engine: RealRuntimeHarness['engine'], property: string): number {
  const value: unknown = Reflect.get(engine, property);
  if (!(value instanceof Map)) throw new Error(`${property} registry is unavailable`);
  return value.size;
}
