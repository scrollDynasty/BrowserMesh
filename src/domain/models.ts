export type SessionStatus = 'creating' | 'ready' | 'closing' | 'closed' | 'failed';

export interface SessionView {
  readonly id: string;
  readonly name?: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly restoredFrom?: string;
}

export interface PageView {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly url: string;
  readonly isDefault: boolean;
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
  | {
      readonly strategy: 'text' | 'label' | 'placeholder' | 'testId' | 'css';
      readonly value: string;
    };

export interface OperationResult<T> {
  readonly operationId: string;
  readonly sessionId: string;
  readonly pageId?: string;
  readonly value: T;
}

export interface BrowserStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}
