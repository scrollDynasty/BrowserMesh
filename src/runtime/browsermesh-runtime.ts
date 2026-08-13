import type {
  BrowserContextHandle,
  BrowserEnginePort,
  BrowserPageHandle,
} from '../application/ports/browser-engine.js';
import type { EventSinkPort } from '../application/ports/events.js';
import type { SavedStateView, StateRepositoryPort } from '../application/ports/state-repository.js';
import {
  createOperationControl,
  isCancellation,
  throwIfCancelled,
  type OperationControl,
} from '../application/operation-control.js';
import { BrowserMeshError, correlateBrowserMeshError } from '../domain/errors.js';
import type {
  ActionAndWaitResult,
  ActionWaitCondition,
  BrowserAction,
  Locator,
  OperationResult,
  PageAddressedOperationResult,
  PageView,
  SessionStatus,
  SessionView,
  UrlMatcher,
  WaitCondition,
  WaitResult,
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
  readonly serverVersion: string;
  readonly nodeVersion: string;
  readonly playwrightVersion: string;
  readonly headless: boolean;
}

export interface BrowserRuntimeInfo {
  readonly serverVersion: string;
  readonly nodeVersion: string;
  readonly playwrightVersion: string;
  readonly browserProduct: 'chromium';
  readonly browserVersion: string | null;
  readonly browserLaunchState: 'not_started' | 'ready' | 'failed';
  readonly headless: boolean;
  readonly persistenceEnabled: boolean;
  readonly defaultTimeoutMs: number;
  readonly maxSessions: number;
  readonly maxPagesPerSession: number;
  readonly activeSessions: number;
  readonly failedSessions: number;
}

export interface OperationTarget {
  readonly sessionId: string;
  readonly pageId: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface OperationOptions {
  readonly signal?: AbortSignal;
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

  runtimeInfo(): BrowserRuntimeInfo {
    const diagnostics = this.options.engine.diagnostics();
    return {
      serverVersion: this.options.serverVersion,
      nodeVersion: this.options.nodeVersion,
      playwrightVersion: this.options.playwrightVersion,
      browserProduct: 'chromium',
      browserVersion: diagnostics.browserVersion,
      browserLaunchState: diagnostics.launchState,
      headless: this.options.headless,
      persistenceEnabled: this.options.persistenceEnabled,
      defaultTimeoutMs: this.options.defaultTimeoutMs,
      maxSessions: this.options.maxSessions,
      maxPagesPerSession: this.options.maxPagesPerSession,
      activeSessions: this.activeSessionCount(),
      failedSessions: Array.from(this.sessions.values()).filter(({ status }) => status === 'failed')
        .length,
    };
  }

  createSession(
    input: {
      readonly name?: string | undefined;
      readonly metadata?: Readonly<Record<string, string>> | undefined;
      readonly stateId?: string | undefined;
    } = {},
    options: OperationOptions = {},
  ): Promise<PageAddressedOperationResult<SessionView>> {
    let createdPageId: string | undefined;
    return this.runOperation(
      {},
      () => {
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
        const control = createOperationControl(this.options.defaultTimeoutMs, options.signal);
        return entry.queue.run(async () => {
          try {
            const storageState =
              input.stateId === undefined ? undefined : await this.loadState(input.stateId);
            entry.context = await this.options.engine.createContext({
              control,
              ...(storageState === undefined ? {} : { storageState }),
            });
            if (entry.disconnected) {
              throw new BrowserMeshError(
                'BROWSER_DISCONNECTED',
                `Session '${id}' failed because Chromium disconnected during creation`,
              );
            }
            const initialPage = await this.options.engine.createPage(entry.context);
            const page = this.addPage(entry, initialPage);
            entry.defaultPageId = page.id;
            createdPageId = page.id;
            entry.status = 'ready';
            this.emit('session.created', { sessionId: id, pageId: page.id });
            return this.sessionView(entry);
          } catch (error) {
            entry.status = 'failed';
            entry.accepting = false;
            let failure = error;
            if (entry.context !== undefined) {
              try {
                await this.options.engine.closeContext(entry.context);
              } catch (cleanupError) {
                failure = new BrowserMeshError(
                  'BROWSER_ERROR',
                  'Session creation and context cleanup both failed',
                  { cause: new AggregateError([error, cleanupError]) },
                );
              }
            }
            entry.pages.clear();
            entry.defaultPageId = undefined;
            entry.context = undefined;
            this.rememberTerminalSession(entry);
            throw failure;
          }
        }, options.signal);
      },
      (session) => ({
        sessionId: session.sessionId,
        ...(createdPageId === undefined ? {} : { pageId: createdPageId }),
      }),
      options,
    ).then((result) => this.requirePageAddress(result));
  }

  listSessions(options: OperationOptions = {}): Promise<OperationResult<readonly SessionView[]>> {
    return this.runOperation(
      {},
      () => {
        this.ensureAccepting();
        return Array.from(this.sessions.values(), (entry) => this.sessionView(entry));
      },
      undefined,
      options,
    );
  }

  getSession(
    sessionId: string,
    options: OperationOptions = {},
  ): Promise<OperationResult<SessionView>> {
    return this.runOperation(
      { sessionId },
      () => {
        this.ensureAccepting();
        return this.sessionView(this.getSessionEntry(sessionId));
      },
      undefined,
      options,
    );
  }

  closeSession(
    sessionId: string,
    options: OperationOptions = {},
  ): Promise<OperationResult<SessionView>> {
    return this.runOperation(
      { sessionId },
      () => {
        this.ensureAccepting();
        const entry = this.getSessionEntry(sessionId);
        if (entry.status !== 'closed' && entry.status !== 'failed') entry.accepting = false;
        return this.closeSessionEntry(entry);
      },
      undefined,
      options,
    );
  }

  createPage(
    sessionId: string,
    options: OperationOptions = {},
  ): Promise<PageAddressedOperationResult<PageView>> {
    return this.runOperation(
      { sessionId },
      () =>
        this.withSession(
          sessionId,
          async (entry) => {
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
          },
          options.signal,
        ),
      (page) => ({ pageId: page.pageId }),
      options,
    ).then((result) => this.requirePageAddress(result));
  }

  listPages(
    sessionId: string,
    options: OperationOptions = {},
  ): Promise<OperationResult<readonly PageView[]>> {
    return this.runOperation(
      { sessionId },
      () =>
        this.withSession(
          sessionId,
          (entry) =>
            Promise.resolve(Array.from(entry.pages.values(), (page) => this.pageView(entry, page))),
          options.signal,
        ),
      undefined,
      options,
    );
  }

  closePage(
    sessionId: string,
    pageId: string,
    options: OperationOptions = {},
  ): Promise<OperationResult<null>> {
    return this.runOperation(
      { sessionId, pageId },
      () =>
        this.withSession(
          sessionId,
          async (entry) => {
            const page = this.getPageEntry(entry, pageId);
            await this.options.engine.closePage(page.handle);
            entry.pages.delete(pageId);
            if (entry.defaultPageId === pageId)
              entry.defaultPageId = entry.pages.keys().next().value;
            this.emit('page.closed', { sessionId, pageId });
            return null;
          },
          options.signal,
        ),
      undefined,
      options,
    );
  }

  async navigate(
    target: OperationTarget,
    url: string,
  ): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, async (page, control) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (error) {
        throw new BrowserMeshError('INVALID_ARGUMENT', 'URL must be absolute', { cause: error });
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new BrowserMeshError('INVALID_ARGUMENT', 'Only http and https URLs are allowed');
      }
      await this.options.engine.navigate(page, parsed.href, control);
      return this.options.engine.url(page);
    });
  }

  back(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.back(page, control);
      return this.options.engine.url(page);
    });
  }

  forward(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.forward(page, control);
      return this.options.engine.url(page);
    });
  }

  reload(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.reload(page, control);
      return this.options.engine.url(page);
    });
  }

  getUrl(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, (page) => Promise.resolve(this.options.engine.url(page)));
  }

  getTitle(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, (page, control) => this.options.engine.title(page, control));
  }

  snapshot(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, (page, control) =>
      this.options.engine.snapshot(page, control),
    );
  }

  visibleText(
    target: OperationTarget,
    locator: Locator,
  ): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, (page, control) =>
      this.options.engine.visibleText(page, locator, control),
    );
  }

  click(target: OperationTarget, locator: Locator): Promise<PageAddressedOperationResult<null>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.click(page, locator, control);
      return null;
    });
  }

  fill(
    target: OperationTarget,
    locator: Locator,
    value: string,
  ): Promise<PageAddressedOperationResult<null>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.fill(page, locator, value, control);
      return null;
    });
  }

  press(
    target: OperationTarget,
    locator: Locator,
    key: string,
  ): Promise<PageAddressedOperationResult<null>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.press(page, locator, key, control);
      return null;
    });
  }

  selectOption(
    target: OperationTarget,
    locator: Locator,
    value: string,
  ): Promise<PageAddressedOperationResult<null>> {
    return this.pageOperation(target, async (page, control) => {
      await this.options.engine.selectOption(page, locator, value, control);
      return null;
    });
  }

  screenshot(target: OperationTarget): Promise<PageAddressedOperationResult<string>> {
    return this.pageOperation(target, async (page, control) =>
      Buffer.from(await this.options.engine.screenshot(page, control)).toString('base64'),
    );
  }

  wait(
    target: OperationTarget,
    condition: WaitCondition,
  ): Promise<PageAddressedOperationResult<WaitResult>> {
    return this.pageOperation(target, async (page, control) => {
      const normalized = normalizeWaitCondition(condition);
      await this.options.engine.wait(page, normalized, control);
      return { condition: normalized };
    });
  }

  actionAndWait(
    target: OperationTarget,
    action: BrowserAction,
    wait: ActionWaitCondition,
  ): Promise<PageAddressedOperationResult<ActionAndWaitResult>> {
    return this.pageOperation(target, async (page, control) => {
      const normalizedAction = normalizeAction(action);
      const normalizedWait = normalizeActionWait(wait);
      return {
        action: normalizedAction,
        wait: normalizedWait,
        event: await this.options.engine.actionAndWait(
          page,
          normalizedAction,
          normalizedWait,
          control,
        ),
      };
    });
  }

  saveSessionState(
    sessionId: string,
    stateId: string,
    options: OperationOptions = {},
  ): Promise<OperationResult<SavedStateView>> {
    return this.runOperation(
      { sessionId },
      async () => {
        this.ensureAccepting();
        this.ensurePersistence();
        return this.withSession(
          sessionId,
          async (entry) =>
            this.options.stateRepository.save(
              stateId,
              await this.options.engine.storageState(this.requireContext(entry)),
            ),
          options.signal,
        );
      },
      undefined,
      options,
    );
  }

  listSavedStates(
    options: OperationOptions = {},
  ): Promise<OperationResult<readonly SavedStateView[]>> {
    return this.runOperation(
      {},
      () => {
        this.ensureAccepting();
        this.ensurePersistence();
        return this.options.stateRepository.list();
      },
      undefined,
      options,
    );
  }

  removeSavedState(
    stateId: string,
    options: OperationOptions = {},
  ): Promise<OperationResult<null>> {
    return this.runOperation(
      {},
      async () => {
        this.ensureAccepting();
        this.ensurePersistence();
        await this.options.stateRepository.remove(stateId);
        return null;
      },
      undefined,
      options,
    );
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
    options: OperationOptions = {},
  ): Promise<OperationResult<T>> {
    const operationId = this.options.ids.next('operation');
    this.emit('operation.started', { operationId, ...identifiers });
    let pending: Promise<T>;
    try {
      throwIfCancelled(options.signal);
      pending = Promise.resolve(action());
    } catch (error) {
      this.emit('operation.failed', { operationId, ...identifiers });
      if (isCancellation(error)) return Promise.reject(error);
      return Promise.reject(correlateBrowserMeshError(error, operationId));
    }
    return pending.then(
      (value) => {
        const resolved = { ...identifiers, ...(identifyValue?.(value) ?? {}) };
        this.emit('operation.completed', { operationId, ...resolved });
        return { operationId, ...resolved, value };
      },
      (error: unknown) => {
        this.emit('operation.failed', { operationId, ...identifiers });
        if (isCancellation(error)) throw error;
        throw correlateBrowserMeshError(error, operationId);
      },
    );
  }

  private async pageOperation<T>(
    target: OperationTarget,
    action: (page: BrowserPageHandle, control: OperationControl) => Promise<T>,
  ): Promise<PageAddressedOperationResult<T>> {
    const operationId = this.options.ids.next('operation');
    const timeoutMs = target.timeoutMs ?? this.options.defaultTimeoutMs;
    const control = createOperationControl(timeoutMs, target.signal);
    this.emit('operation.started', {
      operationId,
      sessionId: target.sessionId,
      pageId: target.pageId,
    });
    try {
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
        throw new BrowserMeshError(
          'INVALID_ARGUMENT',
          'timeoutMs must be an integer between 1 and 300000',
        );
      }
      throwIfCancelled(target.signal);
      const value = await this.withSession(
        target.sessionId,
        async (entry) => {
          const page = this.getPageEntry(entry, target.pageId);
          return action(page.handle, control);
        },
        target.signal,
      );
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
      if (isCancellation(error)) throw error;
      throw correlateBrowserMeshError(error, operationId);
    }
  }

  private requirePageAddress<T>(result: OperationResult<T>): PageAddressedOperationResult<T> {
    if (result.sessionId === undefined || result.pageId === undefined) {
      throw new BrowserMeshError('INTERNAL_ERROR', 'Operation result is missing its page address');
    }
    return { ...result, sessionId: result.sessionId, pageId: result.pageId };
  }

  private async withSession<T>(
    sessionId: string,
    action: (entry: SessionEntry) => Promise<T>,
    signal?: AbortSignal,
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
    }, signal);
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
      sessionId: entry.id,
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
      pageId: page.id,
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
    this.rememberTerminalSession(entry);
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
      this.rememberTerminalSession(entry);
      return this.sessionView(entry);
    });
  }

  private rememberTerminalSession(entry: SessionEntry): void {
    this.sessions.delete(entry.id);
    this.sessions.set(entry.id, entry);
    this.pruneTerminalSessions();
  }

  private pruneTerminalSessions(): void {
    const retentionLimit = Math.max(1, this.options.maxSessions);
    const terminalIds = Array.from(this.sessions.values())
      .filter((candidate) => candidate.status === 'closed' || candidate.status === 'failed')
      .map((candidate) => candidate.id);
    for (const expiredId of terminalIds.slice(0, -retentionLimit)) {
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
    this.pruneTerminalSessions();
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

function normalizeMatcher(matcher: UrlMatcher): UrlMatcher {
  if (
    matcher.value.length === 0 ||
    matcher.value.length > 2_048 ||
    hasControlCharacters(matcher.value)
  )
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      'URL matcher value must contain 1 to 2048 characters without control characters',
    );
  if (matcher.kind === 'glob' && (matcher.value.match(/\*/g)?.length ?? 0) > 32)
    throw new BrowserMeshError('INVALID_ARGUMENT', 'URL glob may contain at most 32 wildcards');
  return { kind: matcher.kind, value: matcher.value };
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

function normalizeWaitCondition(condition: WaitCondition): WaitCondition {
  switch (condition.kind) {
    case 'url':
      return { kind: 'url', matcher: normalizeMatcher(condition.matcher) };
    case 'load':
      return { kind: 'load', state: condition.state };
    case 'locator':
      return { kind: 'locator', locator: condition.locator, state: condition.state };
    case 'text':
      if (condition.text.length === 0 || condition.text.length > 2_000)
        throw new BrowserMeshError(
          'INVALID_ARGUMENT',
          'Wait text must contain 1 to 2000 characters',
        );
      return { kind: 'text', text: condition.text, state: condition.state };
  }
}

function normalizeAction(action: BrowserAction): BrowserAction {
  if (action.kind === 'press') {
    if (action.key.length === 0 || action.key.length > 64)
      throw new BrowserMeshError('INVALID_ARGUMENT', 'Action key must contain 1 to 64 characters');
    return { kind: 'press', locator: action.locator, key: action.key };
  }
  return { kind: 'click', locator: action.locator };
}

function normalizeActionWait(wait: ActionWaitCondition): ActionWaitCondition {
  if (wait.kind === 'navigation')
    return {
      kind: 'navigation',
      ...(wait.matcher === undefined ? {} : { matcher: normalizeMatcher(wait.matcher) }),
      loadState: wait.loadState ?? 'load',
    };
  if (wait.method !== undefined && !/^[A-Z]{1,16}$/u.test(wait.method))
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      'Response method must be 1 to 16 uppercase letters',
    );
  if (
    wait.status !== undefined &&
    (!Number.isInteger(wait.status) || wait.status < 100 || wait.status > 599)
  )
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      'Response status must be an integer from 100 to 599',
    );
  return {
    kind: 'response',
    matcher: normalizeMatcher(wait.matcher),
    ...(wait.method === undefined ? {} : { method: wait.method }),
    ...(wait.status === undefined ? {} : { status: wait.status }),
  };
}
