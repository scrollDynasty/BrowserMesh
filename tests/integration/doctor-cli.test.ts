import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
  });
});
