import { describe, expect, it } from 'vitest';
import { BrowserMeshError } from '../../src/domain/errors.js';
import { boundSnapshot, normalizeSnapshotOptions } from '../../src/domain/snapshots.js';

describe('bounded snapshots', () => {
  it('bounds Unicode content independently by characters and UTF-8 bytes', () => {
    const byCharacters = boundSnapshot(
      'a😀bc',
      normalizeSnapshotOptions({ maxChars: 2, maxBytes: 100 }),
    );
    expect(byCharacters).toMatchObject({
      snapshot: 'a😀',
      contentFormat: 'aria-yaml-fragment',
      partial: true,
      truncation: {
        truncated: true,
        byMaxChars: true,
        byMaxBytes: false,
        originalChars: 4,
        originalBytes: 7,
        returnedChars: 2,
        returnedBytes: 5,
      },
    });

    const byBytes = boundSnapshot(
      'a😀bc',
      normalizeSnapshotOptions({ maxChars: 100, maxBytes: 4 }),
    );
    expect(byBytes).toMatchObject({
      snapshot: 'a',
      partial: true,
      truncation: { byMaxChars: false, byMaxBytes: true, returnedBytes: 1 },
    });
    expect(Buffer.byteLength(byBytes.snapshot, 'utf8')).toBeLessThanOrEqual(4);
  });

  it('returns complete YAML only when neither response bound is exceeded', () => {
    const result = boundSnapshot('- document', normalizeSnapshotOptions({}));
    expect(result).toMatchObject({
      snapshot: '- document',
      contentFormat: 'aria-yaml',
      partial: false,
      truncation: { truncated: false },
    });
  });

  it.each([
    [{ maxDepth: -1 }, 'maxDepth'],
    [{ maxDepth: 101 }, 'maxDepth'],
    [{ maxChars: 0 }, 'maxChars'],
    [{ maxChars: 100_001 }, 'maxChars'],
    [{ maxBytes: 0 }, 'maxBytes'],
    [{ maxBytes: 131_073 }, 'maxBytes'],
    [{ maxChars: 1.5 }, 'maxChars'],
    [{ includeRefs: true, maxRefs: 101 }, 'maxRefs'],
    [{ maxRefs: 1 }, 'maxRefs'],
  ])('rejects invalid bounds %#', (options, name) => {
    expect(() => normalizeSnapshotOptions(options)).toThrow(
      expect.objectContaining<Partial<BrowserMeshError>>({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => normalizeSnapshotOptions(options)).toThrow(name);
  });
});
