import { PlaywrightBrowserEngine } from './adapters/playwright/playwright-browser-engine.js';
import { FileSystemStateRepository } from './adapters/persistence/filesystem-state-repository.js';
import type { BrowserMeshConfig } from './infrastructure/config.js';
import { uuidGenerator } from './infrastructure/id.js';
import { StructuredLogger } from './infrastructure/logger.js';
import { BrowserMeshRuntime } from './runtime/browsermesh-runtime.js';

export function createRuntime(config: BrowserMeshConfig): BrowserMeshRuntime {
  return new BrowserMeshRuntime({
    engine: new PlaywrightBrowserEngine(),
    stateRepository: new FileSystemStateRepository(config.dataDirectory),
    events: new StructuredLogger(config.logLevel),
    ids: uuidGenerator,
    defaultTimeoutMs: config.defaultTimeoutMs,
    maxSessions: config.maxSessions,
    maxPagesPerSession: config.maxPagesPerSession,
    persistenceEnabled: config.persistenceEnabled,
  });
}
