import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  defaultDataDirectory,
  loadConfig,
} from '../../src/infrastructure/config.js';

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

  it('names the rejected variable without leaking a stack or the value', () => {
    // Configuration is resolved before the fatal-process handlers exist, so an
    // unformatted throw reached the terminal as a raw stack trace naming
    // absolute paths. The message has to be readable and say nothing else.
    let thrown: unknown;
    try {
      loadConfig({ BROWSERMESH_MAX_SESSIONS: 'abc' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    const message = (thrown as ConfigurationError).message;
    expect(message).toContain('BROWSERMESH_MAX_SESSIONS');
    expect(message).not.toContain('abc');
    expect(message).not.toContain('.ts');
    expect(message).not.toContain(sep);
    expect(message.split('\n')).toHaveLength(2);
  });

  it('reports every rejected variable at once', () => {
    // One variable per run would make fixing a broken configuration a
    // restart-per-mistake loop.
    let message = '';
    try {
      loadConfig({ BROWSERMESH_MAX_SESSIONS: 'abc', BROWSERMESH_LOG_LEVEL: 'chatty' });
    } catch (error) {
      message = (error as ConfigurationError).message;
    }

    expect(message).toContain('BROWSERMESH_MAX_SESSIONS');
    expect(message).toContain('BROWSERMESH_LOG_LEVEL');
  });

  it('keeps saved state in one place regardless of the working directory', () => {
    // An MCP client spawns BrowserMesh from whichever directory it happens to
    // be in, so resolving the default against the working directory scattered
    // saved authentication state across unrelated folders.
    const defaults = loadConfig({});

    expect(defaults.dataDirectory).toBe(resolve(defaultDataDirectory()));
    expect(defaults.dataDirectory).not.toBe(resolve('.browsermesh'));
    expect(loadConfig({ BROWSERMESH_DATA_DIR: '.browsermesh' }).dataDirectory).toBe(
      resolve('.browsermesh'),
    );
  });
});
