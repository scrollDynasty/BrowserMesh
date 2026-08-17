import { describe, expect, it } from 'vitest';
import { parseArguments, usageText } from '../../src/infrastructure/cli-arguments.js';

describe('command-line arguments', () => {
  it('serves with no overrides when invoked bare', () => {
    expect(parseArguments([])).toEqual({ kind: 'serve', overrides: {} });
  });

  it('answers help and version instead of failing', () => {
    // Returning a usage error for `--help` is the single most common way a
    // first-time user concludes a CLI is broken.
    for (const flag of ['--help', '-h']) expect(parseArguments([flag]).kind).toBe('help');
    for (const flag of ['--version', '-v']) expect(parseArguments([flag]).kind).toBe('version');
  });

  it('runs doctor with and without machine-readable output', () => {
    expect(parseArguments(['--doctor'])).toEqual({ kind: 'doctor', json: false, overrides: {} });
    expect(parseArguments(['--doctor', '--json'])).toEqual({
      kind: 'doctor',
      json: true,
      overrides: {},
    });
  });

  it('translates options into the variables that already configure them', () => {
    const command = parseArguments([
      '--headless',
      '--timeout',
      '30000',
      '--data-dir=/tmp/state',
      '--tools',
      'core,persistence',
      '--no-persistence',
      '--max-sessions=4',
    ]);

    expect(command).toEqual({
      kind: 'serve',
      overrides: {
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_TIMEOUT_MS: '30000',
        BROWSERMESH_DATA_DIR: '/tmp/state',
        BROWSERMESH_TOOLS: 'core,persistence',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_MAX_SESSIONS: '4',
      },
    });
  });

  it('lets a later option win so a wrapper script can override its caller', () => {
    expect(parseArguments(['--headless', '--headed'])).toEqual({
      kind: 'serve',
      overrides: { BROWSERMESH_HEADLESS: 'false' },
    });
  });

  it('reports a missing value rather than swallowing the next flag', () => {
    expect(parseArguments(['--timeout'])).toEqual({
      kind: 'usage-error',
      message: '--timeout requires a value',
    });
    expect(parseArguments(['--timeout', '--headless'])).toEqual({
      kind: 'usage-error',
      message: '--timeout requires a value',
    });
  });

  it('rejects unknown and misused options', () => {
    expect(parseArguments(['--nope'])).toMatchObject({ kind: 'usage-error' });
    expect(parseArguments(['--headless=yes'])).toEqual({
      kind: 'usage-error',
      message: '--headless does not take a value',
    });
    expect(parseArguments(['--json'])).toEqual({
      kind: 'usage-error',
      message: '--json is only meaningful with --doctor',
    });
    // `--install-browser` has no JSON form, so accepting the flag and dropping
    // it would leave a script parsing plain installer output as JSON.
    expect(parseArguments(['--install-browser', '--json'])).toEqual({
      kind: 'usage-error',
      message: '--json is only meaningful with --doctor',
    });
    expect(parseArguments(['--install-browser', '--doctor'])).toMatchObject({
      kind: 'usage-error',
    });
  });

  it('documents every option it accepts', () => {
    const text = usageText();

    for (const flag of [
      '--headless',
      '--headed',
      '--timeout',
      '--data-dir',
      '--tools',
      '--no-persistence',
      '--no-schema-refs',
      '--no-auto-install',
      '--install-browser',
      '--doctor',
    ]) {
      expect(text, flag).toContain(flag);
    }
  });
});
