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
});
