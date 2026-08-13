import { BrowserMeshError } from './errors.js';

export const DEFAULT_RESOURCE_LIMITS = {
  session: {
    maxNameChars: 128,
    maxNameBytes: 512,
    maxMetadataEntries: 32,
    maxMetadataKeyChars: 64,
    maxMetadataKeyBytes: 256,
    maxMetadataValueChars: 512,
    maxMetadataValueBytes: 2_048,
    maxMetadataBytes: 8_192,
  },
  screenshot: {
    maxDimensionPixels: 10_000,
    maxPixels: 40_000_000,
    maxBytes: 16_777_216,
  },
  visibleText: {
    maxChars: 20_000,
    maxBytes: 65_536,
  },
  persistence: {
    maxStates: 100,
    maxStateBytes: 1_048_576,
    maxTotalBytes: 16_777_216,
  },
} as const;

export interface ResourceLimits {
  readonly session: {
    readonly maxNameChars: number;
    readonly maxNameBytes: number;
    readonly maxMetadataEntries: number;
    readonly maxMetadataKeyChars: number;
    readonly maxMetadataKeyBytes: number;
    readonly maxMetadataValueChars: number;
    readonly maxMetadataValueBytes: number;
    readonly maxMetadataBytes: number;
  };
  readonly screenshot: {
    readonly maxDimensionPixels: number;
    readonly maxPixels: number;
    readonly maxBytes: number;
  };
  readonly visibleText: { readonly maxChars: number; readonly maxBytes: number };
  readonly persistence: {
    readonly maxStates: number;
    readonly maxStateBytes: number;
    readonly maxTotalBytes: number;
  };
}

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
const containsControl = (value: string): boolean =>
  Array.from(value, (character) => character.codePointAt(0) ?? 0).some(
    (codePoint) => codePoint <= 31 || (codePoint >= 127 && codePoint <= 159),
  );

function validateText(field: string, value: string, maxChars: number, maxBytes: number): void {
  if (containsControl(value))
    throw new BrowserMeshError('INVALID_ARGUMENT', `${field} must not contain control characters`);
  if (Array.from(value).length > maxChars || Buffer.byteLength(value, 'utf8') > maxBytes)
    throw new BrowserMeshError('LIMIT_EXCEEDED', `${field} exceeds its configured size limit`);
}

export function normalizeSessionLabels(
  input: {
    readonly name?: string | undefined;
    readonly metadata?: Readonly<Record<string, string>> | undefined;
  },
  limits: ResourceLimits['session'],
): { readonly name?: string; readonly metadata: Readonly<Record<string, string>> } {
  if (input.name !== undefined) {
    if (input.name.length === 0)
      throw new BrowserMeshError('INVALID_ARGUMENT', 'name must not be empty');
    validateText('name', input.name, limits.maxNameChars, limits.maxNameBytes);
  }
  const entries = Object.entries(input.metadata ?? {});
  if (entries.length > limits.maxMetadataEntries)
    throw new BrowserMeshError('LIMIT_EXCEEDED', 'metadata has too many entries');
  const metadata: Record<string, string> = Object.create(null) as Record<string, string>;
  let aggregateBytes = 0;
  for (const [key, value] of entries) {
    if (key.length === 0)
      throw new BrowserMeshError('INVALID_ARGUMENT', 'metadata keys must not be empty');
    if (dangerousKeys.has(key))
      throw new BrowserMeshError('INVALID_ARGUMENT', `metadata key '${key}' is not allowed`);
    validateText('metadata key', key, limits.maxMetadataKeyChars, limits.maxMetadataKeyBytes);
    validateText(
      'metadata value',
      value,
      limits.maxMetadataValueChars,
      limits.maxMetadataValueBytes,
    );
    aggregateBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (aggregateBytes > limits.maxMetadataBytes)
      throw new BrowserMeshError(
        'LIMIT_EXCEEDED',
        'metadata exceeds its configured aggregate size limit',
      );
    metadata[key] = value;
  }
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    metadata: Object.freeze(metadata),
  };
}

export interface TextTruncation {
  readonly truncated: boolean;
  readonly originalChars: number;
  readonly originalBytes: number;
  readonly returnedChars: number;
  readonly returnedBytes: number;
  readonly maxChars: number;
  readonly maxBytes: number;
}

export function boundUtf8Text(
  value: string,
  limits: ResourceLimits['visibleText'],
): { readonly text: string; readonly truncation: TextTruncation } {
  const characters = Array.from(value);
  const originalBytes = Buffer.byteLength(value, 'utf8');
  let returned = '';
  let returnedBytes = 0;
  for (const character of characters.slice(0, limits.maxChars)) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (returnedBytes + bytes > limits.maxBytes) break;
    returned += character;
    returnedBytes += bytes;
  }
  const returnedChars = Array.from(returned).length;
  return {
    text: returned,
    truncation: {
      truncated: returnedChars !== characters.length,
      originalChars: characters.length,
      originalBytes,
      returnedChars,
      returnedBytes,
      maxChars: limits.maxChars,
      maxBytes: limits.maxBytes,
    },
  };
}
