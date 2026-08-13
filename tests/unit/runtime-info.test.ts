import { describe, expect, it } from 'vitest';
import { testRuntime } from '../support/fakes.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/domain/resource-limits.js';

describe('runtime info', () => {
  it('reports safe exact configuration and does not launch the browser', async () => {
    const { runtime, engine } = testRuntime();

    expect(runtime.runtimeInfo()).toEqual({
      serverVersion: '0.1.3-test',
      nodeVersion: '24.0.0-test',
      playwrightVersion: '1.62.1-test',
      browserProduct: 'chromium',
      browserVersion: null,
      browserLaunchState: 'not_started',
      headless: true,
      persistenceEnabled: true,
      defaultTimeoutMs: 1_000,
      maxSessions: 50,
      maxPagesPerSession: 5,
      resourceLimits: DEFAULT_RESOURCE_LIMITS,
      activeSessions: 0,
      failedSessions: 0,
    });
    expect(engine.started).toBe(false);
    expect(engine.contexts.size).toBe(0);
    await runtime.shutdown();
  });

  it('reports live browser version and active/failed counts without exposing session data', async () => {
    const { runtime, engine } = testRuntime();
    await runtime.start();
    await runtime.createSession({ name: 'private-name', metadata: { token: 'secret' } });
    engine.disconnect();

    const info = runtime.runtimeInfo();
    expect(info.activeSessions).toBe(0);
    expect(info.failedSessions).toBe(1);
    expect(JSON.stringify(info)).not.toContain('private-name');
    expect(JSON.stringify(info)).not.toContain('secret');
    await runtime.shutdown();
  });
});
