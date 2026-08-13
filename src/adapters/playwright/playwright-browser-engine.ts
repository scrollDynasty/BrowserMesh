import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Locator as PwLocator,
  type Page,
  type Response,
} from 'playwright';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type {
  BrowserContextHandle,
  BrowserEngineLaunchOptions,
  BrowserEngineDiagnostics,
  BrowserEnginePort,
  BrowserPageHandle,
  BrowserObservation,
} from '../../application/ports/browser-engine.js';
import { BrowserMeshError } from '../../domain/errors.js';
import type {
  ActionAndWaitResult,
  ActionWaitCondition,
  BrowserAction,
  BrowserStorageState,
  Locator,
  UrlMatcher,
  WaitCondition,
} from '../../domain/models.js';

interface ContextHandle extends BrowserContextHandle {
  readonly kind: 'context';
}

interface PageHandle extends BrowserPageHandle {
  readonly kind: 'page';
}

export class PlaywrightBrowserEngine implements BrowserEnginePort {
  private browser: Browser | undefined;
  private startPromise: Promise<void> | undefined;
  private stopping = false;
  private launchState: BrowserEngineDiagnostics['launchState'] = 'not_started';
  private readonly disconnectedListeners = new Set<() => void>();
  private readonly contexts = new Map<symbol, BrowserContext>();
  private readonly pages = new Map<symbol, Page>();

  constructor(
    private readonly launchOptions: BrowserEngineLaunchOptions = {
      headless: false,
      timeoutMs: 10_000,
    },
  ) {}

  diagnostics(): BrowserEngineDiagnostics {
    const browser = this.browser;
    return {
      launchState: this.launchState,
      browserVersion:
        this.launchState === 'ready' && browser?.isConnected() === true ? browser.version() : null,
    };
  }

  async isExecutableAvailable(): Promise<boolean> {
    try {
      await access(chromium.executablePath(), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  onDisconnected(listener: () => void): () => void {
    this.disconnectedListeners.add(listener);
    return () => this.disconnectedListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.browser?.isConnected() === true) return;
    if (this.startPromise !== undefined) return this.startPromise;
    this.startPromise = (async () => {
      try {
        const browser = await chromium.launch({
          headless: this.launchOptions.headless,
          timeout: this.launchOptions.timeoutMs,
        });
        browser.once('disconnected', () => this.handleDisconnected(browser));
        this.browser = browser;
        this.launchState = 'ready';
      } catch (error) {
        this.launchState = 'failed';
        const cause = errorMessage(error);
        const remediation = 'Run: npx -y multi-agent-browser-mcp --install-browser';
        throw new BrowserMeshError(
          'BROWSER_ERROR',
          `Failed to launch Chromium: ${cause}. ${remediation}`,
          { cause: error, details: { cause, remediation } },
        );
      } finally {
        this.startPromise = undefined;
      }
    })();
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const browser = this.browser;
    this.browser = undefined;
    this.pages.clear();
    this.contexts.clear();
    try {
      if (browser !== undefined) {
        await this.wrapBrowserAction(() => browser.close(), 'Failed to stop Chromium');
      }
    } finally {
      this.stopping = false;
      this.launchState = 'not_started';
    }
  }

  async createContext(options: {
    readonly timeoutMs: number;
    readonly storageState?: BrowserStorageState;
  }): Promise<BrowserContextHandle> {
    await this.start();
    const browser = this.browser;
    if (browser === undefined)
      throw new BrowserMeshError('BROWSER_ERROR', 'Browser is unavailable');
    try {
      const context = await browser.newContext(
        options.storageState === undefined ? {} : { storageState: options.storageState },
      );
      context.setDefaultTimeout(options.timeoutMs);
      context.setDefaultNavigationTimeout(options.timeoutMs);
      const handle: ContextHandle = { id: Symbol('context'), kind: 'context' };
      this.contexts.set(handle.id, context);
      context.once('close', () => this.dropContext(handle.id));
      return handle;
    } catch (error) {
      throw new BrowserMeshError('BROWSER_ERROR', 'Failed to create browser context', {
        cause: error,
      });
    }
  }

  async closeContext(handle: BrowserContextHandle): Promise<void> {
    const context = this.contexts.get(handle.id);
    if (context === undefined) return;
    await this.wrapBrowserAction(() => context.close(), 'Failed to close browser context');
    this.dropContext(handle.id);
  }

  async createPage(handle: BrowserContextHandle): Promise<BrowserPageHandle> {
    const context = this.getContext(handle);
    const page = await this.wrapBrowserAction(
      () => context.newPage(),
      'Failed to create browser page',
    );
    const pageHandle: PageHandle = { id: Symbol('page'), kind: 'page' };
    this.pages.set(pageHandle.id, page);
    page.once('close', () => this.pages.delete(pageHandle.id));
    return pageHandle;
  }

  listPages(handle: BrowserContextHandle): readonly BrowserPageHandle[] {
    const context = this.getContext(handle);
    const reverse = new Map(Array.from(this.pages, ([id, page]) => [page, id]));
    return context.pages().flatMap((page) => {
      const id = reverse.get(page);
      return id === undefined ? [] : [{ id }];
    });
  }

  async closePage(handle: BrowserPageHandle): Promise<void> {
    const page = this.pages.get(handle.id);
    if (page === undefined) return;
    await this.wrapBrowserAction(() => page.close(), 'Failed to close browser page');
    this.pages.delete(handle.id);
  }

  observePage(
    handle: BrowserPageHandle,
    listener: (event: BrowserObservation) => void,
  ): () => void {
    const page = this.getPage(handle);
    const onConsole = (message: import('playwright').ConsoleMessage): void => {
      listener({ kind: 'console', level: message.type(), text: message.text() });
    };
    const onPageError = (error: Error): void => {
      listener({ kind: 'page_error', text: error.message });
    };
    let active = true;
    const dispose = (): void => {
      if (!active) return;
      active = false;
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('close', dispose);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.once('close', dispose);
    return dispose;
  }

  url(handle: BrowserPageHandle): string {
    return this.getPage(handle).url();
  }

  async title(handle: BrowserPageHandle, timeoutMs: number): Promise<string> {
    return this.wrapAction(
      () => this.getPage(handle).title(),
      'BROWSER_ERROR',
      'Failed to get page title',
      timeoutMs,
    );
  }

  async navigate(handle: BrowserPageHandle, url: string, timeoutMs: number): Promise<void> {
    await this.wrapAction(
      () =>
        this.getPage(handle)
          .goto(url, { timeout: timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      `Navigation failed for ${url}`,
      timeoutMs,
      { url },
    );
  }

  async back(handle: BrowserPageHandle, timeoutMs: number): Promise<void> {
    await this.wrapAction(
      () =>
        this.getPage(handle)
          .goBack({ timeout: timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      'Back navigation failed',
      timeoutMs,
    );
  }

  async forward(handle: BrowserPageHandle, timeoutMs: number): Promise<void> {
    await this.wrapAction(
      () =>
        this.getPage(handle)
          .goForward({ timeout: timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      'Forward navigation failed',
      timeoutMs,
    );
  }

  async reload(handle: BrowserPageHandle, timeoutMs: number): Promise<void> {
    await this.wrapAction(
      () =>
        this.getPage(handle)
          .reload({ timeout: timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      'Reload failed',
      timeoutMs,
    );
  }

  async click(handle: BrowserPageHandle, locator: Locator, timeoutMs: number): Promise<void> {
    await this.wrapElement(
      () => this.locate(this.getPage(handle), locator).click({ timeout: timeoutMs }),
      'click',
      locator,
      timeoutMs,
    );
  }

  async fill(
    handle: BrowserPageHandle,
    locator: Locator,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.wrapElement(
      () => this.locate(this.getPage(handle), locator).fill(value, { timeout: timeoutMs }),
      'fill',
      locator,
      timeoutMs,
    );
  }

  async press(
    handle: BrowserPageHandle,
    locator: Locator,
    key: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.wrapElement(
      () => this.locate(this.getPage(handle), locator).press(key, { timeout: timeoutMs }),
      'press',
      locator,
      timeoutMs,
    );
  }

  async selectOption(
    handle: BrowserPageHandle,
    locator: Locator,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.wrapElement(
      () =>
        this.locate(this.getPage(handle), locator)
          .selectOption(value, { timeout: timeoutMs })
          .then(() => undefined),
      'select option',
      locator,
      timeoutMs,
    );
  }

  async snapshot(handle: BrowserPageHandle, timeoutMs: number): Promise<string> {
    return this.wrapAction(
      async () => {
        const page = this.getPage(handle);
        const passwordValuesBefore = await readPasswordValues(page);
        const snapshot = await this.locate(page, {
          strategy: 'css',
          value: 'body',
        }).ariaSnapshot({
          timeout: timeoutMs,
        });
        const passwordValuesAfter = await readPasswordValues(page);
        return redactSecretValues(snapshot, [...passwordValuesBefore, ...passwordValuesAfter]);
      },
      'BROWSER_ERROR',
      'Failed to capture page snapshot',
      timeoutMs,
    );
  }

  async visibleText(
    handle: BrowserPageHandle,
    locator: Locator,
    timeoutMs: number,
  ): Promise<string> {
    return this.wrapElement(
      () => this.locate(this.getPage(handle), locator).innerText({ timeout: timeoutMs }),
      'read visible text',
      locator,
      timeoutMs,
    );
  }

  async screenshot(handle: BrowserPageHandle, timeoutMs: number): Promise<Uint8Array> {
    return this.wrapAction(
      () => this.getPage(handle).screenshot({ timeout: timeoutMs, type: 'png' }),
      'BROWSER_ERROR',
      'Failed to capture page screenshot',
      timeoutMs,
    );
  }

  async wait(
    handle: BrowserPageHandle,
    condition: WaitCondition,
    timeoutMs: number,
  ): Promise<void> {
    const page = this.getPage(handle);
    await this.wrapAction(
      async () => {
        switch (condition.kind) {
          case 'url':
            await page.waitForURL((url) => matchesUrl(url.href, condition.matcher), {
              timeout: timeoutMs,
            });
            return;
          case 'load':
            await page.waitForLoadState(condition.state, { timeout: timeoutMs });
            return;
          case 'locator': {
            const locator = this.locate(page, condition.locator);
            if (
              condition.state === 'visible' ||
              condition.state === 'hidden' ||
              condition.state === 'attached' ||
              condition.state === 'detached'
            ) {
              await locator.waitFor({ state: condition.state, timeout: timeoutMs });
              return;
            }
            await pollUntil(async (remaining) => {
              const count = await locator.count();
              if (count > 1) throw ambiguousLocator(condition.locator);
              if (count === 0) return false;
              const enabled = await locator.isEnabled({ timeout: remaining });
              return condition.state === 'enabled' ? enabled : !enabled;
            }, timeoutMs);
            return;
          }
          case 'text':
            await pollUntil(async (remaining) => {
              const body = page.locator('body');
              if ((await body.count()) === 0) return condition.state === 'absent';
              const bodyText = await body.evaluate(
                (element, maximum) => (element as HTMLElement).innerText.slice(0, maximum),
                MAX_OBSERVED_TEXT,
                { timeout: remaining },
              );
              const present = bodyText.includes(condition.text);
              return condition.state === 'present' ? present : !present;
            }, timeoutMs);
        }
      },
      'BROWSER_ERROR',
      'Wait condition failed',
      timeoutMs,
      { condition },
    );
  }

  async actionAndWait(
    handle: BrowserPageHandle,
    action: BrowserAction,
    wait: ActionWaitCondition,
    timeoutMs: number,
  ): Promise<ActionAndWaitResult['event']> {
    const page = this.getPage(handle);
    const deadline = Date.now() + timeoutMs;
    const waiter = createEventWaiter(page, wait, deadline);
    const actionPromise = this.performCompositeAction(page, action, remainingMs(deadline)).catch(
      (error: unknown) => {
        waiter.cancel(error);
        throw error;
      },
    );
    const settled = await Promise.allSettled([actionPromise, waiter.promise]);
    waiter.dispose();
    const actionResult = settled[0];
    const waitResult = settled[1];
    if (actionResult.status === 'rejected') throw actionResult.reason;
    if (waitResult.status === 'rejected') throw waitResult.reason;
    return waitResult.value;
  }

  async storageState(handle: BrowserContextHandle): Promise<BrowserStorageState> {
    return this.wrapBrowserAction(
      () => this.getContext(handle).storageState(),
      'Failed to capture browser storage state',
    );
  }

  private async performCompositeAction(
    page: Page,
    action: BrowserAction,
    timeoutMs: number,
  ): Promise<void> {
    switch (action.kind) {
      case 'click':
        await this.wrapElement(
          () => this.locate(page, action.locator).click({ timeout: timeoutMs }),
          'click',
          action.locator,
          timeoutMs,
        );
        return;
      case 'press':
        await this.wrapElement(
          () => this.locate(page, action.locator).press(action.key, { timeout: timeoutMs }),
          'press',
          action.locator,
          timeoutMs,
        );
    }
  }

  private getContext(handle: BrowserContextHandle): BrowserContext {
    const context = this.contexts.get(handle.id);
    if (context === undefined)
      throw new BrowserMeshError('BROWSER_ERROR', 'Browser context is closed');
    return context;
  }

  private getPage(handle: BrowserPageHandle): Page {
    const page = this.pages.get(handle.id);
    if (page === undefined || page.isClosed())
      throw new BrowserMeshError('PAGE_NOT_FOUND', 'Browser page is closed');
    return page;
  }

  private locate(page: Page, locator: Locator): PwLocator {
    switch (locator.strategy) {
      case 'role':
        return page.getByRole(
          locator.value,
          locator.name === undefined ? {} : { name: locator.name, exact: locator.exact ?? true },
        );
      case 'text':
        return page.getByText(locator.value, { exact: true });
      case 'label':
        return page.getByLabel(locator.value, { exact: true });
      case 'placeholder':
        return page.getByPlaceholder(locator.value, { exact: true });
      case 'testId':
        return page.getByTestId(locator.value);
      case 'css':
        return page.locator(locator.value);
    }
  }

  private dropContext(contextId: symbol): void {
    const context = this.contexts.get(contextId);
    if (context !== undefined) {
      for (const [id, page] of this.pages) if (page.context() === context) this.pages.delete(id);
    }
    this.contexts.delete(contextId);
  }

  private handleDisconnected(browser: Browser): void {
    if (this.browser !== browser) return;
    this.browser = undefined;
    this.launchState = 'failed';
    this.pages.clear();
    this.contexts.clear();
    if (this.stopping) return;
    for (const listener of this.disconnectedListeners) listener();
  }

  private async wrapAction<T>(
    action: () => Promise<T>,
    code: 'BROWSER_ERROR' | 'NAVIGATION_FAILED',
    message: string,
    timeoutMs: number,
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BrowserMeshError) throw error;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const cause = errorMessage(error);
      throw new BrowserMeshError(
        timedOut ? 'OPERATION_TIMEOUT' : code,
        `${timedOut ? `Operation exceeded ${String(timeoutMs)}ms` : message}: ${cause}`,
        { cause: error, details: { ...details, timeoutMs, cause } },
      );
    }
  }

  private async wrapElement<T>(
    action: () => Promise<T>,
    operation: string,
    locator: Locator,
    timeoutMs: number,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BrowserMeshError) throw error;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const ambiguous = isStrictModeViolation(error);
      const cause = errorMessage(error);
      const locatorDescription = describeLocator(locator);
      throw new BrowserMeshError(
        timedOut ? 'OPERATION_TIMEOUT' : ambiguous ? 'LOCATOR_AMBIGUOUS' : 'ELEMENT_NOT_FOUND',
        `${timedOut ? `Element operation exceeded ${String(timeoutMs)}ms` : ambiguous ? 'Locator matched multiple elements' : `Unable to ${operation}`} for ${locatorDescription}: ${cause}`,
        {
          cause: error,
          details: { operation, locator, timeoutMs, cause },
        },
      );
    }
  }

  private async wrapBrowserAction<T>(action: () => Promise<T>, message: string): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BrowserMeshError) throw error;
      throw new BrowserMeshError('BROWSER_ERROR', message, { cause: error });
    }
  }
}

const MAX_OBSERVED_TEXT = 1_000_000;

function matchesUrl(url: string, matcher: UrlMatcher): boolean {
  if (matcher.kind === 'exact') return url === matcher.value;
  const expression = matcher.value
    .split('**')
    .map((part) => part.split('*').map(escapeRegex).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${expression}$`, 'u').test(url);
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function remainingMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function pollUntil(
  check: (remainingMs: number) => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let satisfied = false;
  while (!satisfied) {
    const remaining = Math.max(1, deadline - Date.now());
    satisfied = await check(remaining);
    if (satisfied) continue;
    const remainingAfterCheck = deadline - Date.now();
    if (remainingAfterCheck <= 0) throw operationTimeout(timeoutMs);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, remainingAfterCheck)));
  }
}

function operationTimeout(timeoutMs: number): BrowserMeshError {
  return new BrowserMeshError('OPERATION_TIMEOUT', `Operation exceeded ${String(timeoutMs)}ms`, {
    details: { timeoutMs },
  });
}

function ambiguousLocator(locator: Locator): BrowserMeshError {
  return new BrowserMeshError('LOCATOR_AMBIGUOUS', 'Locator matched multiple elements', {
    details: { locator },
  });
}

interface EventWaiter {
  readonly promise: Promise<ActionAndWaitResult['event']>;
  cancel(error: unknown): void;
  dispose(): void;
}

function createEventWaiter(page: Page, wait: ActionWaitCondition, deadline: number): EventWaiter {
  let settled = false;
  let resolvePromise!: (value: ActionAndWaitResult['event']) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<ActionAndWaitResult['event']>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const finish = (event: ActionAndWaitResult['event']): void => {
    if (settled) return;
    settled = true;
    resolvePromise(event);
  };
  const fail = (error: unknown): void => {
    if (settled) return;
    settled = true;
    rejectPromise(error);
  };
  const onNavigation = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (
      wait.kind !== 'navigation' ||
      (wait.matcher !== undefined && !matchesUrl(url, wait.matcher))
    )
      return;
    void (async () => {
      if (wait.loadState !== undefined)
        await page.waitForLoadState(wait.loadState, { timeout: remainingMs(deadline) });
      finish({ kind: 'navigation', url: safeObservedUrl(url) });
    })().catch(fail);
  };
  const onResponse = (response: Response): void => {
    if (wait.kind !== 'response') return;
    const request = response.request();
    if (!matchesUrl(response.url(), wait.matcher)) return;
    if (wait.method !== undefined && request.method() !== wait.method) return;
    if (wait.status !== undefined && response.status() !== wait.status) return;
    finish({
      kind: 'response',
      url: safeObservedUrl(response.url()),
      method: request.method(),
      status: response.status(),
    });
  };
  page.on('framenavigated', onNavigation);
  page.on('response', onResponse);
  const timeoutMs = remainingMs(deadline);
  const timer = setTimeout(() => fail(operationTimeout(timeoutMs)), timeoutMs);
  const dispose = (): void => {
    clearTimeout(timer);
    page.off('framenavigated', onNavigation);
    page.off('response', onResponse);
  };
  void promise.finally(dispose).catch(() => undefined);
  return { promise, cancel: fail, dispose };
}

function safeObservedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|auth|key|code/i.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.href.slice(0, 2_000);
  } catch {
    return value.slice(0, 2_000);
  }
}

function describeLocator(locator: Locator): string {
  const name =
    locator.strategy === 'role' && locator.name !== undefined ? `, name=${locator.name}` : '';
  const exact =
    locator.strategy === 'role' && locator.name !== undefined
      ? `, exact=${String(locator.exact ?? true)}`
      : '';
  return `${locator.strategy}=${locator.value}${name}${exact}`;
}

function redactSecretValues(snapshot: string, secrets: readonly string[]): string {
  return [...new Set(secrets.filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'), snapshot);
}

async function readPasswordValues(page: Page): Promise<readonly string[]> {
  const passwordInputs = await page.locator('input[type="password"]').all();
  return Promise.all(passwordInputs.map((passwordInput) => passwordInput.inputValue()));
}

function isStrictModeViolation(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('strict mode violation');
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 2_000) || 'Unknown Playwright error';
}
