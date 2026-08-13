import type { BrowserStorageState, Locator } from '../../domain/models.js';
import type { OperationControl } from '../operation-control.js';

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
    readonly control: OperationControl;
    readonly storageState?: BrowserStorageState;
  }): Promise<BrowserContextHandle>;
  closeContext(context: BrowserContextHandle): Promise<void>;
  createPage(context: BrowserContextHandle): Promise<BrowserPageHandle>;
  listPages(context: BrowserContextHandle): readonly BrowserPageHandle[];
  closePage(page: BrowserPageHandle): Promise<void>;
  url(page: BrowserPageHandle): string;
  title(page: BrowserPageHandle, control: OperationControl): Promise<string>;
  navigate(page: BrowserPageHandle, url: string, control: OperationControl): Promise<void>;
  back(page: BrowserPageHandle, control: OperationControl): Promise<void>;
  forward(page: BrowserPageHandle, control: OperationControl): Promise<void>;
  reload(page: BrowserPageHandle, control: OperationControl): Promise<void>;
  click(page: BrowserPageHandle, locator: Locator, control: OperationControl): Promise<void>;
  fill(
    page: BrowserPageHandle,
    locator: Locator,
    value: string,
    control: OperationControl,
  ): Promise<void>;
  press(
    page: BrowserPageHandle,
    locator: Locator,
    key: string,
    control: OperationControl,
  ): Promise<void>;
  selectOption(
    page: BrowserPageHandle,
    locator: Locator,
    value: string,
    control: OperationControl,
  ): Promise<void>;
  snapshot(page: BrowserPageHandle, control: OperationControl): Promise<string>;
  visibleText(
    page: BrowserPageHandle,
    locator: Locator,
    control: OperationControl,
  ): Promise<string>;
  screenshot(page: BrowserPageHandle, control: OperationControl): Promise<Uint8Array>;
  storageState(context: BrowserContextHandle): Promise<BrowserStorageState>;
}
