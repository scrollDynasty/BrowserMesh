import { BrowserMeshError } from '../domain/errors.js';
import {
  boundString,
  redactAndBoundObservationText,
  sanitizeObservationUrl,
  type BrowserObservation,
  type ObservationEvent,
  type ObservationKind,
} from '../domain/observability.js';

export type { ObservationEvent, ObservationKind } from '../domain/observability.js';

interface StoredEvent {
  readonly sequence: number;
  readonly event: ObservationEvent;
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

export class BoundedObservationStore {
  private readonly events: StoredEvent[] = [];
  private sequence = 0;
  private droppedCount = 0;

  constructor(
    private readonly limits: ObservabilityLimits,
    private readonly namespace: string,
  ) {}

  append(
    input: BrowserObservation & {
      readonly timestamp: string;
      readonly sessionId: string;
      readonly pageId: string;
    },
  ): void {
    const sequence = ++this.sequence;
    const common = {
      eventId: this.encodeCursor(sequence),
      timestamp: input.timestamp,
      sessionId: input.sessionId,
      pageId: input.pageId,
      kind: input.kind,
    } as const;
    let event: ObservationEvent;
    if (input.kind === 'console' || input.kind === 'page_error') {
      event = {
        ...common,
        ...(input.kind === 'console' ? { level: boundString(input.level, 64) } : {}),
        text: redactAndBoundObservationText(input.text, this.limits.maxStringLength),
      };
    } else {
      const url = sanitizeObservationUrl(input.url, this.limits.maxStringLength);
      if (url === null) return;
      event = {
        ...common,
        requestId: boundString(input.requestId, 128),
        method: boundString(input.method.toUpperCase(), 32),
        url,
        resourceType: boundString(input.resourceType, 64),
        ...(input.kind === 'response'
          ? {
              status: normalizeStatus(input.status),
              durationMs: normalizeDuration(input.durationMs),
            }
          : {}),
        ...(input.kind === 'request_failed'
          ? {
              durationMs: normalizeDuration(input.durationMs),
              failure: redactAndBoundObservationText(input.failure, this.limits.maxStringLength),
            }
          : {}),
      };
    }
    this.events.push({ sequence, event });
    const overflow = this.events.length - this.limits.maxEventsPerPage;
    if (overflow > 0) {
      this.events.splice(0, overflow);
      this.droppedCount += overflow;
    }
  }

  list(input: {
    readonly kinds: readonly ObservationKind[];
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
      if (event.sequence <= since || !input.kinds.includes(event.event.kind)) continue;
      const storedView = event.event;
      const view =
        input.includeText === true || storedView.text === undefined
          ? storedView
          : omitText(storedView);
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
      nextCursor = event.event.eventId;
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

function omitText(event: ObservationEvent): ObservationEvent {
  return {
    eventId: event.eventId,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    pageId: event.pageId,
    kind: event.kind,
    ...(event.level === undefined ? {} : { level: event.level }),
    ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
    ...(event.method === undefined ? {} : { method: event.method }),
    ...(event.url === undefined ? {} : { url: event.url }),
    ...(event.resourceType === undefined ? {} : { resourceType: event.resourceType }),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.failure === undefined ? {} : { failure: event.failure }),
  };
}

function fitSingleEvent(event: ObservationEvent, maximumBytes: number): ObservationEvent | null {
  if (serializedBytes([event]) <= maximumBytes) return event;
  const field =
    event.text === undefined ? (event.failure === undefined ? undefined : 'failure') : 'text';
  if (field === undefined) return null;
  const original = event[field];
  if (original === undefined) return null;
  const characters = Array.from(original);
  let lower = 0;
  let upper = characters.length;
  let best: ObservationEvent | null = null;
  while (lower <= upper) {
    const length = Math.floor((lower + upper) / 2);
    const value =
      length === 0
        ? ''
        : length >= characters.length
          ? original
          : `${characters.slice(0, Math.max(0, length - 1)).join('')}…`;
    const candidate = { ...event, [field]: value };
    if (serializedBytes([candidate]) <= maximumBytes) {
      best = candidate;
      lower = length + 1;
    } else upper = length - 1;
  }
  return best;
}

function normalizeStatus(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0;
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 86_400_000) : 0;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
