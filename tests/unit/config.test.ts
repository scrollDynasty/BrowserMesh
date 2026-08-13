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
    for (const invalid of ['', 'TRUE', '1', 'yes']) {
      expect(() => loadConfig({ BROWSERMESH_HEADLESS: invalid })).toThrow();
    }
  });
});
