import { mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  SavedStateView,
  StateRepositoryPort,
} from '../../application/ports/state-repository.js';
import { BrowserMeshError } from '../../domain/errors.js';
import type { BrowserStorageState } from '../../domain/models.js';
import { z } from 'zod';
import { DEFAULT_RESOURCE_LIMITS, type ResourceLimits } from '../../domain/resource-limits.js';

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
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    dataDirectory: string,
    private readonly limits: ResourceLimits['persistence'] = DEFAULT_RESOURCE_LIMITS.persistence,
  ) {
    this.statesDirectory = join(dataDirectory, 'states');
  }

  async save(stateId: string, state: BrowserStorageState): Promise<SavedStateView> {
    this.validateStateId(stateId);
    const serialized = JSON.stringify(state);
    const serializedBytes = Buffer.byteLength(serialized, 'utf8');
    if (serializedBytes > this.limits.maxStateBytes)
      throw new BrowserMeshError('LIMIT_EXCEEDED', 'Saved state exceeds the per-state byte limit');
    return this.enqueueMutation(async () => {
      await mkdir(this.statesDirectory, { recursive: true, mode: 0o700 });
      const target = this.pathFor(stateId);
      const existing = await this.inspectStates();
      if (existing.size > this.limits.maxStates)
        throw new BrowserMeshError(
          'LIMIT_EXCEEDED',
          'Saved-state count exceeds the configured limit',
        );
      const replacedBytes = existing.get(stateId) ?? 0;
      if (!existing.has(stateId) && existing.size >= this.limits.maxStates)
        throw new BrowserMeshError('LIMIT_EXCEEDED', 'Saved-state count limit reached');
      const aggregateBytes =
        Array.from(existing.values()).reduce((sum, bytes) => sum + bytes, 0) -
        replacedBytes +
        serializedBytes;
      if (aggregateBytes > this.limits.maxTotalBytes)
        throw new BrowserMeshError('LIMIT_EXCEEDED', 'Saved-state aggregate byte limit exceeded');
      const temporary = `${target}.${String(process.pid)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      return { stateId, createdAt: (await stat(target)).mtime.toISOString() };
    });
  }

  async load(stateId: string): Promise<BrowserStorageState> {
    this.validateStateId(stateId);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.pathFor(stateId), 'r');
      const details = await handle.stat();
      if (!details.isFile() || details.size > this.limits.maxStateBytes)
        throw new BrowserMeshError('LIMIT_EXCEEDED', 'Saved state exceeds the readable byte limit');
      const buffer = Buffer.alloc(details.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > this.limits.maxStateBytes)
        throw new BrowserMeshError('LIMIT_EXCEEDED', 'Saved state exceeds the readable byte limit');
      const content = buffer.subarray(0, bytesRead).toString('utf8');
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
    } finally {
      await handle?.close();
    }
  }

  async list(): Promise<readonly SavedStateView[]> {
    try {
      const entries = await readdir(this.statesDirectory, { withFileTypes: true });
      const candidates = entries.filter((entry) => {
        if (!entry.isFile() || !entry.name.endsWith('.json')) return false;
        return safeName.test(entry.name.slice(0, -5));
      });
      if (candidates.length > this.limits.maxStates)
        throw new BrowserMeshError(
          'LIMIT_EXCEEDED',
          'Saved-state count exceeds the configured limit',
        );
      const states = await Promise.all(
        candidates.map(async (entry) => ({
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
    await this.enqueueMutation(async () => {
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
    });
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

  private async inspectStates(): Promise<Map<string, number>> {
    const entries = await readdir(this.statesDirectory, { withFileTypes: true });
    const states = new Map<string, number>();
    for (const entry of entries) {
      const stateId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || !safeName.test(stateId)) continue;
      const details = await stat(join(this.statesDirectory, entry.name));
      states.set(stateId, details.size);
    }
    return states;
  }

  private enqueueMutation<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(action, action);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.mutationTail = tail;
    return result.finally(() => {
      // The recovery tail intentionally remains resolved/rejected-neutral for the next mutation.
    });
  }
}
