import { constants } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DataDirectoryProbePort } from '../../application/ports/data-directory.js';

export class FileSystemDataDirectoryProbe implements DataDirectoryProbePort {
  constructor(private readonly dataDirectory: string) {}

  async probe(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    await access(this.dataDirectory, constants.R_OK | constants.W_OK);
    const probePath = join(this.dataDirectory, `.doctor-${randomUUID()}.tmp`);
    const sentinel = randomUUID();
    try {
      await writeFile(probePath, sentinel, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      if ((await readFile(probePath, 'utf8')) !== sentinel) {
        throw new Error('Diagnostic data did not round-trip');
      }
    } finally {
      await rm(probePath, { force: true });
    }
  }
}
