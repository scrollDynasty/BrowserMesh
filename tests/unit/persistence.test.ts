import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemStateRepository } from '../../src/adapters/persistence/filesystem-state-repository.js';

describe('FileSystemStateRepository', () => {
  it('round trips state and rejects traversal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browsermesh-'));
    const repository = new FileSystemStateRepository(directory);
    const state = { cookies: [], origins: [] };
    await repository.save('buyer', state);
    await expect(repository.load('buyer')).resolves.toEqual(state);
    await expect(repository.save('../escape', state)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await repository.remove('buyer');
    await expect(repository.load('buyer')).rejects.toMatchObject({ code: 'SAVED_STATE_NOT_FOUND' });
  });

  it('reports corrupted files as structured errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browsermesh-'));
    const repository = new FileSystemStateRepository(directory);
    await repository.save('broken', { cookies: [], origins: [] });
    await writeFile(join(directory, 'states', 'broken.json'), '{broken', 'utf8');
    await expect(repository.load('broken')).rejects.toMatchObject({ code: 'BROWSER_ERROR' });
  });
});
