import type { EventSinkPort, RuntimeEvent } from '../application/ports/events.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const rank: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class StructuredLogger implements EventSinkPort {
  constructor(
    private readonly level: LogLevel,
    private readonly output: NodeJS.WritableStream = process.stderr,
  ) {}

  emit(event: RuntimeEvent): void {
    this.log('info', event.type, { ...event });
  }

  log(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    if (this.level === 'silent' || rank[level] < rank[this.level]) return;
    this.output.write(`${JSON.stringify({ level, message, ...fields })}\n`);
  }
}
