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
  ScreenshotCapturePlan,
} from '../../application/ports/browser-engine.js';
import {
  isCancellation,
  remainingOperationTime,
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
import { SNAPSHOT_LIMITS } from '../../domain/snapshots.js';

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
  private stopPromise: Promise<void> | undefined;
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
    if (this.stopPromise !== undefined) {
      await this.stopPromise;
    }
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
        const remediation = 'Run: npx -y browsermesh --install-browser';
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
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      try {
        // A launch already accepted before shutdown owns this lifecycle and must be reaped.
        await this.startPromise?.catch(() => undefined);
        const browser = this.browser;
        this.browser = undefined;
        this.pages.clear();
        this.elementRefs.clear();
        this.contexts.clear();
        if (browser !== undefined) {
          await this.wrapBrowserAction(() => browser.close(), 'Failed to stop Chromium');
        }
      } finally {
        this.stopping = false;
        this.launchState = 'not_started';
        this.stopPromise = undefined;
      }
    })();
    return this.stopPromise;
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
    const onRequestFinished = (request: Request): void => {
      inFlight.delete(request);
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
      page.off('requestfinished', onRequestFinished);
      page.off('requestfailed', onRequestFailed);
      page.off('close', dispose);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfinished', onRequestFinished);
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
      () =>
        this.getPage(handle)
          .locator('html')
          .evaluate(
            /* v8 ignore next -- executed in Chromium; covered by real-browser integration */
            (element) => element.ownerDocument.title,
            undefined,
            operationOptions(control),
          ),
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
          .goto(url, operationOptions(control))
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
          .goBack(operationOptions(control))
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
          .goForward(operationOptions(control))
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
          .reload(operationOptions(control))
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
        await sourceLocator.dragTo(targetLocator, { timeout: remainingOperationTime(control) });
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
          timeout: remainingOperationTime(control),
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
          timeout: remainingOperationTime(control),
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
          .selectOption(value, { timeout: remainingOperationTime(control) })
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
      await enforceSnapshotSourceBudget(scopedLocator, control);
      const passwordValuesBefore = await readPasswordValues(scopedLocator, control);
      throwIfCancelled(control.signal);
      const snapshot = await scopedLocator.ariaSnapshot({
        timeout: remainingOperationTime(control),
        ...(control.signal === undefined ? {} : { signal: control.signal }),
        ...(options.maxDepth === undefined ? {} : { depth: options.maxDepth }),
        boxes: options.includeBoundingBoxes ?? false,
      });
      throwIfCancelled(control.signal);
      const passwordValuesAfter = await readPasswordValues(scopedLocator, control);
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
          timeout: remainingOperationTime(control),
        }),
      'read visible text',
      locator,
      control.timeoutMs,
    );
  }

  async screenshot(
    handle: BrowserPageHandle,
    options: ScreenshotOptions,
    plan: ScreenshotCapturePlan,
    control: OperationControl,
  ): Promise<Uint8Array> {
    throwIfCancelled(control.signal);
    return this.wrapAction(
      () =>
        this.getPage(handle).screenshot({
          ...operationOptions(control),
          type: 'png',
          fullPage: false,
          ...(plan.clip === undefined ? {} : { clip: plan.clip, captureBeyondViewport: true }),
          scale: 'css',
        }),
      'BROWSER_ERROR',
      options.locator === undefined
        ? 'Failed to capture page screenshot'
        : 'Failed to capture measured element screenshot',
      control.timeoutMs,
    );
  }

  async screenshotDimensions(
    handle: BrowserPageHandle,
    options: ScreenshotOptions,
    control: OperationControl,
  ): Promise<ScreenshotCapturePlan> {
    throwIfCancelled(control.signal);
    const page = this.getPage(handle);
    const screenshotLocator = options.locator;
    if (screenshotLocator !== undefined) {
      return this.wrapElement(
        async () => {
          const locator = await this.locate(page, screenshotLocator, control);
          await locator.scrollIntoViewIfNeeded(operationOptions(control));
          const box = await locator.boundingBox(operationOptions(control));
          if (box === null)
            throw new BrowserMeshError('ELEMENT_NOT_FOUND', 'Screenshot element has no box');
          const width = Math.ceil(box.width);
          const height = Math.ceil(box.height);
          return {
            width,
            height,
            clip: { x: Math.floor(box.x), y: Math.floor(box.y), width, height },
          };
        },
        'measure screenshot element',
        screenshotLocator,
        control.timeoutMs,
      );
    }
    return this.wrapAction(
      async () => {
        if (options.fullPage === true) {
          return page.locator('html').evaluate(
            /* v8 ignore next -- executed in Chromium; covered by real-browser integration */
            (root) => {
              const body = root.ownerDocument.body;
              const width = Math.ceil(
                Math.max(root.scrollWidth, root.clientWidth, body.scrollWidth, body.clientWidth),
              );
              const height = Math.ceil(
                Math.max(
                  root.scrollHeight,
                  root.clientHeight,
                  body.scrollHeight,
                  body.clientHeight,
                ),
              );
              return { width, height, clip: { x: 0, y: 0, width, height } };
            },
            undefined,
            operationOptions(control),
          );
        }
        const viewport = page.viewportSize();
        if (viewport !== null) return viewport;
        return page.locator('html').evaluate(
          /* v8 ignore next -- executed in Chromium; covered by real-browser integration */
          (element) => ({
            width: element.ownerDocument.defaultView?.innerWidth ?? 0,
            height: element.ownerDocument.defaultView?.innerHeight ?? 0,
          }),
          undefined,
          operationOptions(control),
        );
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
              const readyState = await page.locator('html').evaluate(
                /* v8 ignore next -- executed in Chromium; covered by real-browser integration */
                (element) => element.ownerDocument.readyState,
                undefined,
                operationOptions(control),
              );
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
    // The waiter no longer disposes itself when its promise settles, so this is
    // the only thing that unregisters its page listeners.
    let unexpectedFailure: Error | undefined;
    try {
      unexpectedFailure = await waiter.unexpectedFailure();
    } finally {
      waiter.dispose();
    }
    const actionResult = settled[0];
    const waitResult = settled[1];
    // A popup that satisfied the wait is registered but still owned by this
    // operation: its pageId only reaches the caller through a successful
    // result. Any failure discards that result, so this is the last place that
    // can close the page.
    // Returns the error to raise. `closePage` rejects when the page will not
    // close, and letting that propagate would replace the real reason the
    // operation failed with a cleanup detail -- and leave the handle in the
    // registry, since `closePage` only forgets it after a successful close.
    // Aggregate instead, as the waiter's own late-popup branch does.
    const closeUndeliveredPopup = async (primary: Error): Promise<Error> => {
      if (waitResult.status !== 'fulfilled' || waitResult.value.kind !== 'popup') return primary;
      try {
        await this.closePage(waitResult.value.page);
        return primary;
      } catch (cleanupError) {
        return new BrowserMeshError(
          'BROWSER_ERROR',
          'Operation failed and the popup it opened could not be closed',
          { cause: new AggregateError([primary, cleanupError]) },
        );
      }
    };
    if (actionResult.status === 'rejected')
      throw await closeUndeliveredPopup(errorObject(actionResult.reason));
    if (unexpectedFailure !== undefined) throw await closeUndeliveredPopup(unexpectedFailure);
    if (waitResult.status === 'rejected') throw errorObject(waitResult.reason);
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
    const target = action.target;
    switch (action.kind) {
      case 'click':
        await this.wrapElement(
          async () =>
            (await this.actionable(handle, target, control)).click({
              timeout: remainingOperationTime(control),
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
              timeout: remainingOperationTime(control),
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
        try {
          await disposeElementHandles([entry.handle], 'Failed to dispose an expired element ref');
        } catch (cleanupError) {
          throw staleElementReference(target.ref, cleanupError);
        }
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
      try {
        await disposeElementHandles([entry.handle], 'Failed to dispose a detached element ref');
      } catch (cleanupError) {
        throw staleElementReference(target.ref, cleanupError);
      }
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
      await disposeElementHandles(
        handles.map((entry) => entry.handle),
        'Element-ref capture and cleanup both failed',
        error,
      );
      throw error;
    }
    const prior = this.elementRefs.get(pageHandle.id);
    const next = new Map<string, ElementReferenceEntry>();
    views.forEach((view, index) => {
      const entry = handles.at(index);
      if (entry !== undefined) next.set(view.ref, entry);
    });
    this.elementRefs.set(pageHandle.id, next);
    if (prior !== undefined) {
      try {
        await disposeElementHandles(
          Array.from(prior.values(), (entry) => entry.handle),
          'Failed to dispose replaced element refs',
        );
      } catch (cleanupError) {
        this.elementRefs.delete(pageHandle.id);
        await disposeElementHandles(
          handles.map((entry) => entry.handle),
          'Old and replacement element-ref cleanup both failed',
          cleanupError,
        );
        throw cleanupError;
      }
    }
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
      if ('ref' in locator && !timedOut) throw staleElementReference(locator.ref);
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

async function pollUntil(
  check: (remainingMs: number) => Promise<boolean>,
  control: OperationControl,
): Promise<void> {
  let satisfied = false;
  while (!satisfied) {
    throwIfCancelled(control.signal);
    const remaining = remainingOperationTime(control);
    satisfied = await check(remaining);
    throwIfCancelled(control.signal);
    if (satisfied) continue;
    const remainingAfterCheck = remainingOperationTime(control);
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
  unexpectedFailure(): Promise<Error | undefined>;
}

function createEventWaiter(
  page: Page,
  wait: ActionWaitCondition,
  control: OperationControl,
  registerPopup: (popup: Page) => BrowserPageHandle,
): EventWaiter {
  let settled = false;
  // Distinct from `settled`: `finish` settles a success, and a late popup must not
  // be force-closed -- nor allowed to fail the operation -- when the wait succeeded.
  let failed = false;
  let unexpectedError: Error | undefined;
  let unexpectedCleanup: Promise<void> = Promise.resolve();
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
    failed = true;
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
        await page.waitForLoadState(wait.loadState, { timeout: remainingOperationTime(control) });
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
    if (wait.kind !== 'popup') {
      const error = new BrowserMeshError(
        'BROWSER_ERROR',
        `Unexpected popup while waiting for ${wait.kind}`,
        { details: { expectedEvent: wait.kind, actualEvent: 'popup' } },
      );
      unexpectedError ??= error;
      unexpectedCleanup = unexpectedCleanup.then(async () => {
        try {
          await popup.close();
        } catch (cleanupError) {
          unexpectedError = new BrowserMeshError(
            'BROWSER_ERROR',
            'Unexpected popup handling and cleanup both failed',
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
        fail(unexpectedError);
      });
      return;
    }
    if (failed) {
      // The operation already failed — commonly because a dialog arrived first
      // and rejected this waiter — so no pageId can reach the caller and
      // nothing else owns this page. Close it, which is the same policy the
      // unexpected branch above applies to a popup raised for another wait.
      //
      // Known bound: this only reclaims a popup Chromium delivers before
      // `actionAndWait` disposes the waiter. A popup attached after that has no
      // listener left — there is no context-level page listener — and still
      // leaks. Closing that window means owning pages the operation did not
      // create, which is an ownership change for an ADR rather than a fix here.
      unexpectedCleanup = unexpectedCleanup.then(async () => {
        try {
          await popup.close();
        } catch (cleanupError) {
          // Never `??=` here. The usual way to reach this branch is the
          // unexpected-dialog handler, which has already set `unexpectedError`,
          // so a conditional assignment would drop the cleanup failure in
          // exactly the case it exists to report. SPEC 8.1 item 8 requires
          // reporting cleanup failures rather than swallowing them.
          unexpectedError = new BrowserMeshError(
            'BROWSER_ERROR',
            'Operation failed and the popup it opened could not be closed',
            {
              cause:
                unexpectedError === undefined
                  ? cleanupError
                  : new AggregateError([unexpectedError, cleanupError]),
            },
          );
        }
      });
      return;
    }
    if (settled) {
      // Reaching here means the wait already succeeded with a different popup,
      // since a failed waiter returns above. `finish` would discard this one,
      // but its argument is evaluated first, so registering it would leave an
      // entry in the page registry that no caller can ever address -- the
      // orphan this change removes elsewhere.
      //
      // The tab itself is left alone. Closing a page after the operation
      // succeeded would either swallow the close failure or fail an operation
      // that did not fail, and adopting it needs the ownership change noted
      // above. This is the pre-existing leak, without the registry entry.
      return;
    }
    finish({ kind: 'popup', page: registerPopup(popup) });
  };
  const onDialog = (dialog: Dialog): void => {
    if (wait.kind !== 'dialog') {
      const error = new BrowserMeshError(
        'BROWSER_ERROR',
        `Unexpected ${dialog.type()} dialog while waiting for ${wait.kind}`,
        {
          details: {
            expectedEvent: wait.kind,
            actualEvent: 'dialog',
            actualDialogType: dialog.type(),
          },
        },
      );
      unexpectedError ??= error;
      unexpectedCleanup = unexpectedCleanup.then(async () => {
        try {
          await dialog.dismiss();
        } catch (cleanupError) {
          unexpectedError = new BrowserMeshError(
            'BROWSER_ERROR',
            'Unexpected dialog handling and cleanup both failed',
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
        fail(unexpectedError);
      });
      return;
    }
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
  const timeoutMs = remainingOperationTime(control);
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
  // Only guard against an unhandled rejection here. Disposing as soon as the
  // promise settles would unregister the popup listener before the operation
  // has finished failing, and a popup the action already requested would then
  // open with nothing listening for it. `actionAndWait` always disposes.
  void promise.catch(() => undefined);
  return {
    promise,
    cancel: fail,
    dispose,
    async unexpectedFailure() {
      // A late handler extends the chain by reassigning `unexpectedCleanup`.
      // Awaiting the identifier once would settle against whatever chain
      // existed at that instant and miss work scheduled while that await was
      // still pending, so drain until the chain stops growing.
      let pending = unexpectedCleanup;
      for (;;) {
        await pending;
        if (pending === unexpectedCleanup) break;
        pending = unexpectedCleanup;
      }
      return unexpectedError;
    },
  };
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

function staleElementReference(ref: string, cause?: unknown): BrowserMeshError {
  return new BrowserMeshError(
    'STALE_ELEMENT_REFERENCE',
    'Element reference is stale; capture a new snapshot and retry',
    { details: { ref }, ...(cause === undefined ? {} : { cause }) },
  );
}

function redactSecretValues(snapshot: string, secrets: readonly string[]): string {
  return [...new Set(secrets.filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'), snapshot);
}

async function enforceSnapshotSourceBudget(
  locator: PwLocator,
  control: OperationControl,
): Promise<void> {
  const observed = await locator.evaluate(
    /* v8 ignore next -- executed in Chromium; covered by real-browser integration */
    (root, limits) => {
      const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      let nodes = 0;
      let characters = 0;
      let current: Node | null = walker.currentNode;
      while (current !== null) {
        nodes += 1;
        if (current.nodeType === Node.TEXT_NODE) characters += current.textContent?.length ?? 0;
        else if (current instanceof Element) {
          for (const attribute of current.attributes)
            characters += attribute.name.length + attribute.value.length;
        }
        if (nodes > limits.maxNodes || characters > limits.maxChars)
          return { exceeded: true, nodes, characters };
        current = walker.nextNode();
      }
      return { exceeded: false, nodes, characters };
    },
    {
      maxNodes: SNAPSHOT_LIMITS.maxSourceNodes,
      maxChars: SNAPSHOT_LIMITS.maxSourceChars,
    },
    operationOptions(control),
  );
  if (observed.exceeded)
    throw new BrowserMeshError(
      'LIMIT_EXCEEDED',
      'Snapshot source exceeds the DOM node or character capture budget',
      {
        details: {
          maxSourceNodes: SNAPSHOT_LIMITS.maxSourceNodes,
          maxSourceChars: SNAPSHOT_LIMITS.maxSourceChars,
        },
      },
    );
}

async function readPasswordValues(
  locator: PwLocator,
  control: OperationControl,
): Promise<readonly string[]> {
  const observed = await locator.evaluate(
    /* v8 ignore next -- executed in Chromium; covered by real-browser integration */
    (root, limits) => {
      const values: string[] = [];
      let characters = 0;
      const inputs = root.querySelectorAll<HTMLInputElement>('input[type="password"]');
      if (inputs.length > limits.maxNodes) return { exceeded: true, values };
      for (const input of inputs) {
        characters += input.value.length;
        if (characters > limits.maxChars) return { exceeded: true, values: [] };
        values.push(input.value);
      }
      return { exceeded: false, values };
    },
    {
      maxNodes: SNAPSHOT_LIMITS.maxSourceNodes,
      maxChars: SNAPSHOT_LIMITS.maxSourceChars,
    },
    operationOptions(control),
  );
  if (observed.exceeded)
    throw new BrowserMeshError(
      'LIMIT_EXCEEDED',
      'Password redaction input exceeds snapshot budget',
    );
  return observed.values;
}

async function disposeElementHandles(
  handles: readonly ElementHandle[],
  message: string,
  primaryError?: unknown,
): Promise<void> {
  const settled = await Promise.allSettled(handles.map((handle) => handle.dispose()));
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failures.length === 0) return;
  throw new BrowserMeshError('BROWSER_ERROR', message, {
    cause: new AggregateError(
      primaryError === undefined ? failures : [primaryError, ...failures],
      message,
    ),
  });
}

function operationOptions(control: OperationControl): {
  readonly timeout: number;
  readonly signal?: AbortSignal;
} {
  return {
    timeout: remainingOperationTime(control),
    ...(control.signal === undefined ? {} : { signal: control.signal }),
  };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 2_000) || 'Unknown Playwright error';
}

function errorObject(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
