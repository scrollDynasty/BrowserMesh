import { describe, expect, it } from 'vitest';
import { runDoctor, doctorCheckIds } from '../../src/application/doctor.js';
import type { DataDirectoryProbePort } from '../../src/application/ports/data-directory.js';
import { FakeEngine } from '../support/fakes.js';

const accessible: DataDirectoryProbePort = { probe: async () => undefined };

describe('doctor', () => {
  it('returns the stable schema and required check IDs after a complete smoke cleanup', async () => {
    const engine = new FakeEngine();
    const result = await runDoctor({
      engine,
      dataDirectory: accessible,
      nodeVersion: '24.1.0',
      minimumNodeMajor: 22,
      packageVersion: '0.1.3',
      runtimeVersion: '0.1.3',
      operationTimeoutMs: 1_000,
      overallTimeoutMs: 5_000,
    });

    expect(result.schemaVersion).toBe('1');
    expect(result.status).toBe('passed');
    expect(result.checks.map(({ id }) => id)).toEqual(doctorCheckIds);
    expect(engine.started).toBe(false);
    expect(engine.contexts.size).toBe(0);
    expect(engine.pages.size).toBe(0);
  });

  it('reports bounded safe failures and still performs the smoke', async () => {
    const engine = new FakeEngine();
    engine.isExecutableAvailable = async () => false;
    const dataDirectory: DataDirectoryProbePort = {
      probe: async () => {
        throw new Error('C:\\Users\\private\\secret-data');
      },
    };
    const result = await runDoctor({
      engine,
      dataDirectory,
      nodeVersion: '20.0.0',
      minimumNodeMajor: 22,
      packageVersion: '0.1.3',
      runtimeVersion: '9.9.9',
      operationTimeoutMs: 1_000,
      overallTimeoutMs: 5_000,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find(({ id }) => id === 'node-version')?.code).toBe('NODE_UNSUPPORTED');
    expect(result.checks.find(({ id }) => id === 'version-consistency')?.code).toBe(
      'VERSION_MISMATCH',
    );
    expect(result.checks.find(({ id }) => id === 'chromium-executable')?.code).toBe(
      'CHROMIUM_MISSING',
    );
    expect(JSON.stringify(result)).not.toContain('private');
    expect(engine.started).toBe(false);
  });

  it('classifies a real-smoke missing executable without leaking adapter errors', async () => {
    const engine = new FakeEngine();
    engine.start = async () => {
      throw new Error('Executable does not exist at C:\\private\\chromium; install-browser');
    };
    const result = await runDoctor({
      engine,
      dataDirectory: accessible,
      nodeVersion: '24.1.0',
      minimumNodeMajor: 22,
      packageVersion: '0.1.3',
      runtimeVersion: '0.1.3',
      operationTimeoutMs: 1_000,
      overallTimeoutMs: 5_000,
    });

    expect(result.checks.at(-1)?.code).toBe('CHROMIUM_MISSING');
    expect(JSON.stringify(result)).not.toContain('C:\\private');
    expect(engine.started).toBe(false);
  });

  it('reports cleanup failures while still stopping every diagnostic resource', async () => {
    const engine = new FakeEngine();
    engine.closePage = async () => {
      throw new Error('close page failed');
    };
    const result = await runDoctor({
      engine,
      dataDirectory: accessible,
      nodeVersion: '24.1.0',
      minimumNodeMajor: 22,
      packageVersion: '0.1.3',
      runtimeVersion: '0.1.3',
      operationTimeoutMs: 1_000,
      overallTimeoutMs: 5_000,
    });

    expect(result.checks.at(-1)?.code).toBe('BROWSER_CLEANUP_FAILED');
    expect(engine.started).toBe(false);
    expect(engine.contexts.size).toBe(0);
    expect(engine.pages.size).toBe(0);
  });

  it('does not start the smoke after the overall deadline is exhausted', async () => {
    const engine = new FakeEngine();
    let clock = 0;
    const result = await runDoctor({
      engine,
      dataDirectory: {
        probe: async () => {
          clock = 101;
        },
      },
      nodeVersion: '24.1.0',
      minimumNodeMajor: 22,
      packageVersion: '0.1.3',
      runtimeVersion: '0.1.3',
      operationTimeoutMs: 1_000,
      overallTimeoutMs: 100,
      now: () => clock,
    });

    expect(result.checks.find(({ id }) => id === 'browser-smoke')?.code).toBe(
      'DIAGNOSTIC_DEADLINE_EXCEEDED',
    );
    expect(engine.started).toBe(false);
  });
});
