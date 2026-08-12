export interface RuntimeEvent {
  readonly type: string;
  readonly timestamp: string;
  readonly operationId?: string;
  readonly sessionId?: string;
  readonly pageId?: string;
}

export interface EventSinkPort {
  emit(event: RuntimeEvent): void;
}
