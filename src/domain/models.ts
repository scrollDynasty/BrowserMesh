export type SessionStatus = 'creating' | 'ready' | 'closing' | 'closed' | 'failed';

export interface SessionView {
  readonly sessionId: string;
  readonly name?: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly restoredFromStateId?: string;
}

export interface PageView {
  readonly pageId: string;
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
      /** Exact accessible-name matching is the deterministic default. Set false only for deliberate partial matching. */
      readonly exact?: boolean;
    }
  | {
      readonly strategy: 'text' | 'label' | 'placeholder' | 'testId' | 'css';
      readonly value: string;
    };

export type UrlMatcher =
  | { readonly kind: 'exact'; readonly value: string }
  | { readonly kind: 'glob'; readonly value: string };

export type WaitCondition =
  | { readonly kind: 'url'; readonly matcher: UrlMatcher }
  | { readonly kind: 'load'; readonly state: 'domcontentloaded' | 'load' }
  | {
      readonly kind: 'locator';
      readonly locator: Locator;
      readonly state: 'visible' | 'hidden' | 'attached' | 'detached' | 'enabled' | 'disabled';
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly state: 'present' | 'absent';
    };

export type BrowserAction =
  | { readonly kind: 'click'; readonly locator: Locator }
  | { readonly kind: 'press'; readonly locator: Locator; readonly key: string };

export type ActionWaitCondition =
  | {
      readonly kind: 'navigation';
      readonly matcher?: UrlMatcher;
      readonly loadState?: 'domcontentloaded' | 'load';
    }
  | {
      readonly kind: 'response';
      readonly matcher: UrlMatcher;
      readonly method?: string;
      readonly status?: number;
    };

export interface WaitResult {
  readonly condition: WaitCondition;
}

export interface ActionAndWaitResult {
  readonly action: BrowserAction;
  readonly wait: ActionWaitCondition;
  readonly event: {
    readonly kind: 'navigation' | 'response';
    readonly url: string;
    readonly method?: string;
    readonly status?: number;
  };
}

export interface OperationResult<T> {
  readonly operationId: string;
  readonly sessionId?: string;
  readonly pageId?: string;
  readonly value: T;
}

export interface PageAddressedOperationResult<T> extends OperationResult<T> {
  readonly sessionId: string;
  readonly pageId: string;
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
