import { describe, expect, it } from 'vitest';
import { SerialQueue } from '../../src/runtime/serial-queue.js';

describe('SerialQueue', () => {
  it('continues after failure and preserves submission order', async () => {
    const queue = new SerialQueue();
    const order: number[] = [];
    const first = queue.run(async () => {
      order.push(1);
      throw new Error('expected');
    });
    const second = queue.run(async () => {
      order.push(2);
      return 2;
    });
    await expect(first).rejects.toThrow('expected');
    await expect(second).resolves.toBe(2);
    await queue.idle();
    expect(order).toEqual([1, 2]);
    expect(queue.pending).toBe(0);
  });

  it('does not execute a queued task cancelled before it starts and then recovers', async () => {
    const queue = new SerialQueue();
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => (firstStarted = resolve));
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
          firstStarted();
        }),
    );
    await started;
    let executions = 0;
    const controller = new AbortController();
    const cancelled = queue.run(async () => {
      executions += 1;
    }, controller.signal);
    controller.abort(new DOMException('cancelled by test', 'AbortError'));

    releaseFirst();
    await first;
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queue.run(async () => 'recovered')).resolves.toBe('recovered');
    expect(executions).toBe(0);
    expect(queue.pending).toBe(0);
  });

  it('keeps an in-flight cancelled task in its slot until the real action settles', async () => {
    const queue = new SerialQueue();
    const controller = new AbortController();
    let releaseAction!: () => void;
    let actionStarted!: () => void;
    const started = new Promise<void>((resolve) => (actionStarted = resolve));
    const action = queue.run(async () => {
      actionStarted();
      await new Promise<void>((resolve) => (releaseAction = resolve));
    }, controller.signal);
    await started;
    controller.abort(new DOMException('cancelled by test', 'AbortError'));

    let followerStarted = false;
    const follower = queue.run(async () => {
      followerStarted = true;
    });
    await Promise.resolve();
    expect(followerStarted).toBe(false);
    expect(queue.pending).toBe(2);

    releaseAction();
    await expect(action).rejects.toMatchObject({ name: 'AbortError' });
    await follower;
    expect(followerStarted).toBe(true);
    expect(queue.pending).toBe(0);
  });
});
