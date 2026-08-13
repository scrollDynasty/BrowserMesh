import { describe, expect, it } from 'vitest';
import { classifyBrowserFailure } from '../../src/adapters/playwright/error-classification.js';

describe('browser failure classification', () => {
  it.each([
    [Object.assign(new Error('waiting for locator'), { name: 'TimeoutError' }), 'timeout'],
    [new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://missing.example'), 'dns'],
    [new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1'), 'connection'],
    [new Error('page.goto: net::ERR_CERT_AUTHORITY_INVALID'), 'tls'],
    [new Error('page.goto: Cannot navigate to invalid URL'), 'invalid_url'],
    [
      new Error('locator.click: strict mode violation: resolved to 2 elements'),
      'locator_ambiguous',
    ],
    [new Error('detached element'), 'element_not_found'],
  ] as const)('classifies %s as %s', (error, expected) => {
    expect(classifyBrowserFailure(error, 'element_not_found')).toBe(expected);
  });

  it('uses a safe fallback for unknown and hostile engine errors', () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error('secret getter');
        },
      },
    );
    expect(classifyBrowserFailure(hostile)).toBe('other');
    expect(classifyBrowserFailure('ECONNRESET')).toBe('connection');
  });

  it('does not let URL text override a more specific network reason', () => {
    expect(
      classifyBrowserFailure(
        new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://timeout.example'),
      ),
    ).toBe('dns');
  });
});
