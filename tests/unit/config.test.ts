import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/infrastructure/config.js';

describe('loadConfig', () => {
  it('applies documented defaults and parses explicit values', () => {
    const defaults = loadConfig({});
    expect(defaults).toMatchObject({
      headless: true,
      defaultTimeoutMs: 30_000,
      maxSessions: 50,
      maxPagesPerSession: 20,
      persistenceEnabled: true,
    });
    expect(
      loadConfig({
        BROWSERMESH_HEADLESS: 'false',
        BROWSERMESH_TIMEOUT_MS: '2500',
        BROWSERMESH_MAX_SESSIONS: '2',
        BROWSERMESH_MAX_PAGES: '3',
        BROWSERMESH_PERSISTENCE: 'false',
      }),
    ).toMatchObject({
      headless: false,
      defaultTimeoutMs: 2_500,
      maxSessions: 2,
      maxPagesPerSession: 3,
      persistenceEnabled: false,
    });
  });

  it('rejects invalid booleans, timeouts, and limits', () => {
    expect(() => loadConfig({ BROWSERMESH_HEADLESS: 'yes' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_TIMEOUT_MS: '0' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_MAX_SESSIONS: '1001' })).toThrow();
    expect(() => loadConfig({ BROWSERMESH_MAX_PAGES: '-1' })).toThrow();
  });
});
