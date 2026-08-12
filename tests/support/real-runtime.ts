import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import { FileSystemStateRepository } from '../../src/adapters/persistence/filesystem-state-repository.js';
import { uuidGenerator } from '../../src/infrastructure/id.js';
import { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';

export async function realRuntime(): Promise<BrowserMeshRuntime> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'browsermesh-integration-'));
  return new BrowserMeshRuntime({
    engine: new PlaywrightBrowserEngine(true),
    stateRepository: new FileSystemStateRepository(dataDirectory),
    events: { emit: () => undefined },
    ids: uuidGenerator,
    defaultTimeoutMs: 5_000,
    maxSessions: 50,
    maxPagesPerSession: 10,
    persistenceEnabled: true,
  });
}
