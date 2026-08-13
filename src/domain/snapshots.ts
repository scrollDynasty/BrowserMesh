import { BrowserMeshError } from './errors.js';
import type { SnapshotOptions, SnapshotResult } from './models.js';

export const SNAPSHOT_LIMITS = {
  defaultMaxChars: 50_000,
  defaultMaxBytes: 65_536,
  maxChars: 100_000,
  maxBytes: 131_072,
  maxDepth: 100,
  defaultMaxRefs: 50,
  maxRefs: 100,
} as const;

export interface NormalizedSnapshotOptions {
  readonly scope: SnapshotOptions['scope'] | undefined;
  readonly maxDepth: number | undefined;
  readonly includeBoundingBoxes: boolean;
  readonly maxChars: number;
  readonly maxBytes: number;
  readonly includeRefs: boolean;
  readonly maxRefs: number;
}

export function normalizeSnapshotOptions(options: SnapshotOptions): NormalizedSnapshotOptions {
  const maxDepth = optionalBound('maxDepth', options.maxDepth, 0, SNAPSHOT_LIMITS.maxDepth);
  const maxChars = bound(
    'maxChars',
    options.maxChars ?? SNAPSHOT_LIMITS.defaultMaxChars,
    1,
    SNAPSHOT_LIMITS.maxChars,
  );
  const maxBytes = bound(
    'maxBytes',
    options.maxBytes ?? SNAPSHOT_LIMITS.defaultMaxBytes,
    1,
    SNAPSHOT_LIMITS.maxBytes,
  );
  const includeRefs = options.includeRefs ?? false;
  if (!includeRefs && options.maxRefs !== undefined)
    throw new BrowserMeshError('INVALID_ARGUMENT', 'maxRefs requires includeRefs=true');
  const maxRefs = bound(
    'maxRefs',
    options.maxRefs ?? SNAPSHOT_LIMITS.defaultMaxRefs,
    1,
    SNAPSHOT_LIMITS.maxRefs,
  );
  return {
    scope: options.scope,
    maxDepth,
    includeBoundingBoxes: options.includeBoundingBoxes ?? false,
    maxChars,
    maxBytes,
    includeRefs,
    maxRefs,
  };
}

export function boundSnapshot(
  captured: string | { readonly snapshot: string; readonly refs: SnapshotResult['refs'] },
  options: NormalizedSnapshotOptions,
): SnapshotResult {
  const snapshot = typeof captured === 'string' ? captured : captured.snapshot;
  const refs = typeof captured === 'string' ? [] : captured.refs;
  const codePoints = Array.from(snapshot);
  const originalChars = codePoints.length;
  const originalBytes = Buffer.byteLength(snapshot, 'utf8');
  const byMaxChars = originalChars > options.maxChars;
  const byMaxBytes = originalBytes > options.maxBytes;
  let returnedChars = 0;
  let returnedBytes = 0;
  const returned: string[] = [];
  for (const codePoint of codePoints) {
    const bytes = Buffer.byteLength(codePoint, 'utf8');
    if (returnedChars === options.maxChars || returnedBytes + bytes > options.maxBytes) break;
    returned.push(codePoint);
    returnedChars += 1;
    returnedBytes += bytes;
  }
  const truncated = returnedChars !== originalChars;
  return {
    snapshot: truncated ? returned.join('') : snapshot,
    contentFormat: truncated ? 'aria-yaml-fragment' : 'aria-yaml',
    partial: truncated,
    refs,
    appliedBounds: {
      scope: options.scope ?? null,
      maxDepth: options.maxDepth ?? null,
      includeBoundingBoxes: options.includeBoundingBoxes,
      maxChars: options.maxChars,
      maxBytes: options.maxBytes,
      includeRefs: options.includeRefs,
      maxRefs: options.maxRefs,
    },
    truncation: {
      truncated,
      byMaxChars,
      byMaxBytes,
      originalChars,
      originalBytes,
      returnedChars,
      returnedBytes,
    },
  };
}

function optionalBound(
  name: string,
  value: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  return bound(name, value, minimum, maximum);
}

function bound(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value;
}
