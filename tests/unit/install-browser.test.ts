import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installChromium, type InstallerSpawn } from '../../src/install-browser.js';

describe('Chromium installer command', () => {
  it('uses the CLI belonging to the exactly pinned Playwright dependency', async () => {
    const child = new EventEmitter();
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
    const child = new EventEmitter();
    const spawnProcess = vi.fn<InstallerSpawn>(() => child);

    const installation = installChromium({ spawnProcess, output: 'stderr' });
    child.emit('exit', 0, null);
    await installation;

    expect(spawnProcess.mock.calls[0]?.[2]).toEqual({ stdio: ['ignore', 'ignore', 'inherit'] });
  });

  it('rejects failed and interrupted Playwright installations', async () => {
    const failedChild = new EventEmitter();
    const failed = installChromium({ spawnProcess: () => failedChild });
    failedChild.emit('exit', 7, null);
    await expect(failed).rejects.toThrow('exited with code 7');

    const interruptedChild = new EventEmitter();
    const interrupted = installChromium({ spawnProcess: () => interruptedChild });
    interruptedChild.emit('exit', null, 'SIGTERM');
    await expect(interrupted).rejects.toThrow('terminated by SIGTERM');
  });

  it('propagates process spawn errors', async () => {
    const child = new EventEmitter();
    const installation = installChromium({ spawnProcess: () => child });
    child.emit('error', new Error('spawn failed'));
    await expect(installation).rejects.toThrow('spawn failed');
  });
});
