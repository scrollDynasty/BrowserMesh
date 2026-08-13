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
    });
    expect(
      loadConfig({
        BROWSERMESH_TIMEOUT_MS: '2500',
        BROWSERMESH_MAX_SESSIONS: '2',
        BROWSERMESH_MAX_PAGES: '3',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_HEADLESS: 'true',
      }),
    ).toMatchObject({
      defaultTimeoutMs: 2_500,
      maxSessions: 2,
      maxPagesPerSession: 3,
      persistenceEnabled: false,
      headless: true,
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
    for (const invalid of ['', 'TRUE', '1', 'yes']) {
      expect(() => loadConfig({ BROWSERMESH_HEADLESS: invalid })).toThrow();
    }
  });
});
