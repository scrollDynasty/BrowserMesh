export type SessionStatus = 'creating' | 'ready' | 'closing' | 'closed' | 'failed';
export type AgentStatus = 'active' | 'removed';
export type MessageType = 'message' | 'request' | 'response' | 'event' | 'handoff';

export interface SessionView {
  readonly id: string;
  readonly name?: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly ownerAgentId?: string;
  readonly restoredFrom?: string;
}

export interface PageView {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly url: string;
  readonly isDefault: boolean;
}

export interface AgentView {
  readonly id: string;
  readonly name: string;
  readonly status: AgentStatus;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface MessageView {
  readonly id: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly type: MessageType;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly replyTo?: string;
  readonly acknowledgedAt?: string;
}

export type Locator =
  | {
      readonly strategy: 'role';
      readonly value:
        | 'button'
        | 'link'
        | 'textbox'
        | 'checkbox'
        | 'radio'
        | 'combobox'
        | 'heading'
        | 'listitem'
        | 'option'
        | 'tab';
      readonly name?: string;
    }
  | { readonly strategy: 'text' | 'label' | 'placeholder' | 'testId' | 'css'; readonly value: string };

export interface OperationResult<T> {
  readonly operationId: string;
  readonly sessionId: string;
  readonly pageId?: string;
  readonly value: T;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
