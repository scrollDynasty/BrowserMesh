import type {
  BrowserContextHandle,
  BrowserEnginePort,
  BrowserPageHandle,
} from '../../src/application/ports/browser-engine.js';
import type { EventSinkPort, RuntimeEvent } from '../../src/application/ports/events.js';
import type {
  SavedStateView,
  StateRepositoryPort,
} from '../../src/application/ports/state-repository.js';
import { BrowserMeshError } from '../../src/domain/errors.js';
import type { BrowserStorageState, Locator } from '../../src/domain/models.js';
import type {
  ActionAndWaitResult,
  ActionWaitCondition,
  BrowserAction,
  WaitCondition,
} from '../../src/domain/models.js';
import type { IdGenerator } from '../../src/infrastructure/id.js';
import { BrowserMeshRuntime, type RuntimeOptions } from '../../src/runtime/browsermesh-runtime.js';

interface FakeContext extends BrowserContextHandle {
  pages: Set<symbol>;
  closed: boolean;
}
interface FakePage extends BrowserPageHandle {
  contextId: symbol;
  currentUrl: string;
  closed: boolean;
}

export class FakeEngine implements BrowserEnginePort {
  readonly contexts = new Map<symbol, FakeContext>();
  readonly pages = new Map<symbol, FakePage>();
  activeGlobal = 0;
  maxActiveGlobal = 0;
  readonly maxActiveByContext = new Map<symbol, number>();
  private readonly activeByContext = new Map<symbol, number>();
  delayMs = 5;
  started = false;
  failNextNavigation = false;
  navigationGate: Promise<void> | undefined;
  onNavigationStart: (() => void) | undefined;
  waitGate: Promise<void> | undefined;
  failNextWait = false;
  readonly compositeOrder: string[] = [];
  compositeGate: Promise<void> | undefined;
  onCompositeStart: (() => void) | undefined;
  private readonly disconnectedListeners = new Set<() => void>();

  diagnostics(): { launchState: 'not_started' | 'ready'; browserVersion: string | null } {
    return {
      launchState: this.started ? 'ready' : 'not_started',
      browserVersion: this.started ? '123.0.0.0' : null,
    };
  }

  async isExecutableAvailable(): Promise<boolean> {
    return true;
  }

  get disconnectListenerCount(): number {
    return this.disconnectedListeners.size;
  }

  onDisconnected(listener: () => void): () => void {
    this.disconnectedListeners.add(listener);
    return () => this.disconnectedListeners.delete(listener);
  }

  disconnect(): void {
    this.started = false;
    this.contexts.clear();
    this.pages.clear();
    for (const listener of this.disconnectedListeners) listener();
  }

  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.started = false;
    this.contexts.clear();
    this.pages.clear();
  }
  async createContext(): Promise<BrowserContextHandle> {
    const context: FakeContext = { id: Symbol('context'), pages: new Set(), closed: false };
    this.contexts.set(context.id, context);
    return context;
  }
  async closeContext(handle: BrowserContextHandle): Promise<void> {
    const context = this.contexts.get(handle.id);
    if (context === undefined) return;
    context.closed = true;
    for (const pageId of context.pages) this.pages.delete(pageId);
    this.contexts.delete(handle.id);
  }
  async createPage(handle: BrowserContextHandle): Promise<BrowserPageHandle> {
    const context = this.contexts.get(handle.id);
    if (context === undefined) throw new Error('closed context');
    const page: FakePage = {
      id: Symbol('page'),
      contextId: handle.id,
      currentUrl: 'about:blank',
      closed: false,
    };
    context.pages.add(page.id);
    this.pages.set(page.id, page);
    return page;
  }
  listPages(handle: BrowserContextHandle): readonly BrowserPageHandle[] {
    const context = this.contexts.get(handle.id);
    return context === undefined ? [] : Array.from(context.pages, (id) => ({ id }));
  }
  async closePage(handle: BrowserPageHandle): Promise<void> {
    const page = this.pages.get(handle.id);
    if (page === undefined) return;
    page.closed = true;
    this.pages.delete(handle.id);
    this.contexts.get(page.contextId)?.pages.delete(page.id);
  }
  url(handle: BrowserPageHandle): string {
    return this.page(handle).currentUrl;
  }
  async title(): Promise<string> {
    return 'Fake';
  }
  async navigate(handle: BrowserPageHandle, url: string): Promise<void> {
    const page = this.page(handle);
    this.onNavigationStart?.();
    await this.concurrent(page.contextId, async () => {
      if (this.navigationGate !== undefined) await this.navigationGate;
      if (this.failNextNavigation) {
        this.failNextNavigation = false;
        throw new BrowserMeshError('NAVIGATION_FAILED', 'simulated navigation failure');
      }
      page.currentUrl = url;
    });
  }
  async back(): Promise<void> {}
  async forward(): Promise<void> {}
  async reload(): Promise<void> {}
  async click(): Promise<void> {}
  async fill(): Promise<void> {}
  async press(): Promise<void> {}
  async selectOption(): Promise<void> {}
  async snapshot(): Promise<string> {
    return '- document';
  }
  async visibleText(_page: BrowserPageHandle, locator: Locator): Promise<string> {
    return locator.value;
  }
  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array([137, 80, 78, 71]);
  }
  async wait(handle: BrowserPageHandle, condition: WaitCondition): Promise<void> {
    const page = this.page(handle);
    await this.concurrent(page.contextId, async () => {
      if (this.waitGate !== undefined) await this.waitGate;
      if (this.failNextWait) {
        this.failNextWait = false;
        throw new BrowserMeshError('OPERATION_TIMEOUT', 'simulated wait timeout');
      }
      if (
        condition.kind === 'url' &&
        condition.matcher.kind === 'exact' &&
        page.currentUrl !== condition.matcher.value
      )
        throw new BrowserMeshError('OPERATION_TIMEOUT', 'simulated wait timeout');
    });
  }
  async actionAndWait(
    handle: BrowserPageHandle,
    action: BrowserAction,
    wait: ActionWaitCondition,
  ): Promise<ActionAndWaitResult['event']> {
    const page = this.page(handle);
    this.compositeOrder.push('waiter');
    this.onCompositeStart?.();
    if (this.compositeGate !== undefined) await this.compositeGate;
    this.compositeOrder.push(action.kind);
    if (this.failNextWait) {
      this.failNextWait = false;
      throw new BrowserMeshError('OPERATION_TIMEOUT', 'simulated wait timeout');
    }
    if (wait.kind === 'navigation') {
      const url = wait.matcher?.value ?? page.currentUrl;
      page.currentUrl = url;
      return { kind: 'navigation', url };
    }
    return {
      kind: 'response',
      url: wait.matcher.value,
      method: wait.method ?? 'GET',
      status: wait.status ?? 200,
    };
  }
  async storageState(): Promise<BrowserStorageState> {
    return { cookies: [], origins: [] };
  }

  private page(handle: BrowserPageHandle): FakePage {
    const page = this.pages.get(handle.id);
    if (page === undefined) throw new BrowserMeshError('PAGE_NOT_FOUND', 'closed');
    return page;
  }
  private async concurrent(contextId: symbol, action: () => Promise<void>): Promise<void> {
    this.activeGlobal += 1;
    const active = (this.activeByContext.get(contextId) ?? 0) + 1;
    this.activeByContext.set(contextId, active);
    this.maxActiveGlobal = Math.max(this.maxActiveGlobal, this.activeGlobal);
    this.maxActiveByContext.set(
      contextId,
      Math.max(this.maxActiveByContext.get(contextId) ?? 0, active),
    );
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
      await action();
    } finally {
      this.activeGlobal -= 1;
      this.activeByContext.set(contextId, active - 1);
    }
  }
}

export class MemoryStates implements StateRepositoryPort {
  readonly states = new Map<string, BrowserStorageState>();
  async save(stateId: string, state: BrowserStorageState): Promise<SavedStateView> {
    this.states.set(stateId, state);
    return { stateId, createdAt: new Date(0).toISOString() };
  }
  async load(stateId: string): Promise<BrowserStorageState> {
    const state = this.states.get(stateId);
    if (state === undefined) throw new BrowserMeshError('SAVED_STATE_NOT_FOUND', stateId);
    return state;
  }
  async list(): Promise<readonly SavedStateView[]> {
    return Array.from(this.states.keys(), (stateId) => ({
      stateId,
      createdAt: new Date(0).toISOString(),
    }));
  }
  async remove(stateId: string): Promise<void> {
    this.states.delete(stateId);
  }
}

export function testRuntime(
  engine = new FakeEngine(),
  overrides: Partial<
    Pick<
      RuntimeOptions,
      'defaultTimeoutMs' | 'maxSessions' | 'maxPagesPerSession' | 'persistenceEnabled'
    >
  > = {},
): {
  runtime: BrowserMeshRuntime;
  engine: FakeEngine;
  events: readonly RuntimeEvent[];
} {
  let id = 0;
  const ids: IdGenerator = { next: (prefix) => `${prefix}_${++id}` };
  const emittedEvents: RuntimeEvent[] = [];
  const events: EventSinkPort = { emit: (event) => emittedEvents.push(event) };
  return {
    runtime: new BrowserMeshRuntime({
      engine,
      stateRepository: new MemoryStates(),
      events,
      ids,
      now: () => new Date(0),
      defaultTimeoutMs: 1_000,
      maxSessions: 50,
      maxPagesPerSession: 5,
      persistenceEnabled: true,
      serverVersion: '0.1.3-test',
      nodeVersion: '24.0.0-test',
      playwrightVersion: '1.62.1-test',
      headless: true,
      ...overrides,
    }),
    engine,
    events: emittedEvents,
  };
}
