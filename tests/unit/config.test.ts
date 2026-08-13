import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/infrastructure/config.js';

describe('loadConfig', () => {
  it('applies documented defaults and parses explicit values', () => {
    const defaults = loadConfig({});
    expect(defaults).toMatchObject({
      defaultTimeoutMs: 10_000,
      maxSessions: 50,
      maxPagesPerSession: 20,
      persistenceEnabled: true,
      headless: false,
      observability: {
        maxEventsPerPage: 200,
        maxStringLength: 2_048,
        maxPageSize: 100,
        maxResponseBytes: 65_536,
      },
      resources: {
        screenshot: { maxDimensionPixels: 10_000, maxPixels: 40_000_000, maxBytes: 16_777_216 },
        visibleText: { maxChars: 20_000, maxBytes: 65_536 },
        persistence: { maxStates: 100, maxStateBytes: 1_048_576, maxTotalBytes: 16_777_216 },
      },
    });
    expect(
      loadConfig({
        BROWSERMESH_TIMEOUT_MS: '2500',
        BROWSERMESH_MAX_SESSIONS: '2',
        BROWSERMESH_MAX_PAGES: '3',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_SCREENSHOT_MAX_BYTES: '4096',
        BROWSERMESH_VISIBLE_TEXT_MAX_CHARS: '500',
        BROWSERMESH_MAX_SAVED_STATES: '4',
      }),
    ).toMatchObject({
      defaultTimeoutMs: 2_500,
      maxSessions: 2,
      maxPagesPerSession: 3,
      persistenceEnabled: false,
      headless: true,
      resources: {
        screenshot: { maxBytes: 4_096 },
        visibleText: { maxChars: 500 },
        persistence: { maxStates: 4 },
      },
    });
  });

  it('rejects invalid booleans, timeouts, and limits', () => {
    expect(() => loadConfig({ BROWSERMESH_TIMEOUT_MS: '0' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_MAX_SESSIONS: '1001' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_MAX_PAGES: '-1' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_OBSERVABILITY_EVENTS: '1001' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_OBSERVABILITY_STRING_CHARS: '127' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_OBSERVABILITY_PAGE_SIZE: '201' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_OBSERVABILITY_RESPONSE_BYTES: '1023' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_SCREENSHOT_MAX_DIMENSION: '255' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_SCREENSHOT_MAX_PIXELS: '65535' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_SCREENSHOT_MAX_BYTES: '1023' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_VISIBLE_TEXT_MAX_CHARS: '127' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_VISIBLE_TEXT_MAX_BYTES: '511' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_MAX_SAVED_STATES: '10001' })).toThrow();
    for (const invalid of ['', 'TRUE', '1', 'yes']) {
      expect(() => loadConfig({ BROWSERMESH_HEADLESS: invalid })).toThrow();
    }
  });
});
