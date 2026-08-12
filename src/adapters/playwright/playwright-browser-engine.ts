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
  private readonly contexts = new Map<symbol, BrowserContext>();
  private readonly pages = new Map<symbol, Page>();

  constructor(private readonly headless: boolean) {}

  async start(): Promise<void> {
    if (this.browser?.isConnected() === true) return;
    try {
      this.browser = await chromium.launch({ headless: this.headless });
    } catch (error) {
      throw new BrowserMeshError('BROWSER_ERROR', 'Failed to launch Chromium', { cause: error });
    }
  }

  async stop(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.pages.clear();
    this.contexts.clear();
    if (browser !== undefined) await browser.close();
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
    await context.close();
    this.dropContext(handle.id);
  }

  async createPage(handle: BrowserContextHandle): Promise<BrowserPageHandle> {
    const context = this.getContext(handle);
    const page = await context.newPage();
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
    await page.close();
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
    await this.locate(this.getPage(handle), locator).click({ timeout: timeoutMs });
  }

  async fill(
    handle: BrowserPageHandle,
    locator: Locator,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locate(this.getPage(handle), locator).fill(value, { timeout: timeoutMs });
  }

  async press(
    handle: BrowserPageHandle,
    locator: Locator,
    key: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locate(this.getPage(handle), locator).press(key, { timeout: timeoutMs });
  }

  async selectOption(
    handle: BrowserPageHandle,
    locator: Locator,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locate(this.getPage(handle), locator).selectOption(value, { timeout: timeoutMs });
  }

  async snapshot(handle: BrowserPageHandle, timeoutMs: number): Promise<string> {
    return this.locate(this.getPage(handle), { strategy: 'css', value: 'body' }).ariaSnapshot({
      timeout: timeoutMs,
    });
  }

  async visibleText(
    handle: BrowserPageHandle,
    locator: Locator,
    timeoutMs: number,
  ): Promise<string> {
    return this.locate(this.getPage(handle), locator).innerText({ timeout: timeoutMs });
  }

  async screenshot(handle: BrowserPageHandle, timeoutMs: number): Promise<Uint8Array> {
    return this.getPage(handle).screenshot({ timeout: timeoutMs, type: 'png' });
  }

  async storageState(handle: BrowserContextHandle): Promise<BrowserStorageState> {
    return this.getContext(handle).storageState();
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

  private async wrapAction<T>(
    action: () => Promise<T>,
    code: 'BROWSER_ERROR' | 'NAVIGATION_FAILED',
    message: string,
    timeoutMs: number,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BrowserMeshError) throw error;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new BrowserMeshError(
        timedOut ? 'OPERATION_TIMEOUT' : code,
        timedOut ? `Operation exceeded ${String(timeoutMs)}ms` : message,
        { cause: error },
      );
    }
  }
}
