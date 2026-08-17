import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface InstallerChildProcess {
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

/** How long a terminated installer is given to exit before it is killed outright. */
const TERMINATION_GRACE_MS = 5_000;

/**
 * Where the installer's own output goes.
 *
 * `inherit` is right for the explicit `--install-browser` command, where the
 * user is watching a terminal. It is wrong while serving MCP: stdout carries
 * the protocol, and a progress bar written there corrupts the session. The
 * `stderr` mode discards the child's stdout and keeps its diagnostics on the
 * stream BrowserMesh already logs to.
 */
export type InstallerOutput = 'inherit' | 'stderr';

export type InstallerSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: 'inherit' | readonly ['ignore', 'ignore', 'inherit'] },
) => InstallerChildProcess;

interface InstallChromiumOptions {
  readonly nodeExecutable?: string;
  readonly playwrightPackageJsonUrl?: string;
  readonly spawnProcess?: InstallerSpawn;
  readonly output?: InstallerOutput;
  /**
   * Give up after this long and terminate the installer.
   *
   * Only meaningful when something is waiting on the download. The explicit
   * `--install-browser` command leaves this unset: a user watching a terminal
   * can judge a slow network and interrupt it themselves, and cutting off a
   * download they are willing to wait for would be worse than the wait.
   */
  readonly timeoutMs?: number;
}

const defaultSpawn: InstallerSpawn = (command, args, options) =>
  spawn(command, [...args], {
    stdio: options.stdio === 'inherit' ? 'inherit' : [...options.stdio],
  });

export async function installChromium(options: InstallChromiumOptions = {}): Promise<void> {
  const packageJsonPath = fileURLToPath(
    options.playwrightPackageJsonUrl ?? import.meta.resolve('playwright/package.json'),
  );
  const playwrightCliPath = join(dirname(packageJsonPath), 'cli.js');
  const child = (options.spawnProcess ?? defaultSpawn)(
    options.nodeExecutable ?? process.execPath,
    [playwrightCliPath, 'install', 'chromium'],
    { stdio: options.output === 'stderr' ? (['ignore', 'ignore', 'inherit'] as const) : 'inherit' },
  );

  let deadline: NodeJS.Timeout | undefined;
  try {
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

      const timeoutMs = options.timeoutMs;
      if (timeoutMs === undefined) return;
      deadline = setTimeout(() => {
        // Ask first, then insist. The escalation is deliberately not cleared
        // when this promise rejects: the caller stops waiting immediately, but
        // the child still has to die. `unref` keeps that from holding the
        // process open, and signalling an already-exited child is a no-op. The
        // exit listener above stays attached, so whichever signal lands reaps
        // the child; the promise has settled by then and it becomes a no-op.
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), TERMINATION_GRACE_MS).unref();
        reject(
          new Error(
            `Playwright browser installation exceeded ${String(timeoutMs)}ms and was terminated`,
          ),
        );
      }, timeoutMs);
    });
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}
