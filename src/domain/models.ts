import type { BrowserContextSettings } from './context-settings.js';

export type SessionStatus = 'creating' | 'ready' | 'closing' | 'closed' | 'failed';

export interface SessionView {
  readonly sessionId: string;
  readonly name?: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly restoredFromStateId?: string;
  readonly contextSettings: BrowserContextSettings;
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

export interface ElementReferenceTarget {
  readonly ref: string;
}

export type ElementTarget = Locator | ElementReferenceTarget;

export interface ElementReferenceView {
  readonly ref: string;
  readonly tag: string;
  readonly role?: string;
  readonly name?: string;
}

export interface SnapshotOptions {
  /** Restrict the snapshot to one explicitly resolved page locator. */
  readonly scope?: Locator;
  /** Maximum ARIA tree depth, passed to the browser engine's supported snapshot API. */
  readonly maxDepth?: number;
  /** Include viewport-relative CSS-pixel boxes in the ARIA snapshot. */
  readonly includeBoundingBoxes?: boolean;
  /** Maximum Unicode code points returned in snapshot content. */
  readonly maxChars?: number;
  /** Maximum UTF-8 bytes returned in snapshot content. */
  readonly maxBytes?: number;
  readonly includeRefs?: boolean;
  readonly maxRefs?: number;
  /** Retain only interactive ARIA nodes and their ancestor context. */
  readonly interactiveOnly?: boolean;
  /** Maximum direct children retained independently for every tree node. */
  readonly maxChildren?: number;
  /** Continue an immutable captured snapshot. Exclusive with capture controls. */
  readonly cursor?: string;
}

export interface SnapshotResult {
  readonly snapshot: string;
  /** A partial result is an ARIA YAML fragment and must not be parsed as a complete snapshot. */
  readonly contentFormat: 'aria-yaml' | 'aria-yaml-fragment';
  readonly partial: boolean;
  readonly refs: readonly ElementReferenceView[];
  readonly appliedBounds: {
    readonly scope: Locator | null;
    readonly maxDepth: number | null;
    readonly includeBoundingBoxes: boolean;
    readonly maxChars: number;
    readonly maxBytes: number;
    readonly includeRefs: boolean;
    readonly maxRefs: number;
    readonly interactiveOnly: boolean;
    readonly maxChildren: number | null;
  };
  readonly omissions: {
    readonly nonInteractiveNodes: number;
    readonly maxChildrenNodes: number;
    readonly sourceLimitReached: boolean;
  };
  readonly pagination: {
    readonly snapshotId: string | null;
    readonly nextCursor: string | null;
    readonly offsetChars: number;
    readonly expiresAt: string | null;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly byMaxChars: boolean;
    readonly byMaxBytes: boolean;
    readonly originalChars: number;
    readonly originalBytes: number;
    readonly returnedChars: number;
    readonly returnedBytes: number;
  };
}

export interface ScreenshotOptions {
  readonly fullPage?: boolean;
  readonly locator?: Locator;
}

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
  | { readonly kind: 'click'; readonly target: ElementTarget; readonly locator?: never }
  | { readonly kind: 'click'; readonly locator: Locator; readonly target?: never }
  | {
      readonly kind: 'press';
      readonly target: ElementTarget;
      readonly locator?: never;
      readonly key: string;
    }
  | {
      readonly kind: 'press';
      readonly locator: Locator;
      readonly target?: never;
      readonly key: string;
    };

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
    }
  | { readonly kind: 'popup' }
  | {
      readonly kind: 'dialog';
      readonly dialogType: 'alert' | 'beforeunload' | 'confirm' | 'prompt';
      readonly action: 'accept' | 'dismiss';
      /** Text supplied only when accepting a prompt dialog. */
      readonly promptText?: string;
    };

export interface WaitResult {
  readonly condition: WaitCondition;
}

export interface ActionAndWaitResult {
  readonly action: BrowserAction;
  readonly wait: ActionWaitCondition;
  readonly event:
    | {
        readonly kind: 'navigation' | 'response';
        readonly url: string;
        readonly method?: string;
        readonly status?: number;
      }
    | { readonly kind: 'popup'; readonly page: PageView; readonly url?: undefined }
    | {
        readonly kind: 'dialog';
        readonly dialogType: 'alert' | 'beforeunload' | 'confirm' | 'prompt';
        readonly action: 'accept' | 'dismiss';
        readonly message: string;
        readonly defaultValue: string;
        readonly url?: undefined;
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
