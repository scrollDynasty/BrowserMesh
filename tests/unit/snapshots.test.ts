import { describe, expect, it } from 'vitest';
import { BrowserMeshError } from '../../src/domain/errors.js';
import { parse } from 'yaml';
import {
  boundSnapshot,
  normalizeSnapshotOptions,
  pageSnapshot,
  prepareSnapshot,
} from '../../src/domain/snapshots.js';

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

  it('rejects a byte page that cannot advance over its next Unicode code point', () => {
    expect(() =>
      pageSnapshot(
        prepareSnapshot('😀next', normalizeSnapshotOptions({ maxChars: 10, maxBytes: 1 })),
        0,
        'snapshot_1',
        new Date(0).toISOString(),
      ),
    ).toThrow(
      expect.objectContaining<Partial<BrowserMeshError>>({
        code: 'INVALID_ARGUMENT',
        message: 'maxBytes is too small to return the next Unicode code point',
      }),
    );
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
    [{ maxChildren: 0 }, 'maxChildren'],
    [{ maxChildren: 1_001 }, 'maxChildren'],
  ])('rejects invalid bounds %#', (options, name) => {
    expect(() => normalizeSnapshotOptions(options)).toThrow(
      expect.objectContaining<Partial<BrowserMeshError>>({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => normalizeSnapshotOptions(options)).toThrow(name);
  });

  it('retains interactive nodes with ancestor context and limits every node after filtering', () => {
    const prepared = prepareSnapshot(
      [
        '- document:',
        '  - heading "Ignored" [level=1]',
        '  - navigation:',
        '    - link "First"',
        '    - paragraph: ignored text',
        '    - button "Second"',
        '    - link "Omitted by maxChildren"',
      ].join('\n'),
      normalizeSnapshotOptions({ interactiveOnly: true, maxChildren: 2 }),
    );
    expect(parse(prepared.content)).toEqual([
      { document: [{ navigation: ['link "First"', 'button "Second"'] }] },
    ]);
    expect(prepared.omissions).toEqual({
      nonInteractiveNodes: 3,
      maxChildrenNodes: 1,
      sourceLimitReached: false,
    });
    expect(prepared.appliedBounds).toMatchObject({ interactiveOnly: true, maxChildren: 2 });
  });

  it('requires cursor to be exclusive with capture controls', () => {
    expect(() =>
      normalizeSnapshotOptions({ cursor: 'snapshot_1.10', interactiveOnly: true }),
    ).toThrow(expect.objectContaining<Partial<BrowserMeshError>>({ code: 'INVALID_ARGUMENT' }));
  });

  it('maps invalid engine YAML to a safe browser error', () => {
    expect(() =>
      prepareSnapshot(': invalid: [', normalizeSnapshotOptions({ interactiveOnly: true })),
    ).toThrow(
      expect.objectContaining<Partial<BrowserMeshError>>({
        code: 'BROWSER_ERROR',
        message: 'Browser returned invalid ARIA snapshot YAML',
      }),
    );
  });

  it('rejects an offset outside the retained immutable snapshot', () => {
    const prepared = prepareSnapshot('- document', normalizeSnapshotOptions({}));
    expect(() => pageSnapshot(prepared, 99, 'snapshot_1', new Date(0).toISOString())).toThrow(
      expect.objectContaining<Partial<BrowserMeshError>>({ code: 'STALE_SNAPSHOT_CURSOR' }),
    );
  });

  it('clips oversized retained sources and reports the omission explicitly', () => {
    const prepared = prepareSnapshot('x'.repeat(1_000_001), normalizeSnapshotOptions({}));
    expect(Array.from(prepared.content)).toHaveLength(1_000_000);
    expect(prepared.omissions.sourceLimitReached).toBe(true);
  });
});
