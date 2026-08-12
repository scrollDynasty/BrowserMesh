#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './adapters/mcp/server.js';
import { createRuntime } from './create-runtime.js';
import { loadConfig } from './infrastructure/config.js';

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

await runtime.start();
await server.connect(new StdioServerTransport());
