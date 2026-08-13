import { PlaywrightBrowserEngine } from './adapters/playwright/playwright-browser-engine.js';
import { FileSystemStateRepository } from './adapters/persistence/filesystem-state-repository.js';
import type {
  BrowserEngineLaunchOptions,
  BrowserEnginePort,
} from './application/ports/browser-engine.js';
import type { BrowserMeshConfig } from './infrastructure/config.js';
import { uuidGenerator } from './infrastructure/id.js';
import { StructuredLogger } from './infrastructure/logger.js';
import { BROWSERMESH_VERSION, PLAYWRIGHT_VERSION } from './infrastructure/generated/version.js';
import { BrowserMeshRuntime } from './runtime/browsermesh-runtime.js';

export interface CreateRuntimeDependencies {
  createBrowserEngine(options: BrowserEngineLaunchOptions): BrowserEnginePort;
}

const defaultDependencies: CreateRuntimeDependencies = {
  createBrowserEngine: (options) => new PlaywrightBrowserEngine(options),
};

export function createRuntime(
  config: BrowserMeshConfig,
  dependencies: CreateRuntimeDependencies = defaultDependencies,
): BrowserMeshRuntime {
  return new BrowserMeshRuntime({
    engine: dependencies.createBrowserEngine({
      headless: config.headless,
      timeoutMs: config.defaultTimeoutMs,
    }),
    stateRepository: new FileSystemStateRepository(config.dataDirectory),
    events: new StructuredLogger(config.logLevel),
    ids: uuidGenerator,
    defaultTimeoutMs: config.defaultTimeoutMs,
    maxSessions: config.maxSessions,
    maxPagesPerSession: config.maxPagesPerSession,
    persistenceEnabled: config.persistenceEnabled,
    serverVersion: BROWSERMESH_VERSION,
    nodeVersion: process.versions.node,
    playwrightVersion: PLAYWRIGHT_VERSION,
    headless: config.headless,
  });
}
