import type {
  BrowserContextHandle,
  BrowserEnginePort,
  BrowserPageHandle,
} from '../application/ports/browser-engine.js';
import type { EventSinkPort } from '../application/ports/events.js';
import type { SavedStateView, StateRepositoryPort } from '../application/ports/state-repository.js';
import { BrowserMeshError } from '../domain/errors.js';
import type {
  Locator,
  OperationResult,
  PageView,
  SessionStatus,
  SessionView,
} from '../domain/models.js';
import type { IdGenerator } from '../infrastructure/id.js';
import { SerialQueue } from './serial-queue.js';

interface PageEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly handle: BrowserPageHandle;
}

interface SessionEntry {
  readonly id: string;
  readonly name?: string;
  status: SessionStatus;
  readonly createdAt: string;
  lastActivityAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly restoredFromStateId: string | undefined;
  context: BrowserContextHandle | undefined;
  readonly pages: Map<string, PageEntry>;
  defaultPageId: string | undefined;
  readonly queue: SerialQueue;
  accepting: boolean;
  disconnected: boolean;
}

export interface RuntimeOptions {
  readonly engine: BrowserEnginePort;
  readonly stateRepository: StateRepositoryPort;
  readonly events: EventSinkPort;
  readonly ids: IdGenerator;
  readonly now?: () => Date;
  readonly defaultTimeoutMs: number;
  readonly maxSessions: number;
  readonly maxPagesPerSession: number;
  readonly persistenceEnabled: boolean;
}

export interface OperationTarget {
  readonly sessionId: string;
  readonly pageId: string;
  readonly timeoutMs?: number;
}

export class BrowserMeshRuntime {
  private readonly sessions = new Map<string, SessionEntry>();
  private accepting = true;
  private started = false;
  private shutdownPromise: Promise<void> | undefined;
  private readonly now: () => Date;
  private readonly removeDisconnectListener: () => void;

  constructor(private readonly options: RuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    this.removeDisconnectListener = options.engine.onDisconnected(() =>
      this.handleEngineDisconnected(),
    );
  }

  async start(): Promise<void> {
    this.ensureAccepting();
    if (this.started) return;
    await this.options.engine.start();
    this.started = true;
  }

  async createSession(
    input: {
      readonly name?: string | undefined;
      readonly metadata?: Readonly<Record<string, string>> | undefined;
      readonly stateId?: string | undefined;
    } = {},
  ): Promise<OperationResult<SessionView>> {
    this.ensureAccepting();
    if (this.activeSessionCount() >= this.options.maxSessions) {
      throw new BrowserMeshError(
        'LIMIT_EXCEEDED',
        `Maximum of ${String(this.options.maxSessions)} active sessions reached`,
      );
    }
    const id = this.options.ids.next('session');
    const timestamp = this.timestamp();
    const entry: SessionEntry = {
      id,
      ...(input.name === undefined ? {} : { name: input.name }),
      status: 'creating',
      createdAt: timestamp,
      lastActivityAt: timestamp,
      metadata: { ...(input.metadata ?? {}) },
      restoredFromStateId: input.stateId,
      context: undefined,
      pages: new Map(),
      defaultPageId: undefined,
      queue: new SerialQueue(),
      accepting: true,
      disconnected: false,
    };
    this.sessions.set(id, entry);
    return this.runOperation(
      { sessionId: id },
      () =>
        entry.queue.run(async () => {
          try {
            const storageState =
              input.stateId === undefined ? undefined : await this.loadState(input.stateId);
            entry.context = await this.options.engine.createContext({
              timeoutMs: this.options.defaultTimeoutMs,
              ...(storageState === undefined ? {} : { storageState }),
            });
            const initialPage = await this.options.engine.createPage(entry.context);
            const page = this.addPage(entry, initialPage);
            entry.defaultPageId = page.id;
            entry.status = 'ready';
            this.emit('session.created', { sessionId: id, pageId: page.id });
            return this.sessionView(entry);
          } catch (error) {
            entry.status = 'failed';
            entry.accepting = false;
            if (entry.context !== undefined) {
              try {
                await this.options.engine.closeContext(entry.context);
              } catch (cleanupError) {
                throw new BrowserMeshError(
                  'BROWSER_ERROR',
                  'Session creation and context cleanup both failed',
                  { cause: new AggregateError([error, cleanupError]) },
                );
              }
            }
            throw error;
          }
        }),
      () => (entry.defaultPageId === undefined ? {} : { pageId: entry.defaultPageId }),
    );
  }

  listSessions(): Promise<OperationResult<readonly SessionView[]>> {
    return this.runOperation({}, () => {
      this.ensureAccepting();
      return Array.from(this.sessions.values(), (entry) => this.sessionView(entry));
    });
  }

  getSession(sessionId: string): Promise<OperationResult<SessionView>> {
    return this.runOperation({ sessionId }, () => {
      this.ensureAccepting();
      return this.sessionView(this.getSessionEntry(sessionId));
    });
  }

  closeSession(sessionId: string): Promise<OperationResult<SessionView>> {
    return this.runOperation({ sessionId }, () => {
      this.ensureAccepting();
      const entry = this.getSessionEntry(sessionId);
      if (entry.status !== 'closed' && entry.status !== 'failed') entry.accepting = false;
      return this.closeSessionEntry(entry);
    });
  }

  createPage(sessionId: string): Promise<OperationResult<PageView>> {
    return this.runOperation(
      { sessionId },
      () =>
        this.withSession(sessionId, async (entry) => {
          if (entry.pages.size >= this.options.maxPagesPerSession) {
            throw new BrowserMeshError(
              'LIMIT_EXCEEDED',
              `Maximum of ${String(this.options.maxPagesPerSession)} pages per session reached`,
            );
          }
          const context = this.requireContext(entry);
          const page = this.addPage(entry, await this.options.engine.createPage(context));
          this.emit('page.created', { sessionId, pageId: page.id });
          return this.pageView(entry, page);
        }),
      (page) => ({ pageId: page.id }),
    );
  }

  listPages(sessionId: string): Promise<OperationResult<readonly PageView[]>> {
    return this.runOperation({ sessionId }, () =>
      this.withSession(sessionId, (entry) =>
        Promise.resolve(Array.from(entry.pages.values(), (page) => this.pageView(entry, page))),
      ),
    );
  }

  closePage(sessionId: string, pageId: string): Promise<OperationResult<null>> {
    return this.runOperation({ sessionId, pageId }, () =>
      this.withSession(sessionId, async (entry) => {
        const page = this.getPageEntry(entry, pageId);
        await this.options.engine.closePage(page.handle);
        entry.pages.delete(pageId);
        if (entry.defaultPageId === pageId) entry.defaultPageId = entry.pages.keys().next().value;
        this.emit('page.closed', { sessionId, pageId });
        return null;
      }),
    );
  }

  async navigate(target: OperationTarget, url: string): Promise<OperationResult<string>> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      throw new BrowserMeshError('INVALID_ARGUMENT', 'URL must be absolute', { cause: error });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BrowserMeshError('INVALID_ARGUMENT', 'Only http and https URLs are allowed');
    }
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.navigate(page, parsed.href, timeoutMs);
      return this.options.engine.url(page);
    });
  }

  back(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.back(page, timeoutMs);
      return this.options.engine.url(page);
    });
  }

  forward(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.forward(page, timeoutMs);
      return this.options.engine.url(page);
    });
  }

  reload(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.reload(page, timeoutMs);
      return this.options.engine.url(page);
    });
  }

  getUrl(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, (page) => Promise.resolve(this.options.engine.url(page)));
  }

  getTitle(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, (page, timeoutMs) =>
      this.options.engine.title(page, timeoutMs),
    );
  }

  snapshot(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, (page, timeoutMs) =>
      this.options.engine.snapshot(page, timeoutMs),
    );
  }

  visibleText(target: OperationTarget, locator: Locator): Promise<OperationResult<string>> {
    return this.pageOperation(target, (page, timeoutMs) =>
      this.options.engine.visibleText(page, locator, timeoutMs),
    );
  }

  click(target: OperationTarget, locator: Locator): Promise<OperationResult<null>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.click(page, locator, timeoutMs);
      return null;
    });
  }

  fill(target: OperationTarget, locator: Locator, value: string): Promise<OperationResult<null>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.fill(page, locator, value, timeoutMs);
      return null;
    });
  }

  press(target: OperationTarget, locator: Locator, key: string): Promise<OperationResult<null>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.press(page, locator, key, timeoutMs);
      return null;
    });
  }

  selectOption(
    target: OperationTarget,
    locator: Locator,
    value: string,
  ): Promise<OperationResult<null>> {
    return this.pageOperation(target, async (page, timeoutMs) => {
      await this.options.engine.selectOption(page, locator, value, timeoutMs);
      return null;
    });
  }

  screenshot(target: OperationTarget): Promise<OperationResult<string>> {
    return this.pageOperation(target, async (page, timeoutMs) =>
      Buffer.from(await this.options.engine.screenshot(page, timeoutMs)).toString('base64'),
    );
  }

  saveSessionState(sessionId: string, stateId: string): Promise<OperationResult<SavedStateView>> {
    return this.runOperation({ sessionId }, async () => {
      this.ensureAccepting();
      this.ensurePersistence();
      return this.withSession(sessionId, async (entry) =>
        this.options.stateRepository.save(
          stateId,
          await this.options.engine.storageState(this.requireContext(entry)),
        ),
      );
    });
  }

  listSavedStates(): Promise<OperationResult<readonly SavedStateView[]>> {
    return this.runOperation({}, () => {
      this.ensureAccepting();
      this.ensurePersistence();
      return this.options.stateRepository.list();
    });
  }

  removeSavedState(stateId: string): Promise<OperationResult<null>> {
    return this.runOperation({}, async () => {
      this.ensureAccepting();
      this.ensurePersistence();
      await this.options.stateRepository.remove(stateId);
      return null;
    });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.accepting = false;
    this.shutdownPromise = (async () => {
      const active = Array.from(this.sessions.values()).filter(
        (entry) => entry.status !== 'closed',
      );
      for (const entry of active) entry.accepting = false;
      const closeResults = await Promise.allSettled(
        active.map((entry) => this.closeSessionEntry(entry)),
      );
      let stopFailure: unknown;
      try {
        await this.options.engine.stop();
      } catch (error) {
        stopFailure = error;
      }
      this.started = false;
      this.removeDisconnectListener();
      const failures: unknown[] = [];
      for (const result of closeResults) {
        if (result.status === 'rejected') {
          const reason: unknown = result.reason;
          failures.push(reason);
        }
      }
      if (stopFailure !== undefined) failures.push(stopFailure);
      if (failures.length > 0) throw new AggregateError(failures, 'BrowserMesh shutdown failed');
    })();
    return this.shutdownPromise;
  }

  private runOperation<T>(
    identifiers: { readonly sessionId?: string; readonly pageId?: string },
    action: () => T | Promise<T>,
    identifyValue?: (value: T) => { readonly sessionId?: string; readonly pageId?: string },
  ): Promise<OperationResult<T>> {
    const operationId = this.options.ids.next('operation');
    this.emit('operation.started', { operationId, ...identifiers });
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(action());
    } catch (error) {
      this.emit('operation.failed', { operationId, ...identifiers });
      return Promise.reject(
        error instanceof Error
          ? error
          : new BrowserMeshError('INTERNAL_ERROR', 'Operation failed with a non-error value', {
              cause: error,
            }),
      );
    }
    return pending.then(
      (value) => {
        const resolved = { ...identifiers, ...(identifyValue?.(value) ?? {}) };
        this.emit('operation.completed', { operationId, ...resolved });
        return { operationId, ...resolved, value };
      },
      (error: unknown) => {
        this.emit('operation.failed', { operationId, ...identifiers });
        throw error;
      },
    );
  }

  private async pageOperation<T>(
    target: OperationTarget,
    action: (page: BrowserPageHandle, timeoutMs: number) => Promise<T>,
  ): Promise<OperationResult<T>> {
    const operationId = this.options.ids.next('operation');
    const timeoutMs = target.timeoutMs ?? this.options.defaultTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        'timeoutMs must be an integer between 1 and 300000',
      );
    }
    this.emit('operation.started', {
      operationId,
      sessionId: target.sessionId,
      pageId: target.pageId,
    });
    try {
      const value = await this.withSession(target.sessionId, async (entry) => {
        const page = this.getPageEntry(entry, target.pageId);
        return action(page.handle, timeoutMs);
      });
      this.emit('operation.completed', {
        operationId,
        sessionId: target.sessionId,
        pageId: target.pageId,
      });
      return { operationId, sessionId: target.sessionId, pageId: target.pageId, value };
    } catch (error) {
      this.emit('operation.failed', {
        operationId,
        sessionId: target.sessionId,
        pageId: target.pageId,
      });
      throw error;
    }
  }

  private async withSession<T>(
    sessionId: string,
    action: (entry: SessionEntry) => Promise<T>,
  ): Promise<T> {
    this.ensureAccepting();
    const entry = this.readySession(sessionId);
    if (!entry.accepting)
      throw new BrowserMeshError('SESSION_CLOSED', `Session '${sessionId}' is closing or closed`);
    return entry.queue.run(async () => {
      if (entry.disconnected)
        throw new BrowserMeshError(
          'BROWSER_DISCONNECTED',
          `Session '${sessionId}' failed because Chromium disconnected`,
        );
      if (entry.status !== 'ready')
        throw new BrowserMeshError('SESSION_NOT_READY', `Session '${sessionId}' is not ready`);
      const result = await action(entry);
      entry.lastActivityAt = this.timestamp();
      return result;
    });
  }

  private readySession(sessionId: string): SessionEntry {
    const entry = this.getSessionEntry(sessionId);
    if (entry.status === 'closing' || (entry.status === 'ready' && !entry.accepting))
      throw new BrowserMeshError('SESSION_CLOSING', `Session '${sessionId}' is closing`);
    if (entry.status === 'closed')
      throw new BrowserMeshError('SESSION_CLOSED', `Session '${sessionId}' is closed`);
    if (entry.status === 'failed' && entry.disconnected)
      throw new BrowserMeshError(
        'BROWSER_DISCONNECTED',
        `Session '${sessionId}' failed because Chromium disconnected`,
      );
    if (entry.status !== 'ready')
      throw new BrowserMeshError('SESSION_NOT_READY', `Session '${sessionId}' is not ready`);
    return entry;
  }

  private getSessionEntry(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined)
      throw new BrowserMeshError('SESSION_NOT_FOUND', `Session '${sessionId}' was not found`);
    return entry;
  }

  private getPageEntry(entry: SessionEntry, pageId: string): PageEntry {
    const page = entry.pages.get(pageId);
    if (page === undefined)
      throw new BrowserMeshError(
        'PAGE_NOT_FOUND',
        `Page '${pageId}' was not found in session '${entry.id}'`,
      );
    return page;
  }

  private addPage(entry: SessionEntry, handle: BrowserPageHandle): PageEntry {
    const page: PageEntry = {
      id: this.options.ids.next('page'),
      createdAt: this.timestamp(),
      handle,
    };
    entry.pages.set(page.id, page);
    return page;
  }

  private sessionView(entry: SessionEntry): SessionView {
    return {
      id: entry.id,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      status: entry.status,
      createdAt: entry.createdAt,
      lastActivityAt: entry.lastActivityAt,
      metadata: { ...entry.metadata },
      ...(entry.restoredFromStateId === undefined
        ? {}
        : { restoredFromStateId: entry.restoredFromStateId }),
    };
  }

  private pageView(entry: SessionEntry, page: PageEntry): PageView {
    return {
      id: page.id,
      sessionId: entry.id,
      createdAt: page.createdAt,
      url: this.options.engine.url(page.handle),
      isDefault: entry.defaultPageId === page.id,
    };
  }

  private requireContext(entry: SessionEntry): BrowserContextHandle {
    if (entry.context === undefined)
      throw new BrowserMeshError(
        'SESSION_NOT_READY',
        `Session '${entry.id}' has no browser context`,
      );
    return entry.context;
  }

  private activeSessionCount(): number {
    return Array.from(this.sessions.values()).filter(
      (entry) => entry.status !== 'closed' && entry.status !== 'failed',
    ).length;
  }

  private async loadState(
    name: string,
  ): Promise<import('../domain/models.js').BrowserStorageState> {
    this.ensurePersistence();
    return this.options.stateRepository.load(name);
  }

  private ensurePersistence(): void {
    if (!this.options.persistenceEnabled)
      throw new BrowserMeshError('PERSISTENCE_DISABLED', 'Persistence is disabled');
  }

  private ensureAccepting(): void {
    if (!this.accepting)
      throw new BrowserMeshError('RUNTIME_SHUTTING_DOWN', 'Runtime is shutting down');
  }

  private closeFailedSession(entry: SessionEntry): SessionView {
    entry.status = 'closed';
    entry.accepting = false;
    entry.pages.clear();
    entry.context = undefined;
    this.rememberClosedSession(entry);
    return this.sessionView(entry);
  }

  private async closeSessionEntry(entry: SessionEntry): Promise<SessionView> {
    if (entry.status === 'closed') return this.sessionView(entry);
    if (entry.status === 'failed') return this.closeFailedSession(entry);
    return entry.queue.run(async () => {
      if (entry.status === 'closed') return this.sessionView(entry);
      if (entry.status === 'failed') return this.closeFailedSession(entry);
      entry.status = 'closing';
      if (entry.context !== undefined) await this.options.engine.closeContext(entry.context);
      entry.pages.clear();
      entry.defaultPageId = undefined;
      entry.context = undefined;
      entry.status = 'closed';
      entry.lastActivityAt = this.timestamp();
      this.emit('session.closed', { sessionId: entry.id });
      this.rememberClosedSession(entry);
      return this.sessionView(entry);
    });
  }

  private rememberClosedSession(entry: SessionEntry): void {
    this.sessions.delete(entry.id);
    this.sessions.set(entry.id, entry);
    const retentionLimit = Math.max(1, this.options.maxSessions);
    const closedIds = Array.from(this.sessions.values())
      .filter((candidate) => candidate.status === 'closed')
      .map((candidate) => candidate.id);
    for (const expiredId of closedIds.slice(0, -retentionLimit)) {
      this.sessions.delete(expiredId);
    }
  }

  private handleEngineDisconnected(): void {
    this.started = false;
    for (const entry of this.sessions.values()) {
      if (entry.status === 'creating' || entry.status === 'ready' || entry.status === 'closing') {
        entry.status = 'failed';
        entry.accepting = false;
        entry.disconnected = true;
        entry.context = undefined;
        entry.pages.clear();
        entry.defaultPageId = undefined;
        entry.lastActivityAt = this.timestamp();
        this.emit('session.failed', { sessionId: entry.id });
      }
    }
    this.emit('browser.disconnected', {});
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private emit(
    type: string,
    identifiers: {
      readonly operationId?: string;
      readonly sessionId?: string;
      readonly pageId?: string;
    },
  ): void {
    this.options.events.emit({ type, timestamp: this.timestamp(), ...identifiers });
  }
}
