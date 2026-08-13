import { describe, expect, it } from 'vitest';
import type { BrowserEngineLaunchOptions } from '../../src/application/ports/browser-engine.js';
import { createRuntime } from '../../src/create-runtime.js';
import type { BrowserMeshConfig } from '../../src/infrastructure/config.js';
import { FakeEngine } from '../support/fakes.js';

describe('createRuntime', () => {
  it('passes effective headless mode and the bounded timeout through the composition seam', async () => {
    let received: BrowserEngineLaunchOptions | undefined;
    const engine = new FakeEngine();
    const config: BrowserMeshConfig = {
      defaultTimeoutMs: 2_500,
      dataDirectory: '.browsermesh-test',
      logLevel: 'silent',
      maxSessions: 2,
      maxPagesPerSession: 3,
      persistenceEnabled: false,
      headless: true,
    };

    const runtime = createRuntime(config, {
      createBrowserEngine(options) {
        received = options;
        return engine;
      },
    });

    expect(received).toEqual({ headless: true, timeoutMs: 2_500 });
    expect(engine.started).toBe(false);
    await runtime.shutdown();
  });
});
