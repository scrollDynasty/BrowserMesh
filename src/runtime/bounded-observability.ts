import { BrowserMeshError } from '../domain/errors.js';

export type ObservationKind = 'console' | 'page_error';

export interface ObservationEvent {
  readonly eventId: string;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly pageId: string;
  readonly kind: ObservationKind;
  readonly level?: string;
  readonly text?: string;
}

interface StoredEvent extends Omit<ObservationEvent, 'text'> {
  readonly sequence: number;
  readonly text: string;
}

export interface ObservationList {
  readonly events: readonly ObservationEvent[];
  readonly nextCursor: string | null;
  readonly droppedCount: number;
  readonly gap: boolean;
}

export interface ObservabilityLimits {
  readonly maxEventsPerPage: number;
  readonly maxStringLength: number;
  readonly maxPageSize: number;
  readonly maxResponseBytes: number;
}

const SECRET =
  /((?:authorization|cookie|password|passwd|token|secret|api[_-]?key|session)[\s:=]+)([^\s,;]+)/giu;
const BEARER = new RegExp('\\bBearer\\s+[A-Za-z0-9._~+/=-]+', 'giu');

export class BoundedObservationStore {
  private readonly events: StoredEvent[] = [];
  private sequence = 0;
  private droppedCount = 0;

  constructor(
    private readonly limits: ObservabilityLimits,
    private readonly namespace: string,
  ) {}

  append(input: Omit<ObservationEvent, 'eventId' | 'text'> & { readonly text: string }): void {
    const sequence = ++this.sequence;
    this.events.push({
      ...input,
      sequence,
      eventId: this.encodeCursor(sequence),
      text: redactAndBound(input.text, this.limits.maxStringLength),
      ...(input.level === undefined ? {} : { level: redactAndBound(input.level, 64) }),
    });
    if (this.events.length > this.limits.maxEventsPerPage) {
      this.events.splice(0, this.events.length - this.limits.maxEventsPerPage);
      this.droppedCount += 1;
    }
  }

  list(input: {
    readonly kind: ObservationKind;
    readonly sinceEventId?: string;
    readonly limit?: number;
    readonly includeText?: boolean;
  }): ObservationList {
    const requestedLimit = input.limit ?? Math.min(50, this.limits.maxPageSize);
    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > this.limits.maxPageSize
    )
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        `limit must be an integer between 1 and ${String(this.limits.maxPageSize)}`,
      );
    const since = input.sinceEventId === undefined ? 0 : this.decodeCursor(input.sinceEventId);
    if (since > this.sequence)
      throw new BrowserMeshError('INVALID_ARGUMENT', 'sinceEventId is not valid for this page');
    const oldest = this.events[0]?.sequence ?? this.sequence + 1;
    const gap = since > 0 && since < oldest - 1;
    const selected: ObservationEvent[] = [];
    let nextCursor: string | null = input.sinceEventId ?? null;
    const responseBudget = Math.max(0, this.limits.maxResponseBytes - 512);
    for (const event of this.events) {
      if (event.sequence <= since || event.kind !== input.kind) continue;
      const view: ObservationEvent = {
        eventId: event.eventId,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        pageId: event.pageId,
        kind: event.kind,
        ...(event.level === undefined ? {} : { level: event.level }),
        ...(input.includeText === true ? { text: event.text } : {}),
      };
      let boundedView = view;
      if (serializedBytes([...selected, boundedView]) > responseBudget) {
        if (selected.length > 0) break;
        const fitted = fitSingleEvent(boundedView, responseBudget);
        if (fitted === null)
          throw new BrowserMeshError(
            'LIMIT_EXCEEDED',
            'Observability event metadata exceeds the configured response byte limit',
          );
        boundedView = fitted;
      }
      selected.push(boundedView);
      nextCursor = event.eventId;
      if (selected.length >= requestedLimit) break;
    }
    return { events: selected, nextCursor, droppedCount: this.droppedCount, gap };
  }

  private encodeCursor(sequence: number): string {
    return `${this.namespace}_${sequence.toString(36).padStart(10, '0')}`;
  }

  private decodeCursor(cursor: string): number {
    const prefix = `${this.namespace}_`;
    if (!cursor.startsWith(prefix) || !/^[0-9a-z]{10}$/u.test(cursor.slice(prefix.length)))
      throw new BrowserMeshError('INVALID_ARGUMENT', 'sinceEventId is not valid for this page');
    const sequence = Number.parseInt(cursor.slice(prefix.length), 36);
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      throw new BrowserMeshError('INVALID_ARGUMENT', 'sinceEventId is not a valid event cursor');
    return sequence;
  }
}

function fitSingleEvent(event: ObservationEvent, maximumBytes: number): ObservationEvent | null {
  if (serializedBytes([event]) <= maximumBytes) return event;
  if (event.text === undefined) return null;
  const characters = Array.from(event.text);
  let lower = 0;
  let upper = characters.length;
  let best: ObservationEvent | null = null;
  while (lower <= upper) {
    const length = Math.floor((lower + upper) / 2);
    const text =
      length === 0
        ? ''
        : length >= characters.length
          ? event.text
          : `${characters.slice(0, length - 1).join('')}…`;
    const candidate = { ...event, text };
    if (serializedBytes([candidate]) <= maximumBytes) {
      best = candidate;
      lower = length + 1;
    } else {
      upper = length - 1;
    }
  }
  return best;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function redactAndBound(value: string, maximum: number): string {
  const redacted = value.replace(BEARER, 'Bearer [REDACTED]').replace(SECRET, '$1[REDACTED]');
  return redacted.length <= maximum ? redacted : `${redacted.slice(0, Math.max(0, maximum - 1))}…`;
}
