import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemStateRepository } from '../../src/adapters/persistence/filesystem-state-repository.js';

describe('FileSystemStateRepository', () => {
  it('round trips state and rejects traversal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browsermesh-'));
    try {
      const repository = new FileSystemStateRepository(directory);
      const state = { cookies: [], origins: [] };
      const alternateState = {
        cookies: [],
        origins: [
          { origin: 'https://example.test', localStorage: [{ name: 'role', value: 'buyer' }] },
        ],
      };
      await Promise.all([
        repository.save('buyer', state),
        repository.save('buyer', alternateState),
      ]);
      await repository.save('admin', state);
      expect([state, alternateState]).toContainEqual(await repository.load('buyer'));
      await expect(repository.list()).resolves.toMatchObject([
        { stateId: 'admin' },
        { stateId: 'buyer' },
      ]);
      expect((await readdir(join(directory, 'states'))).sort()).toEqual([
        'admin.json',
        'buyer.json',
      ]);
      await expect(repository.save('../escape', state)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      const failedRemoval = repository.remove('recover-after-failure');
      const recoveredSave = repository.save('recover-after-failure', state);
      await expect(failedRemoval).rejects.toMatchObject({ code: 'SAVED_STATE_NOT_FOUND' });
      await recoveredSave;
      await expect(repository.load('recover-after-failure')).resolves.toEqual(state);
      await repository.remove('buyer');
      await expect(repository.load('buyer')).rejects.toMatchObject({
        code: 'SAVED_STATE_NOT_FOUND',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports corrupted files as structured errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browsermesh-'));
    try {
      const repository = new FileSystemStateRepository(directory);
      await repository.save('broken', { cookies: [], origins: [] });
      await writeFile(join(directory, 'states', 'broken.json'), '{broken', 'utf8');
      await expect(repository.load('broken')).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('enforces count, per-state, and aggregate quotas atomically and recovers after failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browsermesh-'));
    try {
      const repository = new FileSystemStateRepository(directory, {
        maxStates: 2,
        maxStateBytes: 300,
        maxTotalBytes: 600,
      });
      const state = (value: string) => ({
        cookies: [],
        origins: [{ origin: 'https://example.test', localStorage: [{ name: 'value', value }] }],
      });
      const first = await Promise.allSettled([
        repository.save('one', state('a'.repeat(100))),
        repository.save('two', state('b'.repeat(100))),
        repository.save('three', state('c'.repeat(100))),
      ]);
      expect(first.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
      expect(first.filter(({ status }) => status === 'rejected')).toMatchObject([
        { reason: { code: 'LIMIT_EXCEEDED' } },
      ]);
      await expect(repository.save('one', state('x'.repeat(1_000)))).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
      expect((await repository.load('one')).origins[0]?.localStorage[0]?.value).toBe(
        'a'.repeat(100),
      );
      await repository.remove('two');
      await expect(repository.save('three', state('ok'))).resolves.toMatchObject({
        stateId: 'three',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bounds an existing file before reading or parsing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browsermesh-'));
    try {
      const repository = new FileSystemStateRepository(directory, {
        maxStates: 10,
        maxStateBytes: 64,
        maxTotalBytes: 1_024,
      });
      await repository.save('small', { cookies: [], origins: [] });
      await writeFile(join(directory, 'states', 'small.json'), 'x'.repeat(65), 'utf8');
      await expect(repository.load('small')).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
