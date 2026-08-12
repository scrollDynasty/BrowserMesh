import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import { FileSystemStateRepository } from '../../src/adapters/persistence/filesystem-state-repository.js';
import { uuidGenerator } from '../../src/infrastructure/id.js';
import { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';

export interface RealRuntimeHarness {
  readonly runtime: BrowserMeshRuntime;
  readonly engine: PlaywrightBrowserEngine;
  cleanup(): Promise<void>;
}

export async function createRealRuntimeHarness(): Promise<RealRuntimeHarness> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'browsermesh-integration-'));
  const engine = new PlaywrightBrowserEngine(true);
  const runtime = new BrowserMeshRuntime({
    engine,
    stateRepository: new FileSystemStateRepository(dataDirectory),
    events: { emit: () => undefined },
    ids: uuidGenerator,
    defaultTimeoutMs: 5_000,
    maxSessions: 50,
    maxPagesPerSession: 10,
    persistenceEnabled: true,
  });
  return {
    runtime,
    engine,
    async cleanup(): Promise<void> {
      try {
        await runtime.shutdown();
      } finally {
        await rm(dataDirectory, { recursive: true, force: true });
      }
    },
  };
}
