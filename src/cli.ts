#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FileSystemDataDirectoryProbe } from './adapters/diagnostics/data-directory-probe.js';
import { createMcpServer } from './adapters/mcp/server.js';
import { PlaywrightBrowserEngine } from './adapters/playwright/playwright-browser-engine.js';
import { runDoctor, type DoctorResult } from './application/doctor.js';
import { createRuntime } from './create-runtime.js';
import { loadConfig, type BrowserMeshConfig } from './infrastructure/config.js';
import { BROWSERMESH_VERSION } from './infrastructure/generated/version.js';
import { installChromium } from './install-browser.js';

const USAGE = 'Usage: browsermesh [--install-browser | --doctor --json]';
const args = process.argv.slice(2);

if (args.length === 0) {
  await serveMcp(loadConfig());
} else if (args.length === 1 && args[0] === '--install-browser') {
  await installChromium();
} else if (args.length === 2 && args[0] === '--doctor' && args[1] === '--json') {
  const result = await doctor(loadConfig());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === 'failed') process.exitCode = 1;
} else {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 2;
}

async function doctor(config: BrowserMeshConfig): Promise<DoctorResult> {
  const runtime = createRuntime(config);
  const runtimeVersion = runtime.runtimeInfo().serverVersion;
  await runtime.shutdown();
  return runDoctor({
    engine: new PlaywrightBrowserEngine({
      headless: config.headless,
      timeoutMs: config.defaultTimeoutMs,
    }),
    dataDirectory: new FileSystemDataDirectoryProbe(config.dataDirectory),
    nodeVersion: process.versions.node,
    minimumNodeMajor: 22,
    packageVersion: BROWSERMESH_VERSION,
    runtimeVersion,
    operationTimeoutMs: config.defaultTimeoutMs,
    overallTimeoutMs: Math.min(300_000, Math.max(15_000, config.defaultTimeoutMs * 3)),
  });
}

async function serveMcp(config: BrowserMeshConfig): Promise<void> {
  const runtime = createRuntime(config);
  const server = createMcpServer(runtime);
  let stopping = false;

  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await server.close();
    await runtime.shutdown();
  }

  server.server.onclose = () => {
    void shutdown().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().then(
        () => process.exit(0),
        (error: unknown) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exit(1);
        },
      );
    });
  }

  process.once('uncaughtException', (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    void shutdown().finally(() => process.exit(1));
  });
  process.once('unhandledRejection', (reason) => {
    process.stderr.write(
      `${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
    );
    void shutdown().finally(() => process.exit(1));
  });

  // Browser startup is intentionally lazy. MCP discovery and error reporting must remain
  // available even when the Playwright-managed Chromium binary has not been installed yet.
  await server.connect(new StdioServerTransport());
}
