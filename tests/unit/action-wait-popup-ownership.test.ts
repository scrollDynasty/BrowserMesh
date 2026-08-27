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

  it('closes a popup that won the race against a dialog already failing the operation', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    stubAction(engine, async () => {
      // Same tick: the dialog handler records the failure synchronously but
      // fails the waiter from a promise chain, so the popup still satisfies the
      // wait. The operation then throws with a registered popup nobody receives.
      page.emit('dialog', dialog());
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

  it('leaves a settled popup wait alone when a dialog arrives afterwards', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    stubAction(engine, async () => {
      page.emit('popup', popup);
      await flush();
      // The waiter has settled, so the dialog listener is already gone and
      // Playwright dismisses this itself. The operation keeps its result -- the
      // behaviour before this change, pinned so it is not lost again.
      page.emit('dialog', dialog());
      await flush();
    });

    await expect(actionAndWait(engine, handle)).resolves.toMatchObject({ kind: 'popup' });
    expect(popup.closed).toBe(false);
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
      page.emit('dialog', dialog());
      page.emit('popup', popup);
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

  it('leaves a settled non-popup wait alone when a stray popup arrives', async () => {
    const { engine, page, handle } = engineWithPage();
    const stray = new FakePage();
    stubAction(engine, async () => {
      page.emit('dialog', dialog());
      await flush();
      // The popup listener deliberately outlives the settle so a requested page
      // can still be reclaimed. It must not turn this succeeded dialog wait
      // into BROWSER_ERROR: Unexpected popup while waiting for dialog.
      page.emit('popup', stray);
      await flush();
    });

    await expect(
      actionAndWait(engine, handle, { kind: 'dialog', dialogType: 'alert', action: 'accept' }),
    ).resolves.toMatchObject({ kind: 'dialog' });
  });

  it('keeps the real failure when a stray popup follows an already-failed wait', async () => {
    const { engine, page, handle } = engineWithPage();
    const stray = new FakePage();
    stubAction(engine, async () => {
      // The wrong dialog type fails the waiter on its own terms, leaving
      // `unexpectedError` unset -- which is what lets a later popup overwrite
      // the reported reason if this branch is not guarded.
      page.emit('dialog', dialog());
      await flush();
      page.emit('popup', stray);
      await flush();
    });

    await expect(
      actionAndWait(engine, handle, { kind: 'dialog', dialogType: 'confirm', action: 'accept' }),
    ).rejects.toMatchObject({
      code: 'BROWSER_ERROR',
      message: 'Expected confirm dialog but received alert',
    });
    // Reclaimed all the same: the operation failed, so nobody can receive it.
    expect(stray.closed).toBe(true);
  });

  it('drains a cleanup chain that grows while it is already being awaited', async () => {
    const { engine, page, handle } = engineWithPage();
    const first = new FakePage();
    const second = new FakePage();
    // The second popup lands while the first close is in flight, so it extends
    // `unexpectedCleanup` behind the read `unexpectedFailure()` has already made.
    first.whileClosing = () => page.emit('popup', second);
    stubAction(engine, async () => {
      page.emit('dialog', dialog());
      await flush();
      // No flush: the close must still be running when the drain takes its
      // first read, or the chain would already be settled and never grow.
      page.emit('popup', first);
    });

    await expect(actionAndWait(engine, handle)).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
    expect(first.closed).toBe(true);
    // Only true if the drain noticed the chain had been reassigned and looped.
    expect(second.closed).toBe(true);
  });

  it('keeps an abort recognisable when a cleanup failure is also pending', async () => {
    const { engine, page, handle } = engineWithPage();
    const abort = new Error('operation cancelled');
    abort.name = 'AbortError';
    stubAction(engine, async () => {
      // Sets unexpectedError, which is what would otherwise be aggregated into
      // the abort and rename it.
      page.emit('dialog', dialog());
      await flush();
      throw abort;
    });

    const error = await actionAndWait(engine, handle).catch((reason: unknown) => reason);
    // `isCancellation` matches on the name, so wrapping this in a
    // BrowserMeshError would report a cancelled operation as a browser failure.
    expect((error as Error).name).toBe('AbortError');
    expect(error).toBe(abort);
  });

  it('closes a registered popup on cancellation without renaming the abort', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    const abort = new Error('operation cancelled');
    abort.name = 'AbortError';
    stubAction(engine, async () => {
      // The popup satisfies the wait and is registered, then the action is
      // cancelled -- so a real page is in the registry when the abort arrives.
      page.emit('popup', popup);
      await flush();
      throw abort;
    });

    const error = await actionAndWait(engine, handle).catch((reason: unknown) => reason);
    expect(error).toBe(abort);
    expect(popup.closed).toBe(true);
    expect(registeredPages(engine)).toHaveLength(1);
  });

  it('still reports the abort when the popup it registered cannot be closed', async () => {
    const { engine, page, handle } = engineWithPage();
    const popup = new FakePage();
    popup.closeError = new Error('target closed');
    const abort = new Error('operation cancelled');
    abort.name = 'AbortError';
    stubAction(engine, async () => {
      page.emit('popup', popup);
      await flush();
      throw abort;
    });

    const error = await actionAndWait(engine, handle).catch((reason: unknown) => reason);
    // The close failure is deliberately swallowed here: reporting it would mean
    // rebuilding the error and renaming the abort, which downstream
    // `isCancellation` checks match on. Pinned so changing it is a decision.
    expect(error).toBe(abort);
    expect(popup.closed).toBe(false);
  });

  it('neither adopts nor fails on a second popup once the wait has succeeded', async () => {
    const { engine, page, handle } = engineWithPage();
    const delivered = new FakePage();
    const extra = new FakePage();
    stubAction(engine, async () => {
      page.emit('popup', delivered);
      await flush();
      page.emit('popup', extra);
      await flush();
    });

    // The wait succeeded. A second tab arriving afterwards is not this
    // operation's failure and must not destroy the page it is about to return.
    await expect(actionAndWait(engine, handle)).resolves.toMatchObject({ kind: 'popup' });
    expect(delivered.closed).toBe(false);
    // Nor may it enter the registry: no caller can ever hold an id for it, and
    // an unaddressable entry is the orphan this change exists to remove.
    expect(registeredPages(engine)).toEqual([page, delivered]);
    // Deliberately still open -- see the comment on the branch. This pins the
    // choice so a later change to close it is a decision, not an accident.
    expect(extra.closed).toBe(false);
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

  /** Runs while `close()` is still in flight, so a test can extend the chain. */
  whileClosing: (() => void) | undefined;

  async close(): Promise<void> {
    if (this.closeError !== undefined) throw this.closeError;
    if (this.whileClosing !== undefined) {
      // Park first, so the drain has already taken its read of the chain by the
      // time this extends it. Without the delay the chain grows before the read
      // and a single await would cover both links.
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.whileClosing();
    }
    // Never resolve within a microtask: a close the operation failed to await
    // must still be unfinished when the assertions run.
    await new Promise<void>((resolve) => setImmediate(resolve));
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
  wait: Parameters<PlaywrightBrowserEngine['actionAndWait']>[2] = { kind: 'popup' },
): Promise<unknown> {
  return engine.actionAndWait(
    handle,
    { kind: 'click', target: { strategy: 'testId', value: 'irrelevant' } },
    wait,
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
