import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installChromium, type InstallerSpawn } from '../../src/install-browser.js';

/** An installer child that records the signals it was sent instead of dying. */
function installerChild(): EventEmitter & {
  signals: NodeJS.Signals[];
  kill(s?: NodeJS.Signals): boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    signals: NodeJS.Signals[];
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.signals = [];
  child.kill = (signal?: NodeJS.Signals): boolean => {
    child.signals.push(signal ?? 'SIGTERM');
    return true;
  };
  return child;
}

describe('Chromium installer command', () => {
  it('uses the CLI belonging to the exactly pinned Playwright dependency', async () => {
    const child = installerChild();
    const spawnProcess = vi.fn<InstallerSpawn>(() => child);
    const packageJsonPath = join(process.cwd(), 'node_modules', 'playwright', 'package.json');

    const installation = installChromium({
      nodeExecutable: '/node',
      playwrightPackageJsonUrl: pathToFileURL(packageJsonPath).href,
      spawnProcess,
    });
    child.emit('exit', 0, null);
    await installation;

    expect(spawnProcess).toHaveBeenCalledWith(
      '/node',
      [join(process.cwd(), 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'],
      { stdio: 'inherit' },
    );
  });

  it('keeps installer output away from the stream the MCP protocol owns', async () => {
    // The automatic install runs inside the `browsermesh` process while it is
    // about to serve MCP over stdio. A Playwright progress bar written to
    // stdout would be parsed as protocol traffic and break the session, so the
    // child gets no stdout at all and reports on stderr instead.
    const child = installerChild();
    const spawnProcess = vi.fn<InstallerSpawn>(() => child);

    const installation = installChromium({ spawnProcess, output: 'stderr' });
    child.emit('exit', 0, null);
    await installation;

    expect(spawnProcess.mock.calls[0]?.[2]).toEqual({ stdio: ['ignore', 'ignore', 'inherit'] });
  });

  it('terminates an installer that outlives its deadline', async () => {
    // The automatic install runs before the transport is connected. Without a
    // deadline a stalled download leaves the server permanently short of
    // `server.connect`, so the client sees a server that never starts rather
    // than one that reports a missing browser.
    vi.useFakeTimers();
    try {
      const child = installerChild();
      const installation = installChromium({ spawnProcess: () => child, timeoutMs: 1_000 });
      const settled = expect(installation).rejects.toThrow('exceeded 1000ms');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.signals).toEqual(['SIGTERM']);

      // A child that ignores SIGTERM is killed outright rather than left behind.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not escalate when the installer exits within its deadline', async () => {
    vi.useFakeTimers();
    try {
      const child = installerChild();
      const installation = installChromium({ spawnProcess: () => child, timeoutMs: 1_000 });
      child.emit('exit', 0, null);
      await installation;

      // The pending deadline must be cleared, or a completed install would go
      // on to signal an unrelated process that inherited the same handle.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(child.signals).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an explicitly requested installation unbounded', async () => {
    vi.useFakeTimers();
    try {
      const child = installerChild();
      const installation = installChromium({ spawnProcess: () => child });

      // `--install-browser` is run by a user watching a terminal, who can judge
      // a slow network themselves; cutting off a download they are willing to
      // wait for would be worse than the wait.
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(child.signals).toEqual([]);
      child.emit('exit', 0, null);
      await installation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects failed and interrupted Playwright installations', async () => {
    const failedChild = installerChild();
    const failed = installChromium({ spawnProcess: () => failedChild });
    failedChild.emit('exit', 7, null);
    await expect(failed).rejects.toThrow('exited with code 7');

    const interruptedChild = installerChild();
    const interrupted = installChromium({ spawnProcess: () => interruptedChild });
    interruptedChild.emit('exit', null, 'SIGTERM');
    await expect(interrupted).rejects.toThrow('terminated by SIGTERM');
  });

  it('propagates process spawn errors', async () => {
    const child = installerChild();
    const installation = installChromium({ spawnProcess: () => child });
    child.emit('error', new Error('spawn failed'));
    await expect(installation).rejects.toThrow('spawn failed');
  });
});
