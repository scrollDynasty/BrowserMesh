import { parseDocument, stringify } from 'yaml';

import { BrowserMeshError } from './errors.js';
import type { ElementReferenceView, SnapshotOptions, SnapshotResult } from './models.js';

export const SNAPSHOT_LIMITS = {
  defaultMaxChars: 50_000,
  defaultMaxBytes: 65_536,
  maxChars: 100_000,
  maxBytes: 131_072,
  maxDepth: 100,
  defaultMaxRefs: 50,
  maxRefs: 100,
  maxChildren: 1_000,
  retainedChars: 1_000_000,
  maxSourceNodes: 20_000,
  maxSourceChars: 2_000_000,
  retainedSnapshotsPerPage: 4,
  cursorTtlMs: 30_000,
} as const;

const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

export interface NormalizedSnapshotOptions {
  readonly scope: SnapshotOptions['scope'] | undefined;
  readonly maxDepth: number | undefined;
  readonly includeBoundingBoxes: boolean;
  readonly maxChars: number;
  readonly maxBytes: number;
  readonly includeRefs: boolean;
  readonly maxRefs: number;
  readonly interactiveOnly: boolean;
  readonly maxChildren: number | undefined;
  readonly cursor: string | undefined;
}

export interface PreparedSnapshot {
  readonly content: string;
  readonly refs: readonly ElementReferenceView[];
  readonly appliedBounds: SnapshotResult['appliedBounds'];
  readonly omissions: SnapshotResult['omissions'];
  readonly sourceLimited: boolean;
}

export function normalizeSnapshotOptions(options: SnapshotOptions): NormalizedSnapshotOptions {
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
  if (options.cursor !== undefined) {
    const captureOption = Object.entries(options).find(
      ([name, value]) => name !== 'cursor' && value !== undefined,
    );
    if (captureOption !== undefined)
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        `cursor cannot be combined with ${captureOption[0]}`,
      );
    if (options.cursor.length < 1 || options.cursor.length > 160)
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        'cursor must contain 1 through 160 characters',
      );
    return {
      scope: undefined,
      maxDepth: undefined,
      includeBoundingBoxes: false,
      maxChars,
      maxBytes,
      includeRefs: false,
      maxRefs: SNAPSHOT_LIMITS.defaultMaxRefs,
      interactiveOnly: false,
      maxChildren: undefined,
      cursor: options.cursor,
    };
  }
  const maxDepth = optionalBound('maxDepth', options.maxDepth, 0, SNAPSHOT_LIMITS.maxDepth);
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
    interactiveOnly: options.interactiveOnly ?? false,
    maxChildren: optionalBound('maxChildren', options.maxChildren, 1, SNAPSHOT_LIMITS.maxChildren),
    cursor: undefined,
  };
}

export function prepareSnapshot(
  captured: string | { readonly snapshot: string; readonly refs: readonly ElementReferenceView[] },
  options: NormalizedSnapshotOptions,
): PreparedSnapshot {
  const raw = typeof captured === 'string' ? captured : captured.snapshot;
  const refs = typeof captured === 'string' ? [] : captured.refs;
  let content = raw;
  let nonInteractiveNodes = 0;
  let maxChildrenNodes = 0;
  if (options.interactiveOnly || options.maxChildren !== undefined) {
    let tree: unknown;
    try {
      const document = parseDocument(raw, { prettyErrors: false, strict: true });
      const parseError = document.errors.at(0);
      if (parseError !== undefined)
        throw new Error('Invalid ARIA snapshot YAML', { cause: parseError });
      tree = document.toJS() as unknown;
    } catch (error) {
      throw new BrowserMeshError('BROWSER_ERROR', 'Browser returned invalid ARIA snapshot YAML', {
        cause: error,
      });
    }
    if (options.interactiveOnly) {
      const filtered = filterInteractive(tree);
      tree = filtered.retained ? filtered.value : [];
      nonInteractiveNodes = filtered.omitted;
    }
    if (options.maxChildren !== undefined) {
      const limited = limitChildren(tree, options.maxChildren);
      tree = limited.value;
      maxChildrenNodes = limited.omitted;
    }
    content = stringify(tree, { lineWidth: 0 });
  }
  const codePoints = Array.from(content);
  const sourceLimited = codePoints.length > SNAPSHOT_LIMITS.retainedChars;
  if (sourceLimited) content = codePoints.slice(0, SNAPSHOT_LIMITS.retainedChars).join('');
  return {
    content,
    refs,
    appliedBounds: {
      scope: options.scope ?? null,
      maxDepth: options.maxDepth ?? null,
      includeBoundingBoxes: options.includeBoundingBoxes,
      maxChars: options.maxChars,
      maxBytes: options.maxBytes,
      includeRefs: options.includeRefs,
      maxRefs: options.maxRefs,
      interactiveOnly: options.interactiveOnly,
      maxChildren: options.maxChildren ?? null,
    },
    omissions: { nonInteractiveNodes, maxChildrenNodes, sourceLimitReached: sourceLimited },
    sourceLimited,
  };
}

export function pageSnapshot(
  prepared: PreparedSnapshot,
  offsetChars: number,
  snapshotId: string | null,
  expiresAt: string | null,
): SnapshotResult {
  const codePoints = Array.from(prepared.content);
  if (
    !Number.isInteger(offsetChars) ||
    offsetChars < 0 ||
    (codePoints.length === 0 ? offsetChars !== 0 : offsetChars >= codePoints.length)
  )
    throw new BrowserMeshError('STALE_SNAPSHOT_CURSOR', 'Snapshot cursor is stale');
  const returned: string[] = [];
  let returnedBytes = 0;
  for (let index = offsetChars; index < codePoints.length; index += 1) {
    const codePoint = codePoints.at(index);
    if (codePoint === undefined) break;
    const bytes = Buffer.byteLength(codePoint, 'utf8');
    if (
      returned.length === prepared.appliedBounds.maxChars ||
      returnedBytes + bytes > prepared.appliedBounds.maxBytes
    )
      break;
    returned.push(codePoint);
    returnedBytes += bytes;
  }
  if (returned.length === 0 && offsetChars < codePoints.length) {
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      'maxBytes is too small to return the next Unicode code point',
      {
        details: {
          maxBytes: prepared.appliedBounds.maxBytes,
          requiredBytes: Buffer.byteLength(codePoints.at(offsetChars) ?? '', 'utf8'),
          offsetChars,
        },
      },
    );
  }
  const nextOffset = offsetChars + returned.length;
  const hasNext = nextOffset < codePoints.length;
  const paginated = offsetChars > 0 || hasNext || prepared.sourceLimited;
  return {
    snapshot: returned.join(''),
    contentFormat: paginated ? 'aria-yaml-fragment' : 'aria-yaml',
    partial: paginated,
    refs: offsetChars === 0 ? prepared.refs : [],
    appliedBounds: prepared.appliedBounds,
    omissions: prepared.omissions,
    pagination: {
      snapshotId,
      nextCursor: hasNext && snapshotId !== null ? `${snapshotId}.${String(nextOffset)}` : null,
      offsetChars,
      expiresAt,
    },
    truncation: {
      truncated: hasNext || prepared.sourceLimited,
      byMaxChars: hasNext && returned.length === prepared.appliedBounds.maxChars,
      byMaxBytes:
        hasNext &&
        returnedBytes + Buffer.byteLength(codePoints.at(nextOffset) ?? '', 'utf8') >
          prepared.appliedBounds.maxBytes,
      originalChars: codePoints.length,
      originalBytes: Buffer.byteLength(prepared.content, 'utf8'),
      returnedChars: returned.length,
      returnedBytes,
    },
  };
}

/** Compatibility helper for direct callers that do not retain a cursor. */
export function boundSnapshot(
  captured: string | { readonly snapshot: string; readonly refs: readonly ElementReferenceView[] },
  options: NormalizedSnapshotOptions,
): SnapshotResult {
  return pageSnapshot(prepareSnapshot(captured, options), 0, null, null);
}

function filterInteractive(value: unknown): {
  readonly retained: boolean;
  readonly value?: unknown;
  readonly omitted: number;
} {
  if (Array.isArray(value)) {
    const children: readonly unknown[] = value as readonly unknown[];
    const retained: unknown[] = [];
    let omitted = 0;
    for (const child of children) {
      const filtered = filterInteractive(child);
      omitted += filtered.omitted;
      if (filtered.retained) retained.push(filtered.value);
    }
    return retained.length === 0
      ? { retained: false, omitted }
      : { retained: true, value: retained, omitted };
  }
  if (typeof value === 'string') {
    const role = roleOf(value);
    return role !== null && INTERACTIVE_ROLES.has(role)
      ? { retained: true, value, omitted: 0 }
      : { retained: false, omitted: 1 };
  }
  if (!isRecord(value)) return { retained: false, omitted: 1 };
  const entries = Object.entries(value);
  const firstEntry = entries.at(0);
  if (firstEntry === undefined) return { retained: false, omitted: 1 };
  const [label, children] = firstEntry;
  const role = roleOf(label);
  const filteredChildren = filterInteractive(children);
  if (role !== null && INTERACTIVE_ROLES.has(role))
    return {
      retained: true,
      value: { [label]: filteredChildren.retained ? filteredChildren.value : [] },
      omitted: filteredChildren.omitted,
    };
  if (filteredChildren.retained)
    return {
      retained: true,
      value: { [label]: filteredChildren.value },
      omitted: filteredChildren.omitted,
    };
  return { retained: false, omitted: 1 + filteredChildren.omitted };
}

function limitChildren(
  value: unknown,
  maximum: number,
): { readonly value: unknown; readonly omitted: number } {
  if (Array.isArray(value)) {
    const children: readonly unknown[] = value as readonly unknown[];
    const kept = children.slice(0, maximum);
    let omitted = 0;
    for (const child of children.slice(maximum)) omitted += countNodes(child);
    const transformed = kept.map((child) => {
      const result = limitChildren(child, maximum);
      omitted += result.omitted;
      return result.value;
    });
    return { value: transformed, omitted };
  }
  if (isRecord(value)) {
    const transformed: Record<string, unknown> = {};
    let omitted = 0;
    for (const [key, child] of Object.entries(value)) {
      const result = limitChildren(child, maximum);
      transformed[key] = result.value;
      omitted += result.omitted;
    }
    return { value: transformed, omitted };
  }
  return { value, omitted: 0 };
}

function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    const children: readonly unknown[] = value as readonly unknown[];
    let total = 0;
    for (const child of children) total += countNodes(child);
    return total;
  }
  if (isRecord(value)) {
    let total = 0;
    for (const child of Object.values(value)) total += 1 + countNodes(child);
    return total;
  }
  return 1;
}

function roleOf(label: string): string | null {
  const match = /^([a-z][a-z0-9]*)\b/u.exec(label.trim());
  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new BrowserMeshError(
      'INVALID_ARGUMENT',
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  return value;
}
