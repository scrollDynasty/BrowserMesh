import { throwIfCancelled } from '../application/operation-control.js';

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  get pending(): number {
    return this.pendingCount;
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.pendingCount += 1;
    const start = async (): Promise<T> => {
      // A request cancelled while waiting must never touch browser state.
      throwIfCancelled(signal);
      try {
        const value = await task();
        // Do not release the queue early for an in-flight action that cannot be aborted.
        throwIfCancelled(signal);
        return value;
      } catch (error) {
        throw error;
      }
    };
    const result = this.tail.then(start, start);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pendingCount -= 1;
    });
  }

  async idle(): Promise<void> {
    await this.tail;
  }
}
