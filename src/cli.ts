#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FileSystemDataDirectoryProbe } from './adapters/diagnostics/data-directory-probe.js';
import { createMcpServer } from './adapters/mcp/server.js';
import { selectedTools } from './adapters/mcp/tool-profiles.js';
import { PlaywrightBrowserEngine } from './adapters/playwright/playwright-browser-engine.js';
import { runDoctor, type DoctorResult } from './application/doctor.js';
import { BrowserMeshError } from './domain/errors.js';
import { createRuntime } from './create-runtime.js';
import { parseArguments, usageSummary, usageText } from './infrastructure/cli-arguments.js';
import {
  loadConfigWithOverrides,
  ConfigurationError,
  type BrowserMeshConfig,
} from './infrastructure/config.js';
import { installFatalProcessHandlers } from './infrastructure/fatal-process-handlers.js';
import { BROWSERMESH_VERSION } from './infrastructure/generated/version.js';
import { installChromium } from './install-browser.js';

await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<void> {
  const command = parseArguments(argv);
  if (command.kind === 'help') {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  if (command.kind === 'version') {
    process.stdout.write(`${BROWSERMESH_VERSION}\n`);
    return;
  }
  if (command.kind === 'usage-error') {
    process.stderr.write(
      `${command.message}\n\n${usageSummary()}\n\nRun 'browsermesh --help' for the full option list.\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (command.kind === 'install-browser') {
    await installChromium();
    return;
  }

  const config = configure(command.overrides);
  if (config === undefined) return;

  if (command.kind === 'doctor') {
    const result = await doctor(config);
    process.stdout.write(command.json ? `${JSON.stringify(result)}\n` : `${report(result)}\n`);
    if (result.status === 'failed') process.exitCode = 1;
    return;
  }
  await serveMcp(config);
}

/**
 * Resolve configuration, reporting a rejected value as one readable line.
 *
 * This runs before the fatal-process handlers are installed, so an unhandled
 * throw here would reach the terminal as a raw stack trace naming absolute
 * paths — the exact diagnostic leak the rest of the runtime is careful to
 * avoid. Returning `undefined` signals that the exit code is already set.
 */
function configure(overrides: Readonly<Record<string, string>>): BrowserMeshConfig | undefined {
  try {
    const config = loadConfigWithOverrides(overrides);
    // The profile names are validated by the MCP adapter that owns them, but
    // they have to be rejected here, with everything else the operator got
    // wrong. Left until `createMcpServer`, an unknown profile would surface as
    // an unhandled throw after this function's guard has already passed.
    selectedTools(config.tools);
    return config;
  } catch (error) {
    if (!(error instanceof ConfigurationError) && !(error instanceof BrowserMeshError)) throw error;
    process.stderr.write(`${error.message}\nRun 'browsermesh --help' for usage.\n`);
    process.exitCode = 2;
    return undefined;
  }
}

function report(result: DoctorResult): string {
  const lines = result.checks.map((check) => {
    const mark = check.status === 'passed' ? 'ok  ' : 'FAIL';
    const remediation = check.remediation === null ? '' : `\n       ${check.remediation}`;
    return `  ${mark} ${check.id.padEnd(24)} ${check.message}${remediation}`;
  });
  return [`BrowserMesh ${BROWSERMESH_VERSION}`, ...lines, '', `Result: ${result.status}`].join(
    '\n',
  );
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

/**
 * Download Chromium if this installation has never had it.
 *
 * A first run that fails on a missing browser is the most common way an MCP
 * server is abandoned, so the download happens here rather than being left to
 * the user. It runs before the transport is connected because the installer is
 * a child process whose output must not reach stdout, where the protocol lives.
 * `--no-auto-install` restores the previous behaviour: discovery stays
 * available and the first session create returns an actionable BROWSER_ERROR.
 */
async function ensureBrowser(config: BrowserMeshConfig): Promise<void> {
  if (!config.autoInstall) return;
  const engine = new PlaywrightBrowserEngine({
    headless: config.headless,
    timeoutMs: config.defaultTimeoutMs,
  });
  if (await engine.isExecutableAvailable()) return;
  process.stderr.write('BrowserMesh: Chromium is not installed yet; downloading it once.\n');
  try {
    await installChromium({ output: 'stderr' });
    process.stderr.write('BrowserMesh: Chromium is ready.\n');
  } catch {
    // A failed download must not stop the server: discovery still works, and
    // browser_session_create reports the failure with its remediation.
    process.stderr.write(
      'BrowserMesh: Chromium download failed. Run: npx -y browsermesh --install-browser\n',
    );
  }
}

async function serveMcp(config: BrowserMeshConfig): Promise<void> {
  await ensureBrowser(config);

  const runtime = createRuntime(config);
  const server = createMcpServer(runtime, {
    toolSchemas: { shareRepeatedSubschemas: config.schemaReferences },
    tools: config.tools,
  });
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

  installFatalProcessHandlers({ shutdown });

  // Browser startup is intentionally lazy. MCP discovery and error reporting must remain
  // available even when the Playwright-managed Chromium binary has not been installed yet.
  await server.connect(new StdioServerTransport());
}
