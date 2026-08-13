import { describe, expect, it } from 'vitest';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/domain/resource-limits.js';
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
});
