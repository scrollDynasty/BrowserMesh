import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agentGuidelines } from '../../src/adapters/mcp/agent-guidelines.js';
import { BROWSERMESH_VERSION } from '../../src/infrastructure/generated/version.js';

describe('stdio executable', () => {
  it('starts, negotiates MCP, discovers tools, and exits when the client closes', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'browsermesh-stdio-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        ...(process.env.DISPLAY === undefined ? {} : { DISPLAY: process.env.DISPLAY }),
        ...(process.env.XAUTHORITY === undefined ? {} : { XAUTHORITY: process.env.XAUTHORITY }),
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_DATA_DIR: dataDirectory,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toEqual({
        name: 'browsermesh',
        version: BROWSERMESH_VERSION,
      });
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(20);
      expect(tools.tools.some(({ name }) => name === 'browser_navigate')).toBe(true);
      expect(
        [
          'browser_double_click',
          'browser_hover',
          'browser_focus',
          'browser_check',
          'browser_uncheck',
          'browser_scroll_into_view',
          'browser_scroll',
          'browser_drag_and_drop',
        ].every((name) => tools.tools.some((tool) => tool.name === name)),
      ).toBe(true);
      const runtimeInfo = await client.callTool({ name: 'browser_runtime_info', arguments: {} });
      expect(runtimeInfo.isError).not.toBe(true);
      expect(JSON.stringify(runtimeInfo.content)).toContain('not_started');
      expect(JSON.stringify(runtimeInfo.content)).toContain(BROWSERMESH_VERSION);
      expect(tools.tools.every(({ description }) => (description?.length ?? 0) > 40)).toBe(true);
      expect(
        tools.tools.every(
          ({ title, outputSchema }) => title !== undefined && outputSchema?.type === 'object',
        ),
      ).toBe(true);

      const first = readCreated(
        await client.callTool({ name: 'browser_session_create', arguments: { name: 'first' } }),
      );
      const second = readCreated(
        await client.callTool({ name: 'browser_session_create', arguments: { name: 'second' } }),
      );
      const url = await client.callTool({
        name: 'browser_get_url',
        arguments: { sessionId: first.sessionId, pageId: first.pageId },
      });
      expect(url.isError).not.toBe(true);
      expect(url.structuredContent).toMatchObject({ url: 'about:blank' });
      const cancellation = new AbortController();
      const waiting = client.callTool(
        {
          name: 'browser_wait',
          arguments: {
            sessionId: first.sessionId,
            pageId: first.pageId,
            timeoutMs: 5_000,
            condition: { kind: 'text', text: 'will-never-appear', state: 'present' },
          },
        },
        undefined,
        { signal: cancellation.signal },
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      cancellation.abort();
      let cancellationError: unknown;
      try {
        await waiting;
      } catch (error) {
        cancellationError = error;
      }
      expect(cancellationError).toBeInstanceOf(Error);
      expect((cancellationError as Error).name).toBe('McpError');
      expect((cancellationError as Error).message).toContain('AbortError');
      await expect(
        client.callTool({
          name: 'browser_get_url',
          arguments: { sessionId: first.sessionId, pageId: first.pageId },
        }),
      ).resolves.toMatchObject({ structuredContent: { url: 'about:blank' } });
      const crossSession = await client.callTool({
        name: 'browser_get_url',
        arguments: { sessionId: first.sessionId, pageId: second.pageId },
      });
      expect(crossSession.isError).toBe(true);
      expect(JSON.stringify(crossSession.content)).toContain('PAGE_NOT_FOUND');
      expect(JSON.stringify(crossSession.content)).toContain('operationId');
      const invalid = await client.callTool({ name: 'browser_get_url', arguments: {} });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.content)).toContain('Input validation error');
    } finally {
      await client.close();
      await transport.close();
      await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    // Starts the CLI as a subprocess, which compiles the project through tsx
    // before the protocol handshake begins. The default 15s covers the run but
    // not the compilation when the integration files execute in parallel.
  }, 60_000);

  // With auto-install disabled — the configuration for an air-gapped or
  // pre-provisioned host — a missing browser must still leave the protocol
  // usable and say what to do about it, rather than failing to start.
  it('keeps MCP available and reports actionable setup when Chromium is missing', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'browsermesh-no-browser-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts'],
      cwd: process.cwd(),
      env: {
        BROWSERMESH_LOG_LEVEL: 'silent',
        BROWSERMESH_PERSISTENCE: 'false',
        BROWSERMESH_HEADLESS: 'true',
        BROWSERMESH_DATA_DIR: join(temporaryRoot, 'data'),
        BROWSERMESH_AUTO_INSTALL: 'false',
        PLAYWRIGHT_BROWSERS_PATH: join(temporaryRoot, 'browsers'),
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-missing-browser-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some(({ name }) => name === 'browser_session_create')).toBe(true);

      const creation = await client.callTool({
        name: 'browser_session_create',
        arguments: { name: 'missing-browser' },
      });
      expect(creation.isError).toBe(true);
      expect(JSON.stringify(creation.content)).toContain('BROWSER_ERROR');
      expect(JSON.stringify(creation.content)).toContain('npx -y browsermesh --install-browser');
      const runtimeInfo = await client.callTool({ name: 'browser_runtime_info', arguments: {} });
      expect(runtimeInfo.structuredContent).toMatchObject({
        browserLaunchState: 'failed',
        browserVersion: null,
        failedSessions: 1,
      });
    } finally {
      await client.close();
      await transport.close();
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    // Starts the CLI as a subprocess, which compiles the project through tsx
    // before the protocol handshake begins. The default 15s covers the run but
    // not the compilation when the integration files execute in parallel.
  }, 60_000);

  // The wiring from BROWSERMESH_AGENT_GUIDELINES through loadConfig into
  // createMcpServer is only exercised end to end here. Asserting it against
  // createMcpServer directly, or against loadConfig alone, leaves a suite that
  // stays green when the cli.ts line is deleted and the documented opt-out
  // silently stops working for every real user.
  it('honours the instruction opt-outs through the real CLI', async () => {
    expect(await instructionsFromCli({})).toBe(agentGuidelines());
    expect(await instructionsFromCli({ BROWSERMESH_SUPPORT_REQUEST: 'false' })).toBe(
      agentGuidelines({ supportRequest: false }),
    );
    expect(await instructionsFromCli({ BROWSERMESH_AGENT_GUIDELINES: 'false' })).toBeUndefined();
  }, 60_000);
});

const createdSchema = z.object({
  initialPage: z.object({ sessionId: z.string(), pageId: z.string() }),
});

function readCreated(result: unknown): z.infer<typeof createdSchema>['initialPage'] {
  const parsed = z.object({ structuredContent: z.unknown() }).parse(result);
  return createdSchema.parse(parsed.structuredContent).initialPage;
}

/**
 * Start the CLI with the given overrides layered on the standard test
 * environment and return the instructions the server sent on connect.
 */
async function instructionsFromCli(overrides: Record<string, string>): Promise<string | undefined> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'browsermesh-instructions-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/cli.ts'],
    cwd: process.cwd(),
    env: {
      BROWSERMESH_LOG_LEVEL: 'silent',
      BROWSERMESH_PERSISTENCE: 'false',
      BROWSERMESH_HEADLESS: 'true',
      BROWSERMESH_AUTO_INSTALL: 'false',
      BROWSERMESH_DATA_DIR: dataDirectory,
      ...overrides,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'instructions-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    return client.getInstructions();
  } finally {
    await client.close();
    await transport.close();
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
