import type { BrowserStorageState, Locator } from '../../domain/models.js';

export interface BrowserPageHandle {
  readonly id: symbol;
}

export interface BrowserContextHandle {
  readonly id: symbol;
}

export interface BrowserEngineLaunchOptions {
  readonly headless: boolean;
  readonly timeoutMs: number;
}

export type BrowserLaunchState = 'not_started' | 'ready' | 'failed';

export interface BrowserEngineDiagnostics {
  readonly launchState: BrowserLaunchState;
  readonly browserVersion: string | null;
}

export interface BrowserEnginePort {
  diagnostics(): BrowserEngineDiagnostics;
  isExecutableAvailable(): Promise<boolean>;
  onDisconnected(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  createContext(options: {
    readonly timeoutMs: number;
    readonly storageState?: BrowserStorageState;
  }): Promise<BrowserContextHandle>;
  closeContext(context: BrowserContextHandle): Promise<void>;
  createPage(context: BrowserContextHandle): Promise<BrowserPageHandle>;
  listPages(context: BrowserContextHandle): readonly BrowserPageHandle[];
  closePage(page: BrowserPageHandle): Promise<void>;
  url(page: BrowserPageHandle): string;
  title(page: BrowserPageHandle, timeoutMs: number): Promise<string>;
  navigate(page: BrowserPageHandle, url: string, timeoutMs: number): Promise<void>;
  back(page: BrowserPageHandle, timeoutMs: number): Promise<void>;
  forward(page: BrowserPageHandle, timeoutMs: number): Promise<void>;
  reload(page: BrowserPageHandle, timeoutMs: number): Promise<void>;
  click(page: BrowserPageHandle, locator: Locator, timeoutMs: number): Promise<void>;
  fill(page: BrowserPageHandle, locator: Locator, value: string, timeoutMs: number): Promise<void>;
  press(page: BrowserPageHandle, locator: Locator, key: string, timeoutMs: number): Promise<void>;
  selectOption(
    page: BrowserPageHandle,
    locator: Locator,
    value: string,
    timeoutMs: number,
  ): Promise<void>;
  snapshot(page: BrowserPageHandle, timeoutMs: number): Promise<string>;
  visibleText(page: BrowserPageHandle, locator: Locator, timeoutMs: number): Promise<string>;
  screenshot(page: BrowserPageHandle, timeoutMs: number): Promise<Uint8Array>;
  storageState(context: BrowserContextHandle): Promise<BrowserStorageState>;
}
