export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  get pending(): number {
    return this.pendingCount;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pendingCount += 1;
    const result = this.tail.then(task, task);
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
