import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/domain/resource-limits.js';
import type { ElementHandle, Page } from 'playwright';
import type {
  BrowserPageHandle,
  ScreenshotCapturePlan,
} from '../../src/application/ports/browser-engine.js';
import type { ScreenshotOptions } from '../../src/domain/models.js';
import type { OperationControl } from '../../src/application/operation-control.js';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import { createRealRuntimeHarness } from '../support/real-runtime.js';

describe('real Chromium resource hardening', () => {
  it('rejects screenshot pixel overflow before capture and keeps the queue usable', async () => {
    const harness = await createRealRuntimeHarness(undefined, {
      ...DEFAULT_RESOURCE_LIMITS,
      screenshot: { maxDimensionPixels: 2_000, maxPixels: 100, maxBytes: 16_777_216 },
    });
    try {
      await harness.runtime.start();
      const created = await harness.runtime.createSession();
      const target = { sessionId: created.sessionId, pageId: created.pageId };
      await expect(harness.runtime.screenshot(target)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
      await expect(harness.runtime.getUrl(target)).resolves.toMatchObject({ value: 'about:blank' });
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects encoded screenshot overflow after capture and keeps the queue usable', async () => {
    const harness = await createRealRuntimeHarness(undefined, {
      ...DEFAULT_RESOURCE_LIMITS,
      screenshot: { maxDimensionPixels: 2_000, maxPixels: 2_000_000, maxBytes: 100 },
    });
    try {
      await harness.runtime.start();
      const created = await harness.runtime.createSession();
      const target = { sessionId: created.sessionId, pageId: created.pageId };
      await expect(harness.runtime.screenshot(target)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
      await expect(harness.runtime.getUrl(target)).resolves.toMatchObject({ value: 'about:blank' });
    } finally {
      await harness.cleanup();
    }
  });

  it('captures the immutable measured screenshot plan when the page grows before capture', async () => {
    class GrowingPageEngine extends PlaywrightBrowserEngine {
      override async screenshotDimensions(
        pageHandle: BrowserPageHandle,
        options: ScreenshotOptions,
        control: OperationControl,
      ): Promise<ScreenshotCapturePlan> {
        const plan = await super.screenshotDimensions(pageHandle, options, control);
        const pages = Reflect.get(this, 'pages') as Map<symbol, Page>;
        await pages
          .get(pageHandle.id)
          ?.setContent('<div style="width: 5000px; height: 5000px">expanded after measure</div>');
        return plan;
      }
    }

    const engine = new GrowingPageEngine({ headless: true, timeoutMs: 5_000 });
    const harness = await createRealRuntimeHarness(engine, {
      ...DEFAULT_RESOURCE_LIMITS,
      screenshot: { maxDimensionPixels: 2_000, maxPixels: 2_000_000, maxBytes: 16_777_216 },
    });
    try {
      await harness.runtime.start();
      const created = await harness.runtime.createSession();
      const target = { sessionId: created.sessionId, pageId: created.pageId };
      const captured = await harness.runtime.screenshot(target, { fullPage: true });
      expect(captured.width).toBeLessThanOrEqual(2_000);
      expect(captured.height).toBeLessThanOrEqual(2_000);
      await expect(harness.runtime.getUrl(target)).resolves.toMatchObject({ value: 'about:blank' });
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects an oversized snapshot source before native ARIA materialization', async () => {
    const harness = await createRealRuntimeHarness();
    try {
      await harness.runtime.start();
      const created = await harness.runtime.createSession();
      const target = { sessionId: created.sessionId, pageId: created.pageId };
      const pages = Reflect.get(harness.engine, 'pages') as Map<symbol, Page>;
      const page = pages.values().next().value;
      if (page === undefined) throw new Error('Expected a managed Playwright page');
      await page.setContent(`<main>${'<button>bounded</button>'.repeat(20_001)}</main>`);

      await expect(harness.runtime.snapshot(target)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
      await expect(harness.runtime.getTitle(target)).resolves.toMatchObject({ value: '' });
    } finally {
      await harness.cleanup();
    }
  });

  it('surfaces element-ref disposal failures and keeps the queue usable', async () => {
    const harness = await createRealRuntimeHarness();
    try {
      await harness.runtime.start();
      const created = await harness.runtime.createSession();
      const target = { sessionId: created.sessionId, pageId: created.pageId };
      const pages = Reflect.get(harness.engine, 'pages') as Map<symbol, Page>;
      const page = pages.values().next().value;
      if (page === undefined) throw new Error('Expected a managed Playwright page');
      await page.setContent('<button>replace ref</button>');
      await harness.runtime.snapshot(target, { includeRefs: true });

      const registries = Reflect.get(harness.engine, 'elementRefs') as Map<
        symbol,
        Map<string, { handle: ElementHandle }>
      >;
      const prior = registries.values().next().value?.values().next().value;
      if (prior === undefined) throw new Error('Expected a retained element ref');
      vi.spyOn(prior.handle, 'dispose').mockRejectedValueOnce(new Error('private cleanup detail'));

      await expect(harness.runtime.snapshot(target, { includeRefs: true })).rejects.toMatchObject({
        code: 'BROWSER_ERROR',
      });
      await expect(harness.runtime.getTitle(target)).resolves.toMatchObject({ value: '' });
    } finally {
      vi.restoreAllMocks();
      await harness.cleanup();
    }
  });
});
