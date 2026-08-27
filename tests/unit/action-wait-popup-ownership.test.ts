import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserEngine } from '../../src/adapters/playwright/playwright-browser-engine.js';
import { createOperationControl } from '../../src/application/operation-control.js';
import type { BrowserPageHandle } from '../../src/application/ports/browser-engine.js';

/**
 * A click can open the awaited popup and raise a dialog, and Chromium delivers
 * those two events in either order. Each order runs different compensation
 * code, so a real-browser test only ever pins whichever order that machine
 * happens to produce. These drive both orders explicitly against a fake page.
 */
describe('actionAndWait popup ownership', () => {
  it('closes a popup that arrives after a dialog already failed the operation', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    stubAction(engine, async () => {
      page.emit('dialog', dialog());
      // The dialog handler fails the waiter from a promise chain, so the popup
      // has to be emitted after that chain runs -- otherwise the waiter is
      // still unsettled and this is the other ordering, not this one.
      await flush();
      page.emit('popup', popup);
      await flush();
    });

    await expect(actionAndWait(engine, handle)).rejects.toMatchObject({
      code: 'BROWSER_ERROR',
      message: 'Unexpected alert dialog while waiting for popup',
    });
    expect(popup.closed).toBe(true);
    expect(registeredPages(engine)).toHaveLength(1);
  });

  it('closes a popup that satisfied the wait when a later dialog fails the operation', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    stubAction(engine, async () => {
      page.emit('popup', popup);
      await flush();
      page.emit('dialog', dialog());
      await flush();
    });

    await expect(actionAndWait(engine, handle)).rejects.toMatchObject({
      code: 'BROWSER_ERROR',
      message: 'Unexpected alert dialog while waiting for popup',
    });
    expect(popup.closed).toBe(true);
    expect(registeredPages(engine)).toHaveLength(1);
  });

  it('reports a failed popup close instead of letting the dialog error hide it', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    popup.closeError = new Error('target closed');
    stubAction(engine, async () => {
      page.emit('dialog', dialog());
      await flush();
      page.emit('popup', popup);
      await flush();
    });

    const error = await actionAndWait(engine, handle).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'BROWSER_ERROR',
      message: 'Operation failed and the popup it opened could not be closed',
    });
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors).toHaveLength(2);
  });

  it('keeps the dialog failure when the popup it opened cannot be closed', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    popup.closeError = new Error('target closed');
    stubAction(engine, async () => {
      page.emit('popup', popup);
      await flush();
      page.emit('dialog', dialog());
      await flush();
    });

    const error = await actionAndWait(engine, handle).catch((reason: unknown) => reason);
    // Not "Failed to close browser page": a cleanup detail must not replace the
    // reason the operation actually failed.
    expect(error).toMatchObject({
      code: 'BROWSER_ERROR',
      message: 'Operation failed and the popup it opened could not be closed',
    });
    const errors = ((error as { cause?: unknown }).cause as AggregateError).errors;
    expect(errors[0]).toMatchObject({ message: 'Unexpected alert dialog while waiting for popup' });
  });

  it('does not fail a successful wait because a second popup could not be closed', async () => {
    const { engine, page, handle } = engineWithPage();
    const delivered = new FakePage();
    const extra = new FakePage();
    extra.closeError = new Error('target closed');
    stubAction(engine, async () => {
      page.emit('popup', delivered);
      await flush();
      page.emit('popup', extra);
      await flush();
    });

    // The wait succeeded. A second tab arriving afterwards is not this
    // operation's failure, and must not destroy the page it is about to return.
    await expect(actionAndWait(engine, handle)).resolves.toMatchObject({ kind: 'popup' });
    expect(delivered.closed).toBe(false);
  });
});

class FakePage extends EventEmitter {
  closed = false;
  closeError: Error | undefined;

  isClosed(): boolean {
    return this.closed;
  }

  mainFrame(): object {
    return this;
  }

  async close(): Promise<void> {
    if (this.closeError !== undefined) throw this.closeError;
    this.closed = true;
    this.emit('close');
  }
}

function engineWithPage(): {
  engine: PlaywrightBrowserEngine;
  page: FakePage;
  handle: BrowserPageHandle;
} {
  const engine = new PlaywrightBrowserEngine({ headless: true, timeoutMs: 5_000 });
  const page = new FakePage();
  const id = Symbol('page');
  registeredPageMap(engine).set(id, page);
  return { engine, page, handle: { id, kind: 'page' } as unknown as BrowserPageHandle };
}

function registeredPageMap(engine: PlaywrightBrowserEngine): Map<symbol, unknown> {
  return Reflect.get(engine, 'pages') as Map<symbol, unknown>;
}

function registeredPages(engine: PlaywrightBrowserEngine): unknown[] {
  return [...registeredPageMap(engine).values()];
}

/** The action itself is irrelevant here; the events it provokes are the subject. */
function stubAction(engine: PlaywrightBrowserEngine, run: () => Promise<void>): void {
  Reflect.set(engine, 'performCompositeAction', run);
}

function actionAndWait(
  engine: PlaywrightBrowserEngine,
  handle: BrowserPageHandle,
): Promise<unknown> {
  return engine.actionAndWait(
    handle,
    { kind: 'click', target: { strategy: 'testId', value: 'irrelevant' } },
    { kind: 'popup' },
    createOperationControl(5_000),
  );
}

function dialog(): object {
  return {
    type: () => 'alert',
    message: () => 'Alert beside the popup',
    defaultValue: () => '',
    dismiss: async () => undefined,
    accept: async () => undefined,
  };
}

/** Let already-queued promise chains run before emitting the next event. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}
