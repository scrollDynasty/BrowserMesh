import type {
  BrowserContextHandle,
  BrowserEnginePort,
  BrowserPageHandle,
} from '../application/ports/browser-engine.js';
import type { EventSinkPort } from '../application/ports/events.js';
import type { SavedStateView, StateRepositoryPort } from '../application/ports/state-repository.js';
import { BrowserMeshError } from '../domain/errors.js';
import type {
  AgentView,
  JsonValue,
  Locator,
  MessageType,
  MessageView,
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
  ownerAgentId: string | undefined;
  readonly restoredFrom: string | undefined;
  context: BrowserContextHandle | undefined;
  readonly pages: Map<string, PageEntry>;
  defaultPageId: string | undefined;
  readonly queue: SerialQueue;
  accepting: boolean;
}

interface AgentEntry {
  readonly view: AgentView;
  readonly mailbox: MessageView[];
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
  readonly agentId?: string;
  readonly timeoutMs?: number;
}

export class BrowserMeshRuntime {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly agents = new Map<string, AgentEntry>();
  private accepting = true;
  private started = false;
  private shutdownPromise: Promise<void> | undefined;
  private readonly now: () => Date;

  constructor(private readonly options: RuntimeOptions) {
    this.now = options.now ?? (() => new Date());
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
      readonly fromState?: string | undefined;
      readonly ownerAgentId?: string | undefined;
    } = {},
  ): Promise<SessionView> {
    this.ensureAccepting();
    if (this.activeSessionCount() >= this.options.maxSessions) {
      throw new BrowserMeshError(
        'LIMIT_EXCEEDED',
        `Maximum of ${String(this.options.maxSessions)} active sessions reached`,
      );
    }
    if (input.ownerAgentId !== undefined) this.getAgentEntry(input.ownerAgentId);
    const id = this.options.ids.next('session');
    const timestamp = this.timestamp();
    const entry: SessionEntry = {
      id,
      ...(input.name === undefined ? {} : { name: input.name }),
      status: 'creating',
      createdAt: timestamp,
      lastActivityAt: timestamp,
      metadata: { ...(input.metadata ?? {}) },
      ownerAgentId: input.ownerAgentId,
      restoredFrom: input.fromState,
      context: undefined,
      pages: new Map(),
      defaultPageId: undefined,
      queue: new SerialQueue(),
      accepting: true,
    };
    this.sessions.set(id, entry);
    try {
      const storageState =
        input.fromState === undefined ? undefined : await this.loadState(input.fromState);
      entry.context = await this.options.engine.createContext({
        timeoutMs: this.options.defaultTimeoutMs,
        ...(storageState === undefined ? {} : { storageState }),
      });
      const initialPage = await this.options.engine.createPage(entry.context);
      const page = this.addPage(entry, initialPage);
      entry.defaultPageId = page.id;
      entry.status = 'ready';
      this.emit('session.created', { sessionId: id });
      return this.sessionView(entry);
    } catch (error) {
      entry.status = 'failed';
      entry.accepting = false;
      if (entry.context !== undefined)
        await this.options.engine.closeContext(entry.context).catch(() => undefined);
      throw error;
    }
  }

  listSessions(): readonly SessionView[] {
    return Array.from(this.sessions.values(), (entry) => this.sessionView(entry));
  }

  getSession(sessionId: string): SessionView {
    return this.sessionView(this.getSessionEntry(sessionId));
  }

  async closeSession(sessionId: string): Promise<SessionView> {
    const entry = this.getSessionEntry(sessionId);
    if (entry.status === 'closed') return this.sessionView(entry);
    if (entry.status === 'failed') return this.closeFailedSession(entry);
    if (!entry.accepting) {
      await entry.queue.idle();
      return this.sessionView(entry);
    }
    entry.accepting = false;
    return entry.queue.run(async () => {
      entry.status = 'closing';
      if (entry.context !== undefined) await this.options.engine.closeContext(entry.context);
      entry.pages.clear();
      entry.defaultPageId = undefined;
      entry.context = undefined;
      entry.status = 'closed';
      entry.lastActivityAt = this.timestamp();
      this.emit('session.closed', { sessionId });
      return this.sessionView(entry);
    });
  }

  async createPage(sessionId: string, agentId?: string): Promise<PageView> {
    return this.withSession(sessionId, agentId, async (entry) => {
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
    });
  }

  listPages(sessionId: string, agentId?: string): readonly PageView[] {
    const entry = this.readySession(sessionId, agentId);
    return Array.from(entry.pages.values(), (page) => this.pageView(entry, page));
  }

  async closePage(sessionId: string, pageId: string, agentId?: string): Promise<void> {
    await this.withSession(sessionId, agentId, async (entry) => {
      const page = this.getPageEntry(entry, pageId);
      await this.options.engine.closePage(page.handle);
      entry.pages.delete(pageId);
      if (entry.defaultPageId === pageId) entry.defaultPageId = entry.pages.keys().next().value;
      this.emit('page.closed', { sessionId, pageId });
    });
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

  async saveSessionState(
    sessionId: string,
    name: string,
    agentId?: string,
  ): Promise<SavedStateView> {
    this.ensurePersistence();
    return this.withSession(sessionId, agentId, async (entry) =>
      this.options.stateRepository.save(
        name,
        await this.options.engine.storageState(this.requireContext(entry)),
      ),
    );
  }

  async listSavedStates(): Promise<readonly SavedStateView[]> {
    this.ensurePersistence();
    return this.options.stateRepository.list();
  }

  async removeSavedState(name: string): Promise<void> {
    this.ensurePersistence();
    await this.options.stateRepository.remove(name);
  }

  createAgent(input: {
    readonly name: string;
    readonly metadata?: Readonly<Record<string, string>> | undefined;
  }): AgentView {
    this.ensureAccepting();
    const view: AgentView = {
      id: this.options.ids.next('agent'),
      name: input.name,
      status: 'active',
      createdAt: this.timestamp(),
      metadata: { ...(input.metadata ?? {}) },
    };
    this.agents.set(view.id, { view, mailbox: [] });
    this.emit('agent.created', { agentId: view.id });
    return { ...view, metadata: { ...view.metadata } };
  }

  getAgent(agentId: string): AgentView {
    return this.cloneAgent(this.getAgentEntry(agentId).view);
  }

  listAgents(): readonly AgentView[] {
    return Array.from(this.agents.values(), ({ view }) => this.cloneAgent(view));
  }

  removeAgent(agentId: string): void {
    this.getAgentEntry(agentId);
    for (const session of this.sessions.values())
      if (session.ownerAgentId === agentId) session.ownerAgentId = undefined;
    this.agents.delete(agentId);
  }

  assignSession(sessionId: string, agentId: string, currentOwnerAgentId?: string): SessionView {
    const session = this.readySession(sessionId, currentOwnerAgentId);
    this.getAgentEntry(agentId);
    if (session.ownerAgentId !== undefined && session.ownerAgentId !== currentOwnerAgentId) {
      throw new BrowserMeshError(
        'SESSION_OWNED_BY_ANOTHER_AGENT',
        'Only the current owner may hand off a session',
      );
    }
    session.ownerAgentId = agentId;
    this.emit('agent.assigned', { sessionId, agentId });
    return this.sessionView(session);
  }

  releaseSession(sessionId: string, agentId: string): SessionView {
    const session = this.readySession(sessionId, agentId);
    if (session.ownerAgentId !== agentId)
      throw new BrowserMeshError(
        'SESSION_OWNED_BY_ANOTHER_AGENT',
        'Only the owner may release a session',
      );
    session.ownerAgentId = undefined;
    return this.sessionView(session);
  }

  sendMessage(input: {
    readonly fromAgentId: string;
    readonly toAgentId: string;
    readonly type: MessageType;
    readonly payload: JsonValue;
    readonly correlationId?: string | undefined;
    readonly replyTo?: string | undefined;
  }): MessageView {
    this.getAgentEntry(input.fromAgentId);
    const recipient = this.getAgentEntry(input.toAgentId);
    const message: MessageView = {
      id: this.options.ids.next('message'),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      type: input.type,
      payload: input.payload,
      createdAt: this.timestamp(),
      correlationId: input.correlationId ?? this.options.ids.next('correlation'),
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    };
    recipient.mailbox.push(message);
    this.emit('message.sent', { agentId: input.fromAgentId });
    return { ...message };
  }

  listMessages(agentId: string, unreadOnly = false): readonly MessageView[] {
    const messages = this.getAgentEntry(agentId).mailbox;
    return messages
      .filter((message) => !unreadOnly || message.acknowledgedAt === undefined)
      .map((message) => ({ ...message }));
  }

  acknowledgeMessage(agentId: string, messageId: string): MessageView {
    const mailbox = this.getAgentEntry(agentId).mailbox;
    const index = mailbox.findIndex((message) => message.id === messageId);
    const message = mailbox[index];
    if (message === undefined)
      throw new BrowserMeshError(
        'MESSAGE_TARGET_NOT_FOUND',
        `Message '${messageId}' was not found`,
      );
    if (message.acknowledgedAt !== undefined) return { ...message };
    const acknowledged: MessageView = { ...message, acknowledgedAt: this.timestamp() };
    mailbox[index] = acknowledged;
    return { ...acknowledged };
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.accepting = false;
    this.shutdownPromise = (async () => {
      const active = Array.from(this.sessions.values()).filter(
        (entry) => entry.status !== 'closed',
      );
      await Promise.allSettled(active.map((entry) => this.closeSession(entry.id)));
      await this.options.engine.stop();
      this.started = false;
    })();
    return this.shutdownPromise;
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
      const value = await this.withSession(target.sessionId, target.agentId, async (entry) => {
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
    agentId: string | undefined,
    action: (entry: SessionEntry) => Promise<T>,
  ): Promise<T> {
    this.ensureAccepting();
    const entry = this.readySession(sessionId, agentId);
    if (!entry.accepting)
      throw new BrowserMeshError('SESSION_CLOSED', `Session '${sessionId}' is closing or closed`);
    return entry.queue.run(async () => {
      if (entry.status !== 'ready')
        throw new BrowserMeshError('SESSION_NOT_READY', `Session '${sessionId}' is not ready`);
      const result = await action(entry);
      entry.lastActivityAt = this.timestamp();
      return result;
    });
  }

  private readySession(sessionId: string, agentId?: string): SessionEntry {
    const entry = this.getSessionEntry(sessionId);
    if (entry.status === 'closed' || entry.status === 'closing')
      throw new BrowserMeshError('SESSION_CLOSED', `Session '${sessionId}' is closed`);
    if (entry.status !== 'ready')
      throw new BrowserMeshError('SESSION_NOT_READY', `Session '${sessionId}' is not ready`);
    if (entry.ownerAgentId !== undefined && entry.ownerAgentId !== agentId) {
      throw new BrowserMeshError(
        'SESSION_OWNED_BY_ANOTHER_AGENT',
        `Session '${sessionId}' is owned by another agent`,
      );
    }
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

  private getAgentEntry(agentId: string): AgentEntry {
    const agent = this.agents.get(agentId);
    if (agent === undefined)
      throw new BrowserMeshError('AGENT_NOT_FOUND', `Agent '${agentId}' was not found`);
    return agent;
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
      ...(entry.ownerAgentId === undefined ? {} : { ownerAgentId: entry.ownerAgentId }),
      ...(entry.restoredFrom === undefined ? {} : { restoredFrom: entry.restoredFrom }),
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

  private cloneAgent(agent: AgentView): AgentView {
    return { ...agent, metadata: { ...agent.metadata } };
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
      throw new BrowserMeshError('INVALID_ARGUMENT', 'Persistence is disabled');
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
    return this.sessionView(entry);
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
      readonly agentId?: string;
    },
  ): void {
    this.options.events.emit({ type, timestamp: this.timestamp(), ...identifiers });
  }
}
