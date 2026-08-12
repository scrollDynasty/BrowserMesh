import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SavedStateView,
  StateRepositoryPort,
} from '../../application/ports/state-repository.js';
import { BrowserMeshError } from '../../domain/errors.js';
import type { BrowserStorageState } from '../../domain/models.js';
import { z } from 'zod';

const storageStateSchema = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(['Strict', 'Lax', 'None']),
    }),
  ),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});

const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export class FileSystemStateRepository implements StateRepositoryPort {
  private readonly statesDirectory: string;

  constructor(dataDirectory: string) {
    this.statesDirectory = join(dataDirectory, 'states');
  }

  async save(stateId: string, state: BrowserStorageState): Promise<SavedStateView> {
    this.validateStateId(stateId);
    await mkdir(this.statesDirectory, { recursive: true, mode: 0o700 });
    const target = this.pathFor(stateId);
    const temporary = `${target}.${String(process.pid)}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return { stateId, createdAt: (await stat(target)).mtime.toISOString() };
  }

  async load(stateId: string): Promise<BrowserStorageState> {
    this.validateStateId(stateId);
    try {
      const content = await readFile(this.pathFor(stateId), 'utf8');
      return storageStateSchema.parse(JSON.parse(content));
    } catch (error) {
      if (this.isNotFound(error))
        throw new BrowserMeshError(
          'SAVED_STATE_NOT_FOUND',
          `Saved state '${stateId}' was not found`,
        );
      if (error instanceof SyntaxError || error instanceof z.ZodError)
        throw new BrowserMeshError('BROWSER_ERROR', `Saved state '${stateId}' is corrupted`, {
          cause: error,
        });
      throw error;
    }
  }

  async list(): Promise<readonly SavedStateView[]> {
    try {
      const entries = await readdir(this.statesDirectory, { withFileTypes: true });
      const states = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => ({
            stateId: entry.name.slice(0, -5),
            createdAt: (await stat(join(this.statesDirectory, entry.name))).mtime.toISOString(),
          })),
      );
      return states.sort((left, right) => left.stateId.localeCompare(right.stateId));
    } catch (error) {
      if (this.isNotFound(error)) return [];
      throw error;
    }
  }

  async remove(stateId: string): Promise<void> {
    this.validateStateId(stateId);
    try {
      await rm(this.pathFor(stateId));
    } catch (error) {
      if (this.isNotFound(error))
        throw new BrowserMeshError(
          'SAVED_STATE_NOT_FOUND',
          `Saved state '${stateId}' was not found`,
        );
      throw error;
    }
  }

  private pathFor(stateId: string): string {
    return join(this.statesDirectory, `${stateId}.json`);
  }

  private validateStateId(stateId: string): void {
    if (!safeName.test(stateId))
      throw new BrowserMeshError(
        'INVALID_ARGUMENT',
        'stateId must be 1-128 safe identifier characters',
      );
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}
