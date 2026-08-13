import type {
  ActionAndWaitResult,
  ActionWaitCondition,
  BrowserAction,
  BrowserStorageState,
  ElementReferenceView,
  ElementTarget,
  Locator,
  SnapshotOptions,
  WaitCondition,
} from '../../domain/models.js';
import type { BrowserObservation } from '../../domain/observability.js';
import type { OperationControl } from '../operation-control.js';
import type { BrowserContextSettings } from '../../domain/context-settings.js';

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

export type { BrowserObservation } from '../../domain/observability.js';

export interface BrowserEnginePort {
  diagnostics(): BrowserEngineDiagnostics;
  isExecutableAvailable(): Promise<boolean>;
  onDisconnected(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  createContext(options: {
    readonly control: OperationControl;
    readonly storageState?: BrowserStorageState;
    readonly settings: BrowserContextSettings;
  }): Promise<BrowserContextHandle>;
  closeContext(context: BrowserContextHandle): Promise<void>;
  createPage(context: BrowserContextHandle): Promise<BrowserPageHandle>;
  listPages(context: BrowserContextHandle): readonly BrowserPageHandle[];
  closePage(page: BrowserPageHandle): Promise<void>;
  observePage(
    page: BrowserPageHandle,
    options: { readonly maxInFlightRequests: number; readonly maxStringLength: number },
    listener: (event: BrowserObservation) => void,
  ): () => void;
  url(page: BrowserPageHandle): string;
  title(page: BrowserPageHandle, control: OperationControl): Promise<string>;
  navigate(page: BrowserPageHandle, url: string, control: OperationControl): Promise<void>;
  back(page: BrowserPageHandle, control: OperationControl): Promise<void>;
  forward(page: BrowserPageHandle, control: OperationControl): Promise<void>;
  reload(page: BrowserPageHandle, control: OperationControl): Promise<void>;
  click(page: BrowserPageHandle, target: ElementTarget, control: OperationControl): Promise<void>;
  doubleClick(
    page: BrowserPageHandle,
    target: ElementTarget,
    control: OperationControl,
  ): Promise<void>;
  hover(page: BrowserPageHandle, target: ElementTarget, control: OperationControl): Promise<void>;
  focus(page: BrowserPageHandle, target: ElementTarget, control: OperationControl): Promise<void>;
  check(page: BrowserPageHandle, target: ElementTarget, control: OperationControl): Promise<void>;
  uncheck(page: BrowserPageHandle, target: ElementTarget, control: OperationControl): Promise<void>;
  scrollIntoView(
    page: BrowserPageHandle,
    target: ElementTarget,
    control: OperationControl,
  ): Promise<void>;
  fill(
    page: BrowserPageHandle,
    target: ElementTarget,
    value: string,
    control: OperationControl,
  ): Promise<void>;
  press(
    page: BrowserPageHandle,
    target: ElementTarget,
    key: string,
    control: OperationControl,
  ): Promise<void>;
  selectOption(
    page: BrowserPageHandle,
    target: ElementTarget,
    value: string,
    control: OperationControl,
  ): Promise<void>;
  snapshot(
    page: BrowserPageHandle,
    options: Pick<
      SnapshotOptions,
      'scope' | 'maxDepth' | 'includeBoundingBoxes' | 'includeRefs' | 'maxRefs'
    >,
    control: OperationControl,
  ): Promise<{ readonly snapshot: string; readonly refs: readonly ElementReferenceView[] }>;
  visibleText(
    page: BrowserPageHandle,
    locator: Locator,
    control: OperationControl,
  ): Promise<string>;
  screenshot(page: BrowserPageHandle, control: OperationControl): Promise<Uint8Array>;
  wait(page: BrowserPageHandle, condition: WaitCondition, control: OperationControl): Promise<void>;
  actionAndWait(
    page: BrowserPageHandle,
    action: BrowserAction,
    wait: ActionWaitCondition,
    control: OperationControl,
  ): Promise<ActionAndWaitResult['event']>;
  storageState(context: BrowserContextHandle): Promise<BrowserStorageState>;
}
