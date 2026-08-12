import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface InstallerChildProcess {
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type InstallerSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: 'inherit' },
) => InstallerChildProcess;

interface InstallChromiumOptions {
  readonly nodeExecutable?: string;
  readonly playwrightPackageJsonUrl?: string;
  readonly spawnProcess?: InstallerSpawn;
}

const defaultSpawn: InstallerSpawn = (command, args, options) => spawn(command, [...args], options);

export async function installChromium(options: InstallChromiumOptions = {}): Promise<void> {
  const packageJsonPath = fileURLToPath(
    options.playwrightPackageJsonUrl ?? import.meta.resolve('playwright/package.json'),
  );
  const playwrightCliPath = join(dirname(packageJsonPath), 'cli.js');
  const child = (options.spawnProcess ?? defaultSpawn)(
    options.nodeExecutable ?? process.execPath,
    [playwrightCliPath, 'install', 'chromium'],
    { stdio: 'inherit' },
  );

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `Playwright browser installation exited with code ${String(code)}`
            : `Playwright browser installation was terminated by ${signal}`,
        ),
      );
    });
  });
}
