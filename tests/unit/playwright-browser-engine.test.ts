import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';

describe('PlaywrightBrowserEngine', () => {
  it('launches headed by default', () => {
    const engine = new PlaywrightBrowserEngine();

    expect(Reflect.get(engine, 'launchOptions')).toEqual({ headless: false, timeoutMs: 10_000 });
  });

  it('retains explicit bounded launch options', () => {
    const engine = new PlaywrightBrowserEngine({ headless: true, timeoutMs: 2_500 });

    expect(Reflect.get(engine, 'launchOptions')).toEqual({ headless: true, timeoutMs: 2_500 });
  });
});
