import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const secret = 'fatal-token-do-not-expose';

const childSource = String.raw`
import { writeFile } from 'node:fs/promises';
import { installFatalProcessHandlers } from './src/infrastructure/fatal-process-handlers.ts';

const mode = process.env.BROWSERMESH_FATAL_TEST_MODE;
const marker = process.env.BROWSERMESH_FATAL_TEST_MARKER;
const secret = process.env.BROWSERMESH_FATAL_TEST_SECRET;
if (!mode || !marker || !secret) throw new Error('Missing test configuration');

installFatalProcessHandlers({
  shutdown: async () => {
    await writeFile(marker, 'cleaned', 'utf8');
    if (mode === 'cleanup-failure') throw new Error('password=cleanup-secret');
  },
});

let reason;
if (mode === 'error') reason = new Error(secret);
else if (mode === 'object') reason = { message: secret, cause: { token: secret } };
else if (mode === 'getter') {
  reason = Object.create(null);
  Object.defineProperty(reason, 'message', { get() { throw new Error(secret); } });
} else {
  reason = new Proxy({}, { get() { throw new Error(secret); } });
}

if (mode === 'error' || mode === 'getter') queueMicrotask(() => { throw reason; });
else void Promise.reject(reason);
`;

describe('fatal process handling', () => {
  it.each(['error', 'object', 'getter', 'proxy', 'cleanup-failure'] as const)(
    'sanitizes %s reasons, performs cleanup, and exits non-zero',
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), 'browsermesh-fatal-'));
      const marker = join(directory, 'cleanup.txt');
      try {
        let failure: unknown;
        try {
          await execFileAsync(
            process.execPath,
            ['--import', 'tsx', '--input-type=module', '--eval', childSource],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                BROWSERMESH_FATAL_TEST_MODE: mode,
                BROWSERMESH_FATAL_TEST_MARKER: marker,
                BROWSERMESH_FATAL_TEST_SECRET: secret,
              },
              timeout: 10_000,
            },
          );
        } catch (error) {
          failure = error;
        }
        const result = z
          .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
          .parse(failure);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toContain(secret);
        expect(result.stderr).not.toContain('cleanup-secret');
        expect(result.stderr).not.toContain('password=');
        const diagnostics = result.stderr
          .trim()
          .split('\n')
          .map((line): unknown => JSON.parse(line) as unknown);
        expect(diagnostics[0]).toMatchObject({
          level: 'error',
          code: 'INTERNAL_ERROR',
        });
        expect(diagnostics).toHaveLength(mode === 'cleanup-failure' ? 2 : 1);
        expect(await readFile(marker, 'utf8')).toBe('cleaned');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
