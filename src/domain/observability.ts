export type ObservationKind = 'console' | 'page_error' | 'request' | 'response' | 'request_failed';

export interface ObservationEvent {
  readonly eventId: string;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly pageId: string;
  readonly kind: ObservationKind;
  readonly level?: string;
  readonly text?: string;
  readonly requestId?: string;
  readonly method?: string;
  readonly url?: string;
  readonly resourceType?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly failure?: string;
}

export type BrowserObservation =
  | { readonly kind: 'console'; readonly level: string; readonly text: string }
  | { readonly kind: 'page_error'; readonly text: string }
  | {
      readonly kind: 'request';
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly resourceType: string;
    }
  | {
      readonly kind: 'response';
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly resourceType: string;
      readonly status: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'request_failed';
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly resourceType: string;
      readonly durationMs: number;
      readonly failure: string;
    };

const SENSITIVE_QUERY_KEY =
  /^(?:access[_-]?token|auth(?:orization)?|cookie|credential|key|password|passwd|secret|session|token|api[_-]?key|client[_-]?secret)$/iu;

/** Returns a bounded URL containing no credentials, fragment, or sensitive query values. */
export function sanitizeObservationUrl(value: string, maximum: number): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (isSensitiveQueryKey(key)) parsed.searchParams.set(key, '[REDACTED]');
  }
  return boundString(parsed.href, maximum);
}

export function redactAndBoundObservationText(value: string, maximum: number): string {
  const secret =
    /((?:authorization|cookie|password|passwd|token|secret|api[_-]?key|session)[\s:=]+)([^\s,;]+)/giu;
  const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
  return boundString(
    value.replace(bearer, 'Bearer [REDACTED]').replace(secret, '$1[REDACTED]'),
    maximum,
  );
}

export function boundString(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum
    ? value
    : `${characters.slice(0, Math.max(0, maximum - 1)).join('')}…`;
}

function isSensitiveQueryKey(key: string): boolean {
  let candidate = key;
  for (let index = 0; index < 3; index += 1) {
    if (SENSITIVE_QUERY_KEY.test(candidate)) return true;
    try {
      const decoded = decodeURIComponent(candidate.replace(/\+/gu, ' '));
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  return SENSITIVE_QUERY_KEY.test(candidate);
}
