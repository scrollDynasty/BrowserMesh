import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';

describe('PlaywrightBrowserEngine', () => {
  it('launches headed by default', () => {
    const engine = new PlaywrightBrowserEngine();

    expect(Reflect.get(engine, 'headless')).toBe(false);
  });
});
