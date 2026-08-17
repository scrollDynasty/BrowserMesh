import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { doctorCheckIds } from '../../src/application/doctor.js';

const execFileAsync = promisify(execFile);
const doctorSchema = z.object({
  schemaVersion: z.literal('1'),
  status: z.enum(['passed', 'failed']),
  checks: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['passed', 'failed']),
      code: z.string().min(1),
      message: z.string().max(256),
      remediation: z.string().max(256).nullable(),
    }),
  ),
});

describe('doctor CLI', () => {
  it('runs a real bounded Chromium smoke and emits only schema-versioned JSON', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'browsermesh-doctor-'));
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', '--doctor', '--json'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            BROWSERMESH_DATA_DIR: dataDirectory,
            BROWSERMESH_HEADLESS: 'true',
            BROWSERMESH_LOG_LEVEL: 'silent',
          },
          timeout: 45_000,
        },
      );
      expect(stderr).toBe('');
      const result = doctorSchema.parse(JSON.parse(stdout));
      expect(result.status).toBe('passed');
      expect(result.checks.map(({ id }) => id)).toEqual(doctorCheckIds);
      expect(stdout).not.toContain(dataDirectory);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 50_000);

  it('rejects unknown arguments with usage and a non-zero exit', async () => {
    try {
      await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--unknown'], {
        cwd: process.cwd(),
      });
      throw new Error('Unknown CLI argument unexpectedly succeeded');
    } catch (error) {
      const failure = z
        .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
        .parse(error);
      expect(failure.code).toBe(2);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain('Usage:');
    }
    // Each case here starts a Node process that compiles the project through
    // tsx before it prints anything. Several such tests run in parallel with
    // the other integration files, so the default 15s allows for the run but
    // not for the compilation; the assertions are unchanged.
  }, 60_000);

  it('answers help and version on stdout and exits cleanly', async () => {
    for (const [flag, expected] of [
      ['--help', 'Usage:'],
      ['--version', '.'],
    ] as const) {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', flag],
        { cwd: process.cwd() },
      );

      // Exiting non-zero on `--help` is the most common reason a first-time
      // user concludes a CLI is broken; `execFileAsync` rejects on non-zero.
      expect(stdout, flag).toContain(expected);
      expect(stderr, flag).toBe('');
    }
  }, 60_000);

  it.each([
    [
      'a rejected environment value',
      { BROWSERMESH_MAX_SESSIONS: 'abc' },
      [],
      'BROWSERMESH_MAX_SESSIONS',
    ],
    ['an unknown tool profile', {}, ['--tools', 'typo'], 'Unknown tool profile'],
  ])(
    'reports %s without a stack trace',
    async (_case, environment, argv, expected) => {
      // Startup failures are resolved before the fatal-process handlers exist, so
      // each one has to be caught where it is raised. An uncaught throw reaches
      // the terminal as a stack trace naming absolute paths, which is both
      // unreadable and the diagnostic leak the runtime otherwise avoids.
      try {
        await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...argv], {
          cwd: process.cwd(),
          env: { ...process.env, ...environment },
        });
        throw new Error('Invalid startup configuration unexpectedly succeeded');
      } catch (error) {
        const failure = z
          .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
          .parse(error);
        expect(failure.code).toBe(2);
        expect(failure.stderr).toContain(expected);
        expect(failure.stderr).not.toContain('    at ');
        expect(failure.stderr).not.toContain('.ts:');
      }
    },
    60_000,
  );

  it('reports a failed browser installation without a stack trace', async () => {
    // `--install-browser` runs outside the configuration guard and before the
    // fatal-process handlers exist, so a rejected download used to surface as
    // an unhandled top-level rejection with a raw stack and absolute paths.
    // Pointing Playwright's browser root at a file makes the installer fail
    // immediately and deterministically, without touching the network.
    const occupied = join(await mkdtemp(join(tmpdir(), 'browsermesh-install-')), 'not-a-directory');
    await writeFile(occupied, '');
    try {
      await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', '--install-browser'],
        { cwd: process.cwd(), env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: occupied } },
      );
      throw new Error('A failed installation unexpectedly succeeded');
    } catch (error) {
      const failure = z
        .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
        .parse(error);
      expect(failure.code).toBe(1);
      expect(failure.stderr).toContain('Chromium installation failed');
      // Playwright's own diagnostics still reach stderr, which is intended;
      // what must not appear is a Node stack frame from BrowserMesh itself.
      expect(failure.stderr).not.toContain('    at ');
      expect(failure.stderr).not.toContain('src/cli.ts');
    } finally {
      await rm(occupied, { force: true });
    }
  }, 60_000);
});
