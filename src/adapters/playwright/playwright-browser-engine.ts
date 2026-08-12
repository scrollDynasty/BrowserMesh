import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator as PwLocator,
  type Page,
} from 'playwright';
import type {
  BrowserContextHandle,
  BrowserEnginePort,
  BrowserPageHandle,
} from '../../application/ports/browser-engine.js';
import { BrowserMeshError } from '../../domain/errors.js';
import type { BrowserStorageState, Locator } from '../../domain/models.js';

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
  private readonly disconnectedListeners = new Set<() => void>();
  private readonly contexts = new Map<symbol, BrowserContext>();
  private readonly pages = new Map<symbol, Page>();

  constructor(private readonly headless = false) {}

  onDisconnected(listener: () => void): () => void {
    this.disconnectedListeners.add(listener);
    return () => this.disconnectedListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.browser?.isConnected() === true) return;
    if (this.startPromise !== undefined) return this.startPromise;
    this.startPromise = (async () => {
      try {
        const browser = await chromium.launch({ headless: this.headless });
        browser.once('disconnected', () => this.handleDisconnected(browser));
        this.browser = browser;
      } catch (error) {
        throw new BrowserMeshError('BROWSER_ERROR', 'Failed to launch Chromium', {
          cause: error,
        });
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
      () =>
        this.locate(this.getPage(handle), { strategy: 'css', value: 'body' }).ariaSnapshot({
          timeout: timeoutMs,
        }),
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

  async storageState(handle: BrowserContextHandle): Promise<BrowserStorageState> {
    return this.wrapBrowserAction(
      () => this.getContext(handle).storageState(),
      'Failed to capture browser storage state',
    );
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
          locator.name === undefined ? {} : { name: locator.name },
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
      const cause = errorMessage(error);
      const locatorDescription = describeLocator(locator);
      throw new BrowserMeshError(
        timedOut ? 'OPERATION_TIMEOUT' : 'ELEMENT_NOT_FOUND',
        `${timedOut ? `Element operation exceeded ${String(timeoutMs)}ms` : `Unable to ${operation}`} for ${locatorDescription}: ${cause}`,
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

function describeLocator(locator: Locator): string {
  const name =
    locator.strategy === 'role' && locator.name !== undefined ? `, name=${locator.name}` : '';
  return `${locator.strategy}=${locator.value}${name}`;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 2_000) || 'Unknown Playwright error';
}
