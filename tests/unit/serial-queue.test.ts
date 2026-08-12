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
});
