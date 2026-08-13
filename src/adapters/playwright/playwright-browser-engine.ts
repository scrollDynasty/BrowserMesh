import {
  chromium,
  type Browser,
  type BrowserContext,
  type Dialog,
  type Frame,
  type FrameLocator,
  type ElementHandle,
  type Locator as PwLocator,
  type Page,
  type Request,
  type Response,
} from 'playwright';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type {
  BrowserContextHandle,
  BrowserEngineLaunchOptions,
  BrowserEngineDiagnostics,
  BrowserEngineActionWaitEvent,
  BrowserEnginePort,
  BrowserPageHandle,
  BrowserObservation,
} from '../../application/ports/browser-engine.js';
import {
  isCancellation,
  throwIfCancelled,
  type OperationControl,
} from '../../application/operation-control.js';
import { BrowserMeshError } from '../../domain/errors.js';
import type {
  ActionWaitCondition,
  BrowserAction,
  BrowserStorageState,
  ElementReferenceView,
  ElementTarget,
  Locator,
  LocatorSelector,
  SnapshotOptions,
  ScreenshotOptions,
  UrlMatcher,
  WaitCondition,
} from '../../domain/models.js';
import {
  boundString,
  redactAndBoundObservationText,
  sanitizeObservationUrl,
} from '../../domain/observability.js';
import { classifyBrowserFailure } from './error-classification.js';

interface ContextHandle extends BrowserContextHandle {
  readonly kind: 'context';
}

interface PageHandle extends BrowserPageHandle {
  readonly kind: 'page';
}

interface ElementReferenceEntry {
  readonly handle: ElementHandle<HTMLElement | SVGElement>;
  readonly expiresAt: number;
}

type ActionableElement = PwLocator | ElementHandle<HTMLElement | SVGElement>;

const ELEMENT_REF_TTL_MS = 30_000;
const INTERACTIVE_SELECTOR =
  'a[href],button,input:not([type="hidden"]),select,textarea,[role],[tabindex]:not([tabindex="-1"])';

export class PlaywrightBrowserEngine implements BrowserEnginePort {
  private browser: Browser | undefined;
  private startPromise: Promise<void> | undefined;
  private stopping = false;
  private launchState: BrowserEngineDiagnostics['launchState'] = 'not_started';
  private readonly disconnectedListeners = new Set<() => void>();
  private readonly contexts = new Map<symbol, BrowserContext>();
  private readonly pages = new Map<symbol, Page>();
  private readonly elementRefs = new Map<symbol, Map<string, ElementReferenceEntry>>();

  constructor(
    private readonly launchOptions: BrowserEngineLaunchOptions = {
      headless: false,
      timeoutMs: 10_000,
    },
    private readonly now: () => number = Date.now,
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
        const reason = classifyBrowserFailure(error);
        const remediation = 'Run: npx -y multi-agent-browser-mcp --install-browser';
        throw new BrowserMeshError(
          'BROWSER_ERROR',
          `Failed to launch Chromium: ${cause}. ${remediation}`,
          { cause: error, details: { cause, reason, remediation } },
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
    this.elementRefs.clear();
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
    readonly control: OperationControl;
    readonly storageState?: BrowserStorageState;
    readonly settings: import('../../domain/context-settings.js').BrowserContextSettings;
  }): Promise<BrowserContextHandle> {
    throwIfCancelled(options.control.signal);
    await this.start();
    const browser = this.browser;
    if (browser === undefined)
      throw new BrowserMeshError('BROWSER_ERROR', 'Browser is unavailable');
    let context: BrowserContext | undefined;
    try {
      const { permissions, ...contextSettings } = options.settings;
      context = await browser.newContext({
        ...contextSettings,
        ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
      });
      for (const grant of permissions ?? []) {
        throwIfCancelled(options.control.signal);
        await context.grantPermissions(['geolocation'], { origin: grant.origin });
      }
      throwIfCancelled(options.control.signal);
      context.setDefaultTimeout(options.control.timeoutMs);
      context.setDefaultNavigationTimeout(options.control.timeoutMs);
      const handle: ContextHandle = { id: Symbol('context'), kind: 'context' };
      this.contexts.set(handle.id, context);
      context.once('close', () => this.dropContext(handle.id));
      return handle;
    } catch (error) {
      if (context !== undefined) {
        try {
          await context.close();
        } catch (cleanupError) {
          throw new BrowserMeshError('BROWSER_ERROR', 'Context creation and cleanup both failed', {
            cause: new AggregateError([error, cleanupError]),
          });
        }
      }
      if (isCancellation(error) || error instanceof BrowserMeshError) throw error;
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
    return this.registerPage(page);
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
    this.elementRefs.delete(handle.id);
    this.pages.delete(handle.id);
  }

  onPageClosed(handle: BrowserPageHandle, listener: () => void): () => void {
    const page = this.getPage(handle);
    page.on('close', listener);
    return () => page.off('close', listener);
  }

  observePage(
    handle: BrowserPageHandle,
    options: { readonly maxInFlightRequests: number; readonly maxStringLength: number },
    listener: (event: BrowserObservation) => void,
  ): () => void {
    const page = this.getPage(handle);
    const inFlight = new Map<
      Request,
      {
        readonly requestId: string;
        readonly startedAt: number;
        readonly method: string;
        readonly url: string;
        readonly resourceType: string;
      }
    >();
    let requestSequence = 0;
    const onConsole = (message: import('playwright').ConsoleMessage): void => {
      listener({ kind: 'console', level: message.type(), text: message.text() });
    };
    const onPageError = (error: Error): void => {
      listener({ kind: 'page_error', text: error.message });
    };
    const onRequest = (request: Request): void => {
      const url = sanitizeObservationUrl(request.url(), options.maxStringLength);
      if (url === null) return;
      const tracked = {
        requestId: `request_${(++requestSequence).toString(36)}`,
        startedAt: performance.now(),
        method: boundString(request.method().toUpperCase(), 32),
        url,
        resourceType: boundString(request.resourceType(), 64),
      };
      inFlight.set(request, tracked);
      while (inFlight.size > options.maxInFlightRequests) {
        const oldest = inFlight.keys().next().value;
        if (oldest === undefined) break;
        inFlight.delete(oldest);
      }
      listener({ kind: 'request', ...tracked });
    };
    const onResponse = (response: Response): void => {
      const request = response.request();
      const tracked = inFlight.get(request);
      if (tracked === undefined) return;
      inFlight.delete(request);
      listener({
        kind: 'response',
        requestId: tracked.requestId,
        method: tracked.method,
        url: tracked.url,
        resourceType: tracked.resourceType,
        status: response.status(),
        durationMs: performance.now() - tracked.startedAt,
      });
    };
    const onRequestFailed = (request: Request): void => {
      const tracked = inFlight.get(request);
      if (tracked === undefined) return;
      inFlight.delete(request);
      listener({
        kind: 'request_failed',
        requestId: tracked.requestId,
        method: tracked.method,
        url: tracked.url,
        resourceType: tracked.resourceType,
        durationMs: performance.now() - tracked.startedAt,
        failure: redactAndBoundObservationText(
          request.failure()?.errorText ?? 'Request failed',
          options.maxStringLength,
        ),
      });
    };
    let active = true;
    const dispose = (): void => {
      if (!active) return;
      active = false;
      inFlight.clear();
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      page.off('close', dispose);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);
    page.once('close', dispose);
    return dispose;
  }

  url(handle: BrowserPageHandle): string {
    return this.getPage(handle).url();
  }

  async title(handle: BrowserPageHandle, control: OperationControl): Promise<string> {
    throwIfCancelled(control.signal);
    return this.wrapAction(
      () => this.getPage(handle).title(),
      'BROWSER_ERROR',
      'Failed to get page title',
      control.timeoutMs,
    );
  }

  async navigate(handle: BrowserPageHandle, url: string, control: OperationControl): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapAction(
      async () =>
        this.getPage(handle)
          .goto(url, { timeout: control.timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      `Navigation failed for ${url}`,
      control.timeoutMs,
      { url },
    );
  }

  async back(handle: BrowserPageHandle, control: OperationControl): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapAction(
      async () =>
        this.getPage(handle)
          .goBack({ timeout: control.timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      'Back navigation failed',
      control.timeoutMs,
    );
  }

  async forward(handle: BrowserPageHandle, control: OperationControl): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapAction(
      async () =>
        this.getPage(handle)
          .goForward({ timeout: control.timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      'Forward navigation failed',
      control.timeoutMs,
    );
  }

  async reload(handle: BrowserPageHandle, control: OperationControl): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapAction(
      async () =>
        this.getPage(handle)
          .reload({ timeout: control.timeoutMs })
          .then(() => undefined),
      'NAVIGATION_FAILED',
      'Reload failed',
      control.timeoutMs,
    );
  }

  async click(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).click({
          timeout: remainingMs(control.deadlineAt),
        }),
      'click',
      locator,
      control.timeoutMs,
    );
  }

  async doubleClick(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).dblclick({
          timeout: remainingMs(control.deadlineAt),
        }),
      'double-click',
      locator,
      control.timeoutMs,
    );
  }

  async hover(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).hover({
          timeout: remainingMs(control.deadlineAt),
        }),
      'hover over',
      locator,
      control.timeoutMs,
    );
  }

  async focus(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).focus({
          timeout: remainingMs(control.deadlineAt),
        }),
      'focus',
      locator,
      control.timeoutMs,
    );
  }

  async check(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).check({
          timeout: remainingMs(control.deadlineAt),
        }),
      'check',
      locator,
      control.timeoutMs,
    );
  }

  async uncheck(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).uncheck({
          timeout: remainingMs(control.deadlineAt),
        }),
      'uncheck',
      locator,
      control.timeoutMs,
    );
  }

  async scrollIntoView(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).scrollIntoViewIfNeeded({
          timeout: remainingMs(control.deadlineAt),
        }),
      'scroll into view',
      locator,
      control.timeoutMs,
    );
  }

  async scroll(
    handle: BrowserPageHandle,
    deltaX: number,
    deltaY: number,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapAction(
      () => this.getPage(handle).mouse.wheel(deltaX, deltaY),
      'BROWSER_ERROR',
      'Failed to scroll page',
      control.timeoutMs,
      { deltaX, deltaY },
    );
  }

  async dragAndDrop(
    handle: BrowserPageHandle,
    source: Locator,
    target: Locator,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    const page = this.getPage(handle);
    await this.wrapElement(
      async () => {
        const sourceLocator = await this.locate(page, source, control);
        const targetLocator = await this.locate(page, target, control);
        if ((await sourceLocator.count()) > 1) throw ambiguousLocator(source);
        if ((await targetLocator.count()) > 1) throw ambiguousLocator(target);
        await sourceLocator.dragTo(targetLocator, { timeout: remainingMs(control.deadlineAt) });
      },
      'drag',
      source,
      control.timeoutMs,
    );
  }

  async fill(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    value: string,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).fill(value, {
          timeout: remainingMs(control.deadlineAt),
        }),
      'fill',
      locator,
      control.timeoutMs,
    );
  }

  async press(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    key: string,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control)).press(key, {
          timeout: remainingMs(control.deadlineAt),
        }),
      'press',
      locator,
      control.timeoutMs,
    );
  }

  async selectOption(
    handle: BrowserPageHandle,
    locator: ElementTarget,
    value: string,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    await this.wrapElement(
      async () =>
        (await this.actionable(handle, locator, control))
          .selectOption(value, { timeout: remainingMs(control.deadlineAt) })
          .then(() => undefined),
      'select option',
      locator,
      control.timeoutMs,
    );
  }

  async snapshot(
    handle: BrowserPageHandle,
    options: Pick<
      SnapshotOptions,
      'scope' | 'maxDepth' | 'includeBoundingBoxes' | 'includeRefs' | 'maxRefs'
    >,
    control: OperationControl,
  ): Promise<{ readonly snapshot: string; readonly refs: readonly ElementReferenceView[] }> {
    throwIfCancelled(control.signal);
    const page = this.getPage(handle);
    const scope = options.scope ?? { strategy: 'css', value: 'body' as const };
    const capture = async (): Promise<{
      readonly snapshot: string;
      readonly refs: readonly ElementReferenceView[];
    }> => {
      const root = await this.resolveFrameRoot(page, scope, control);
      const scopedLocator = this.locateInRoot(root, scope);
      const passwordValuesBefore = await readPasswordValues(root);
      throwIfCancelled(control.signal);
      const snapshot = await scopedLocator.ariaSnapshot({
        timeout: remainingMs(control.deadlineAt),
        ...(control.signal === undefined ? {} : { signal: control.signal }),
        ...(options.maxDepth === undefined ? {} : { depth: options.maxDepth }),
        boxes: options.includeBoundingBoxes ?? false,
      });
      throwIfCancelled(control.signal);
      const passwordValuesAfter = await readPasswordValues(root);
      throwIfCancelled(control.signal);
      const redacted = redactSecretValues(snapshot, [
        ...passwordValuesBefore,
        ...passwordValuesAfter,
      ]);
      const refs =
        options.includeRefs === true
          ? await this.captureElementRefs(handle, scopedLocator, options.maxRefs ?? 50, control)
          : [];
      return { snapshot: redacted, refs };
    };
    return options.scope === undefined
      ? this.wrapAction(
          capture,
          'BROWSER_ERROR',
          'Failed to capture page snapshot',
          control.timeoutMs,
        )
      : this.wrapElement(capture, 'capture snapshot', options.scope, control.timeoutMs);
  }

  async visibleText(
    handle: BrowserPageHandle,
    locator: Locator,
    control: OperationControl,
  ): Promise<string> {
    throwIfCancelled(control.signal);
    return this.wrapElement(
      async () =>
        (await this.locate(this.getPage(handle), locator, control)).innerText({
          timeout: remainingMs(control.deadlineAt),
        }),
      'read visible text',
      locator,
      control.timeoutMs,
    );
  }

  async screenshot(
    handle: BrowserPageHandle,
    options: ScreenshotOptions,
    control: OperationControl,
  ): Promise<Uint8Array> {
    throwIfCancelled(control.signal);
    const screenshotLocator = options.locator;
    if (screenshotLocator !== undefined) {
      return this.wrapElement(
        async () =>
          (await this.locate(this.getPage(handle), screenshotLocator, control)).screenshot({
            timeout: remainingMs(control.deadlineAt),
            type: 'png',
            scale: 'css',
          }),
        'capture screenshot',
        screenshotLocator,
        control.timeoutMs,
      );
    }
    return this.wrapAction(
      () =>
        this.getPage(handle).screenshot({
          timeout: control.timeoutMs,
          type: 'png',
          fullPage: options.fullPage ?? false,
          scale: 'css',
        }),
      'BROWSER_ERROR',
      'Failed to capture page screenshot',
      control.timeoutMs,
    );
  }

  async screenshotDimensions(
    handle: BrowserPageHandle,
    options: ScreenshotOptions,
    control: OperationControl,
  ): Promise<{ readonly width: number; readonly height: number }> {
    throwIfCancelled(control.signal);
    const page = this.getPage(handle);
    const screenshotLocator = options.locator;
    if (screenshotLocator !== undefined) {
      return this.wrapElement(
        async () => {
          const box = await (
            await this.locate(page, screenshotLocator, control)
          ).boundingBox({
            timeout: remainingMs(control.deadlineAt),
          });
          if (box === null)
            throw new BrowserMeshError('ELEMENT_NOT_FOUND', 'Screenshot element has no box');
          return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
        },
        'measure screenshot element',
        screenshotLocator,
        control.timeoutMs,
      );
    }
    return this.wrapAction(
      async () => {
        if (options.fullPage === true) {
          return page.evaluate(() => {
            const root = document.documentElement;
            const body = document.body;
            return {
              width: Math.ceil(
                Math.max(root.scrollWidth, root.clientWidth, body.scrollWidth, body.clientWidth),
              ),
              height: Math.ceil(
                Math.max(
                  root.scrollHeight,
                  root.clientHeight,
                  body.scrollHeight,
                  body.clientHeight,
                ),
              ),
            };
          });
        }
        const viewport = page.viewportSize();
        if (viewport !== null) return viewport;
        return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      },
      'BROWSER_ERROR',
      'Failed to measure screenshot dimensions',
      control.timeoutMs,
    );
  }

  async wait(
    handle: BrowserPageHandle,
    condition: WaitCondition,
    control: OperationControl,
  ): Promise<void> {
    throwIfCancelled(control.signal);
    const page = this.getPage(handle);
    await this.wrapAction(
      async () => {
        switch (condition.kind) {
          case 'url':
            await pollUntil(
              () => Promise.resolve(matchesUrl(page.url(), condition.matcher)),
              control,
            );
            return;
          case 'load':
            await pollUntil(async () => {
              const readyState = await page.evaluate(() => document.readyState);
              return condition.state === 'load'
                ? readyState === 'complete'
                : readyState === 'interactive' || readyState === 'complete';
            }, control);
            return;
          case 'locator': {
            const locator = await this.locate(page, condition.locator, control);
            await pollUntil(async (remaining) => {
              const count = await locator.count();
              if (count > 1) throw ambiguousLocator(condition.locator);
              if (condition.state === 'detached') return count === 0;
              if (condition.state === 'hidden')
                return count === 0 || (await locator.isHidden({ timeout: remaining }));
              if (count === 0) return false;
              if (condition.state === 'attached') return true;
              if (condition.state === 'visible') return locator.isVisible({ timeout: remaining });
              const enabled = await locator.isEnabled({ timeout: remaining });
              return condition.state === 'enabled' ? enabled : !enabled;
            }, control);
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
            }, control);
        }
      },
      'BROWSER_ERROR',
      'Wait condition failed',
      control.timeoutMs,
      { condition },
    );
  }

  async actionAndWait(
    handle: BrowserPageHandle,
    action: BrowserAction,
    wait: ActionWaitCondition,
    control: OperationControl,
  ): Promise<BrowserEngineActionWaitEvent> {
    throwIfCancelled(control.signal);
    const page = this.getPage(handle);
    const waiter = createEventWaiter(page, wait, control, (popup) => this.registerPage(popup));
    const actionPromise = this.performCompositeAction(handle, action, control).catch(
      (error: unknown) => {
        waiter.cancel(error);
        throw error;
      },
    );
    const settled = await Promise.allSettled([actionPromise, waiter.promise]);
    waiter.dispose();
    const actionResult = settled[0];
    const waitResult = settled[1];
    if (actionResult.status === 'rejected') {
      if (waitResult.status === 'fulfilled' && waitResult.value.kind === 'popup')
        await this.closePage(waitResult.value.page);
      throw actionResult.reason;
    }
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
    handle: BrowserPageHandle,
    action: BrowserAction,
    control: OperationControl,
  ): Promise<void> {
    const target = action.target ?? action.locator;
    switch (action.kind) {
      case 'click':
        await this.wrapElement(
          async () =>
            (await this.actionable(handle, target, control)).click({
              timeout: remainingMs(control.deadlineAt),
            }),
          'click',
          target,
          control.timeoutMs,
        );
        return;
      case 'press':
        await this.wrapElement(
          async () =>
            (await this.actionable(handle, target, control)).press(action.key, {
              timeout: remainingMs(control.deadlineAt),
            }),
          'press',
          target,
          control.timeoutMs,
        );
    }
  }

  private registerPage(page: Page): BrowserPageHandle {
    const existing = Array.from(this.pages).find(([, candidate]) => candidate === page)?.[0];
    if (existing !== undefined) return { id: existing };
    const pageHandle: PageHandle = { id: Symbol('page'), kind: 'page' };
    this.pages.set(pageHandle.id, page);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.elementRefs.delete(pageHandle.id);
    });
    page.once('close', () => {
      this.elementRefs.delete(pageHandle.id);
      this.pages.delete(pageHandle.id);
    });
    return pageHandle;
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

  private locateInRoot(root: Page | FrameLocator, locator: LocatorSelector): PwLocator {
    switch (locator.strategy) {
      case 'role':
        return root.getByRole(
          locator.value,
          locator.name === undefined ? {} : { name: locator.name, exact: locator.exact ?? true },
        );
      case 'text':
        return root.getByText(locator.value, { exact: true });
      case 'label':
        return root.getByLabel(locator.value, { exact: true });
      case 'placeholder':
        return root.getByPlaceholder(locator.value, { exact: true });
      case 'testId':
        return root.getByTestId(locator.value);
      case 'css':
        return root.locator(locator.value);
    }
  }

  private async resolveFrameRoot(
    page: Page,
    locator: Locator,
    control: OperationControl,
  ): Promise<Page | FrameLocator> {
    const frame = locator.frame;
    if (frame === undefined || frame.kind === 'main') return page;
    if (frame.chain.length === 0 || frame.chain.length > 5)
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        'Iframe locator chain must contain between 1 and 5 selectors',
        { details: { frameDepth: frame.chain.length, maximumFrameDepth: 5 } },
      );
    let root: Page | FrameLocator = page;
    for (const [frameIndex, selector] of frame.chain.entries()) {
      const frameElement = this.locateInRoot(root, selector);
      await pollUntil(async () => {
        const count = await frameElement.count();
        if (count > 1) throw ambiguousFrameLocator(selector, frameIndex);
        return count === 1;
      }, control);
      root = frameElement.contentFrame();
    }
    return root;
  }

  private async locate(
    page: Page,
    locator: Locator,
    control: OperationControl,
  ): Promise<PwLocator> {
    return this.locateInRoot(await this.resolveFrameRoot(page, locator, control), locator);
  }

  private async actionable(
    pageHandle: BrowserPageHandle,
    target: ElementTarget,
    control: OperationControl,
  ): Promise<ActionableElement> {
    const page = this.getPage(pageHandle);
    if (!('ref' in target)) return this.locate(page, target, control);
    const registry = this.elementRefs.get(pageHandle.id);
    const entry = registry?.get(target.ref);
    if (entry === undefined || entry.expiresAt <= this.now()) {
      if (entry !== undefined) {
        registry?.delete(target.ref);
        await entry.handle.dispose().catch(() => undefined);
      }
      throw staleElementReference(target.ref);
    }
    let connected: boolean;
    try {
      connected = await entry.handle.evaluate((element) => element.isConnected);
    } catch {
      connected = false;
    }
    if (!connected) {
      registry?.delete(target.ref);
      await entry.handle.dispose().catch(() => undefined);
      throw staleElementReference(target.ref);
    }
    return entry.handle;
  }

  private async captureElementRefs(
    pageHandle: BrowserPageHandle,
    scope: PwLocator,
    maxRefs: number,
    control: OperationControl,
  ): Promise<readonly ElementReferenceView[]> {
    const candidate = scope.locator(INTERACTIVE_SELECTOR);
    const handles: ElementReferenceEntry[] = [];
    const views: ElementReferenceView[] = [];
    try {
      const count = Math.min(await candidate.count(), maxRefs);
      for (let index = 0; index < count; index += 1) {
        throwIfCancelled(control.signal);
        const handle = await candidate.nth(index).elementHandle();
        const hint = await handle.evaluate((element) => {
          const tag = element.tagName.toLowerCase().slice(0, 32);
          const role = element.getAttribute('role')?.trim().slice(0, 64) || undefined;
          const explicit =
            element.getAttribute('aria-label') ??
            element.getAttribute('alt') ??
            element.getAttribute('title');
          const text = /^(input|select|textarea)$/u.test(tag) ? undefined : element.textContent;
          const name = (explicit ?? text)?.replace(/\s+/gu, ' ').trim().slice(0, 120) || undefined;
          return { tag, role, name };
        });
        const ref = `@e${randomUUID().replaceAll('-', '')}`;
        handles.push({ handle, expiresAt: this.now() + ELEMENT_REF_TTL_MS });
        views.push({
          ref,
          tag: hint.tag,
          ...(hint.role === undefined ? {} : { role: hint.role }),
          ...(hint.name === undefined ? {} : { name: hint.name }),
        });
      }
      throwIfCancelled(control.signal);
    } catch (error) {
      await Promise.allSettled(handles.map((entry) => entry.handle.dispose()));
      throw error;
    }
    const prior = this.elementRefs.get(pageHandle.id);
    const next = new Map<string, ElementReferenceEntry>();
    views.forEach((view, index) => {
      const entry = handles.at(index);
      if (entry !== undefined) next.set(view.ref, entry);
    });
    this.elementRefs.set(pageHandle.id, next);
    if (prior !== undefined)
      await Promise.allSettled(Array.from(prior.values(), (entry) => entry.handle.dispose()));
    return views;
  }

  private dropContext(contextId: symbol): void {
    const context = this.contexts.get(contextId);
    if (context !== undefined) {
      for (const [id, page] of this.pages) {
        if (page.context() !== context) continue;
        this.elementRefs.delete(id);
        this.pages.delete(id);
      }
    }
    this.contexts.delete(contextId);
  }

  private handleDisconnected(browser: Browser): void {
    if (this.browser !== browser) return;
    this.browser = undefined;
    this.launchState = 'failed';
    this.pages.clear();
    this.elementRefs.clear();
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
      const reason = classifyBrowserFailure(error);
      const timedOut = reason === 'timeout';
      if (isCancellation(error)) throw error;
      const cause = errorMessage(error);
      throw new BrowserMeshError(
        timedOut ? 'OPERATION_TIMEOUT' : code,
        `${timedOut ? `Operation exceeded ${String(timeoutMs)}ms` : message}: ${cause}`,
        { cause: error, details: { ...details, timeoutMs, reason, cause } },
      );
    }
  }

  private async wrapElement<T>(
    action: () => Promise<T>,
    operation: string,
    locator: ElementTarget,
    timeoutMs: number,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BrowserMeshError) throw error;
      if (isCancellation(error)) throw error;
      const classified = classifyBrowserFailure(error, 'element_not_found');
      const timedOut = classified === 'timeout';
      const ambiguous = classified === 'locator_ambiguous';
      const reason = timedOut ? 'timeout' : ambiguous ? 'locator_ambiguous' : 'element_not_found';
      const cause = errorMessage(error);
      const locatorDescription = describeLocator(locator);
      throw new BrowserMeshError(
        timedOut ? 'OPERATION_TIMEOUT' : ambiguous ? 'LOCATOR_AMBIGUOUS' : 'ELEMENT_NOT_FOUND',
        `${timedOut ? `Element operation exceeded ${String(timeoutMs)}ms` : ambiguous ? 'Locator matched multiple elements' : `Unable to ${operation}`} for ${locatorDescription}: ${cause}`,
        {
          cause: error,
          details: { operation, locator, timeoutMs, reason, cause },
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
  control: OperationControl,
): Promise<void> {
  let satisfied = false;
  while (!satisfied) {
    throwIfCancelled(control.signal);
    const remaining = Math.max(1, control.deadlineAt - Date.now());
    satisfied = await check(remaining);
    throwIfCancelled(control.signal);
    if (satisfied) continue;
    const remainingAfterCheck = control.deadlineAt - Date.now();
    if (remainingAfterCheck <= 0) throw operationTimeout(control.timeoutMs);
    await cancellableDelay(Math.min(25, remainingAfterCheck), control.signal);
  }
}

function cancellableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        throwIfCancelled(signal);
      } catch (error) {
        reject(error instanceof Error ? error : new DOMException(String(error), 'AbortError'));
      }
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function operationTimeout(timeoutMs: number): BrowserMeshError {
  return new BrowserMeshError('OPERATION_TIMEOUT', `Operation exceeded ${String(timeoutMs)}ms`, {
    details: { timeoutMs, reason: 'timeout' },
  });
}

function ambiguousLocator(locator: Locator): BrowserMeshError {
  return new BrowserMeshError('LOCATOR_AMBIGUOUS', 'Locator matched multiple elements', {
    details: { locator, reason: 'locator_ambiguous' },
  });
}

function ambiguousFrameLocator(locator: LocatorSelector, frameIndex: number): BrowserMeshError {
  return new BrowserMeshError(
    'LOCATOR_AMBIGUOUS',
    `Iframe selector at chain step ${String(frameIndex)} matched multiple elements`,
    { details: { locator, frameIndex, reason: 'locator_ambiguous' } },
  );
}

interface EventWaiter {
  readonly promise: Promise<BrowserEngineActionWaitEvent>;
  cancel(error: unknown): void;
  dispose(): void;
}

function createEventWaiter(
  page: Page,
  wait: ActionWaitCondition,
  control: OperationControl,
  registerPopup: (popup: Page) => BrowserPageHandle,
): EventWaiter {
  let settled = false;
  let resolvePromise!: (value: BrowserEngineActionWaitEvent) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<BrowserEngineActionWaitEvent>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const finish = (event: BrowserEngineActionWaitEvent): void => {
    if (settled) return;
    settled = true;
    resolvePromise(event);
  };
  const fail = (error: unknown): void => {
    if (settled) return;
    settled = true;
    rejectPromise(error instanceof Error ? error : new Error(String(error)));
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
        await page.waitForLoadState(wait.loadState, { timeout: remainingMs(control.deadlineAt) });
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
  const onPopup = (popup: Page): void => {
    if (wait.kind !== 'popup') return;
    finish({ kind: 'popup', page: registerPopup(popup) });
  };
  const onDialog = (dialog: Dialog): void => {
    if (wait.kind !== 'dialog') return;
    void (async () => {
      if (dialog.type() !== wait.dialogType) {
        await dialog.dismiss();
        fail(
          new BrowserMeshError(
            'BROWSER_ERROR',
            `Expected ${wait.dialogType} dialog but received ${dialog.type()}`,
            { details: { expectedDialogType: wait.dialogType, actualDialogType: dialog.type() } },
          ),
        );
        return;
      }
      const event: BrowserEngineActionWaitEvent = {
        kind: 'dialog',
        dialogType: wait.dialogType,
        action: wait.action,
        message: boundString(dialog.message(), 2_000),
        defaultValue: boundString(dialog.defaultValue(), 2_000),
      };
      if (wait.action === 'accept') await dialog.accept(wait.promptText);
      else await dialog.dismiss();
      finish(event);
    })().catch(async (error: unknown) => {
      try {
        await dialog.dismiss();
      } catch (cleanupError) {
        fail(
          new BrowserMeshError('BROWSER_ERROR', 'Dialog handling and cleanup both failed', {
            cause: new AggregateError([error, cleanupError]),
          }),
        );
        return;
      }
      fail(
        error instanceof BrowserMeshError
          ? error
          : new BrowserMeshError('BROWSER_ERROR', 'Failed to handle browser dialog', {
              cause: error,
            }),
      );
    });
  };
  page.on('framenavigated', onNavigation);
  page.on('response', onResponse);
  page.on('popup', onPopup);
  page.on('dialog', onDialog);
  const onAbort = (): void => {
    try {
      throwIfCancelled(control.signal);
    } catch (error) {
      fail(error);
    }
  };
  control.signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutMs = remainingMs(control.deadlineAt);
  const timer = setTimeout(() => fail(operationTimeout(control.timeoutMs)), timeoutMs);
  const dispose = (): void => {
    clearTimeout(timer);
    control.signal?.removeEventListener('abort', onAbort);
    page.off('framenavigated', onNavigation);
    page.off('response', onResponse);
    page.off('popup', onPopup);
    page.off('dialog', onDialog);
  };
  if (control.signal?.aborted === true) onAbort();
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

function describeLocator(locator: ElementTarget): string {
  if ('ref' in locator) return `ref=${locator.ref}`;
  const name =
    locator.strategy === 'role' && locator.name !== undefined ? `, name=${locator.name}` : '';
  const exact =
    locator.strategy === 'role' && locator.name !== undefined
      ? `, exact=${String(locator.exact ?? true)}`
      : '';
  const frame =
    locator.frame?.kind === 'iframe'
      ? `, frameDepth=${String(locator.frame.chain.length)}`
      : locator.frame?.kind === 'main'
        ? ', frame=main'
        : '';
  return `${locator.strategy}=${locator.value}${name}${exact}${frame}`;
}

function staleElementReference(ref: string): BrowserMeshError {
  return new BrowserMeshError(
    'STALE_ELEMENT_REFERENCE',
    'Element reference is stale; capture a new snapshot and retry',
    { details: { ref } },
  );
}

function redactSecretValues(snapshot: string, secrets: readonly string[]): string {
  return [...new Set(secrets.filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'), snapshot);
}

async function readPasswordValues(root: Page | FrameLocator): Promise<readonly string[]> {
  const passwordInputs = await root.locator('input[type="password"]').all();
  return Promise.all(passwordInputs.map((passwordInput) => passwordInput.inputValue()));
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 2_000) || 'Unknown Playwright error';
}
