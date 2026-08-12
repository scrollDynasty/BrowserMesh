#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './adapters/mcp/server.js';
import { createRuntime } from './create-runtime.js';
import { loadConfig } from './infrastructure/config.js';
import { installChromium } from './install-browser.js';

if (process.argv.slice(2).includes('--install-browser')) {
  await installChromium();
} else {
  const runtime = createRuntime(loadConfig());
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
