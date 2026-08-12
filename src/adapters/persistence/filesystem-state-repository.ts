import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedStateView, StateRepositoryPort } from '../../application/ports/state-repository.js';
import { BrowserMeshError } from '../../domain/errors.js';
import type { JsonValue } from '../../domain/models.js';

const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export class FileSystemStateRepository implements StateRepositoryPort {
  private readonly statesDirectory: string;

  constructor(dataDirectory: string) {
    this.statesDirectory = join(dataDirectory, 'states');
  }

  async save(name: string, state: JsonValue): Promise<SavedStateView> {
    this.validateName(name);
    await mkdir(this.statesDirectory, { recursive: true, mode: 0o700 });
    const target = this.pathFor(name);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return { name, createdAt: (await stat(target)).mtime.toISOString() };
  }

  async load(name: string): Promise<JsonValue> {
    this.validateName(name);
    try {
      const content = await readFile(this.pathFor(name), 'utf8');
      return JSON.parse(content) as JsonValue;
    } catch (error) {
      if (this.isNotFound(error)) throw new BrowserMeshError('SAVED_STATE_NOT_FOUND', `Saved state '${name}' was not found`);
      if (error instanceof SyntaxError) throw new BrowserMeshError('BROWSER_ERROR', `Saved state '${name}' is corrupted`, { cause: error });
      throw error;
    }
  }

  async list(): Promise<readonly SavedStateView[]> {
    try {
      const entries = await readdir(this.statesDirectory, { withFileTypes: true });
      const states = await Promise.all(
        entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => ({
          name: entry.name.slice(0, -5),
          createdAt: (await stat(join(this.statesDirectory, entry.name))).mtime.toISOString(),
        })),
      );
      return states.sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (this.isNotFound(error)) return [];
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    this.validateName(name);
    try {
      await rm(this.pathFor(name));
    } catch (error) {
      if (this.isNotFound(error)) throw new BrowserMeshError('SAVED_STATE_NOT_FOUND', `Saved state '${name}' was not found`);
      throw error;
    }
  }

  private pathFor(name: string): string {
    return join(this.statesDirectory, `${name}.json`);
  }

  private validateName(name: string): void {
    if (!safeName.test(name)) throw new BrowserMeshError('INVALID_ARGUMENT', 'State name must be 1-128 safe filename characters');
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}
