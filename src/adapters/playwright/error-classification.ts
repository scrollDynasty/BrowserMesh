export const browserFailureReasons = [
  'timeout',
  'dns',
  'connection',
  'tls',
  'invalid_url',
  'locator_ambiguous',
  'element_not_found',
  'other',
] as const;

export type BrowserFailureReason = (typeof browserFailureReasons)[number];

/** Convert engine-private failures into a stable, engine-neutral public reason. */
export function classifyBrowserFailure(
  error: unknown,
  fallback: BrowserFailureReason = 'other',
): BrowserFailureReason {
  const name = safeErrorField(error, 'name').toLowerCase();
  const message = safeErrorField(error, 'message').toLowerCase();
  const text = `${name} ${message}`;

  if (name === 'timeouterror' || /\b(?:timed? out|timeout)\b/u.test(text)) return 'timeout';
  if (
    /err_(?:invalid_url|invalid_argument)|invalid url|cannot navigate to invalid url/u.test(text)
  ) {
    return 'invalid_url';
  }
  if (/err_(?:name_not_resolved|name_resolution_failed)|\b(?:enotfound|eai_again)\b/u.test(text)) {
    return 'dns';
  }
  if (
    /err_(?:connection_refused|connection_reset|connection_closed|connection_aborted|address_unreachable|internet_disconnected)|\b(?:econnrefused|econnreset|econnaborted|enetunreach|ehostunreach)\b/u.test(
      text,
    )
  ) {
    return 'connection';
  }
  if (
    /err_(?:cert_|ssl_|tls_)|certificate (?:error|expired|invalid)|self[- ]signed certificate|\b(?:ssl|tls) handshake\b/u.test(
      text,
    )
  ) {
    return 'tls';
  }
  if (/strict mode violation/u.test(text)) return 'locator_ambiguous';
  return fallback;
}

function safeErrorField(error: unknown, field: 'name' | 'message'): string {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return typeof error === 'string' && field === 'message' ? error.slice(0, 4_096) : '';
  }
  try {
    const value = Reflect.get(error, field) as unknown;
    return typeof value === 'string' ? value.slice(0, 4_096) : '';
  } catch {
    return '';
  }
}
