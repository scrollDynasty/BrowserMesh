import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  outputSchemas,
  toolPresentation,
  type ToolName,
} from '../../src/adapters/mcp/contracts.js';
import { applicationErrorResult } from '../../src/adapters/mcp/results.js';
import { createMcpServer } from '../../src/adapters/mcp/server.js';
import { BrowserMeshError } from '../../src/domain/errors.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/domain/resource-limits.js';
import { BROWSERMESH_VERSION } from '../../src/infrastructure/generated/version.js';
import { FakeEngine, testRuntime } from '../support/fakes.js';

describe('MCP adapter', () => {
  it('publishes and fulfills the exact structured contract for every tool', async () => {
    const { runtime, engine } = testRuntime();
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(client.getServerVersion()).toEqual({
        name: 'browsermesh',
        version: BROWSERMESH_VERSION,
      });
      const discovered = await client.listTools();
      expect(discovered.tools.map(({ name }) => name).sort()).toEqual(expectedToolNames);
      expect(discovered.tools.every(({ description }) => (description?.length ?? 0) > 40)).toBe(
        true,
      );

      for (const tool of discovered.tools) {
        if (!isToolName(tool.name)) throw new Error(`Unexpected MCP tool '${tool.name}'`);
        const name = tool.name;
        const presentation = toolPresentation[name];
        expect(tool.title, `${name} title`).toBe(presentation.title);
        expect(tool.annotations, `${name} annotations`).toEqual({
          title: presentation.title,
          ...presentation.annotations,
        });
        expect(tool.outputSchema, `${name} outputSchema`).toMatchObject({ type: 'object' });
      }

      expect(
        discovered.tools.some(
          ({ name }) =>
            name.startsWith('browser_agent_') ||
            name.startsWith('browser_message_') ||
            name === 'browser_session_assign' ||
            name === 'browser_session_release',
        ),
      ).toBe(false);
      const createTool = discovered.tools.find(({ name }) => name === 'browser_session_create');
      expect(createTool?.description).toContain('different user, account, role');
      expect(createTool?.description).toContain('independent parallel workflow');
      expect(createTool?.inputSchema).toHaveProperty('properties.stateId');
      expect(createTool?.inputSchema).toHaveProperty('properties.contextSettings');
      expect(createTool?.inputSchema).not.toHaveProperty('properties.fromState');
      const clickTool = discovered.tools.find(({ name }) => name === 'browser_click');
      expect(clickTool?.description).toContain('exactly by default');
      expect(clickTool?.description).toContain('LOCATOR_AMBIGUOUS');
      expect(clickTool?.inputSchema).toHaveProperty('properties.locator');
      expect(clickTool?.inputSchema).toHaveProperty('properties.ref');
      expect(clickTool?.description).toContain('iframe chain');
      expect(toolPresentation.browser_hover).toEqual({
        title: 'Hover over page element',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      });
      expect(toolPresentation.browser_double_click.annotations).toMatchObject({
        destructiveHint: true,
        idempotentHint: false,
      });
      expect(
        discovered.tools.find(({ name }) => name === 'browser_snapshot')?.description,
      ).toContain('password-input values are redacted');
      expect(
        discovered.tools.find(({ name }) => name === 'browser_snapshot')?.description,
      ).toContain('30-second element refs');
      expect(toolPresentation.browser_wait.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
      });
      expect(toolPresentation.browser_action_and_wait.annotations).toMatchObject({
        readOnlyHint: false,
        openWorldHint: true,
      });
      const compositeTool = discovered.tools.find(({ name }) => name === 'browser_action_and_wait');
      expect(compositeTool?.description).toContain('Popup pages receive a new BrowserMesh pageId');
      expect(compositeTool?.description).toContain('Dialogs must be handled atomically');
      const runtimeInfoTool = discovered.tools.find(({ name }) => name === 'browser_runtime_info');
      expect(runtimeInfoTool?.title).toBe('Inspect BrowserMesh runtime');
      expect(runtimeInfoTool?.annotations).toEqual({
        title: 'Inspect BrowserMesh runtime',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const runtimeInfo = requireCallResult(
        await client.callTool({ name: 'browser_runtime_info', arguments: {} }),
      );
      const parsedRuntimeInfo = outputSchemas.browser_runtime_info.parse(
        runtimeInfo.structuredContent,
      );
      expect(parsedRuntimeInfo).toMatchObject({
        browserLaunchState: 'not_started',
        browserVersion: null,
        activeSessions: 0,
        failedSessions: 0,
      });
      expect(readText(runtimeInfo)).toBe(
        `BrowserMesh ${parsedRuntimeInfo.serverVersion}; Chromium not_started; 0 active and 0 failed sessions.`,
      );

      const created = await callSuccess(client, 'browser_session_create', {
        name: 'mcp',
        contextSettings: {
          locale: 'EN-us',
          timezoneId: 'Etc/UTC',
          geolocation: { latitude: 41.3111, longitude: 69.2797 },
          permissions: [{ permission: 'geolocation', origin: 'HTTPS://EXAMPLE.COM:443/' }],
        },
      });
      expect(created.structuredContent).toMatchObject({
        session: {
          contextSettings: {
            locale: 'en-US',
            timezoneId: 'UTC',
            geolocation: { latitude: 41.3111, longitude: 69.2797 },
            permissions: [{ permission: 'geolocation', origin: 'https://example.com' }],
          },
        },
      });
      const target = z
        .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
        .parse(created.structuredContent).initialPage;
      expect(created.structuredContent).not.toHaveProperty('value');
      expect(readCompatibilityText(created)).toEqual(created.structuredContent);

      const badTimezone = requireCallResult(
        await client.callTool({
          name: 'browser_session_create',
          arguments: { contextSettings: { timezoneId: 'Mars/Olympus' } },
        }),
      );
      expect(badTimezone.isError).toBe(true);
      expect(publicErrorSchema.parse(JSON.parse(readText(badTimezone))).error).toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: 'The request contains an invalid argument',
      });

      const broadPermission = requireCallResult(
        await client.callTool({
          name: 'browser_session_create',
          arguments: {
            contextSettings: {
              geolocation: { latitude: 0, longitude: 0 },
              permissions: [{ permission: 'geolocation', origin: '*' }],
            },
          },
        }),
      );
      expect(broadPermission.isError).toBe(true);
      expect(publicErrorSchema.parse(JSON.parse(readText(broadPermission))).error).toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: 'The request contains an invalid argument',
      });

      const missing = requireCallResult(
        await client.callTool({
          name: 'browser_session_get',
          arguments: { sessionId: 'missing' },
        }),
      );
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toBeUndefined();
      const missingError = publicErrorSchema.parse(JSON.parse(readText(missing))).error;
      expect(missingError).toMatchObject({ code: 'SESSION_NOT_FOUND' });
      expect(missingError.operationId).toMatch(/^operation_/u);

      const invalid = requireCallResult(
        await client.callTool({ name: 'browser_session_get', arguments: {} }),
      );
      expect(invalid.isError).toBe(true);
      expect(invalid.structuredContent).toBeUndefined();
      expect(readText(invalid)).toContain('Input validation error');
      expect(readText(invalid)).not.toContain('SESSION_NOT_FOUND');

      const invalidSnapshotBound = requireCallResult(
        await client.callTool({
          name: 'browser_snapshot',
          arguments: { sessionId: 'session', pageId: 'page', maxChars: 0 },
        }),
      );
      expect(invalidSnapshotBound.isError).toBe(true);
      expect(readText(invalidSnapshotBound)).toContain('Input validation error');

      const additionalPage = await callSuccess(client, 'browser_page_create', {
        sessionId: target.sessionId,
      });
      const additionalPageId = z
        .object({ pageId: z.string() })
        .parse(additionalPage.structuredContent).pageId;
      await callSuccess(client, 'browser_session_list', {});
      await callSuccess(client, 'browser_session_get', { sessionId: target.sessionId });
      await callSuccess(client, 'browser_page_list', { sessionId: target.sessionId });
      await callSuccess(client, 'browser_navigate', {
        ...target,
        url: 'https://example.test/contract',
      });
      await callSuccess(client, 'browser_back', target);
      await callSuccess(client, 'browser_forward', target);
      await callSuccess(client, 'browser_reload', target);
      await callSuccess(client, 'browser_get_url', target);
      await callSuccess(client, 'browser_get_title', target);
      const boundedSnapshot = await callSuccess(client, 'browser_snapshot', {
        ...target,
        scope: {
          strategy: 'role',
          value: 'button',
          name: 'Submit',
          frame: {
            kind: 'iframe',
            chain: [{ strategy: 'testId', value: 'workspace-frame' }],
          },
        },
        maxDepth: 1,
        includeBoundingBoxes: true,
        maxChars: 4,
        maxBytes: 4,
      });
      expect(boundedSnapshot.structuredContent).toMatchObject({
        snapshot: '- do',
        contentFormat: 'aria-yaml-fragment',
        partial: true,
        appliedBounds: {
          scope: {
            strategy: 'role',
            value: 'button',
            name: 'Submit',
            exact: true,
            frame: {
              kind: 'iframe',
              chain: [{ strategy: 'testId', value: 'workspace-frame' }],
            },
          },
          maxDepth: 1,
          includeBoundingBoxes: true,
          maxChars: 4,
          maxBytes: 4,
        },
        truncation: { truncated: true, byMaxChars: true, byMaxBytes: true },
      });
      expect(engine.lastSnapshotOptions).toEqual({
        scope: {
          strategy: 'role',
          value: 'button',
          name: 'Submit',
          exact: true,
          frame: {
            kind: 'iframe',
            chain: [{ strategy: 'testId', value: 'workspace-frame' }],
          },
        },
        maxDepth: 1,
        includeBoundingBoxes: true,
        includeRefs: false,
        maxRefs: 50,
      });
      const snapshotCursor = z
        .object({ pagination: z.object({ nextCursor: z.string() }) })
        .parse(boundedSnapshot.structuredContent).pagination.nextCursor;
      const nextSnapshotPage = await callSuccess(client, 'browser_snapshot', {
        ...target,
        cursor: snapshotCursor,
      });
      expect(nextSnapshotPage.structuredContent).toMatchObject({
        contentFormat: 'aria-yaml-fragment',
        pagination: { offsetChars: 4 },
      });
      await callSuccess(client, 'browser_visible_text', {
        ...target,
        locator: { strategy: 'testId', value: 'status' },
      });
      const excessiveFrameDepth = requireCallResult(
        await client.callTool({
          name: 'browser_visible_text',
          arguments: {
            ...target,
            locator: {
              strategy: 'testId',
              value: 'status',
              frame: {
                kind: 'iframe',
                chain: Array.from({ length: 6 }, () => ({
                  strategy: 'testId',
                  value: 'frame',
                })),
              },
            },
          },
        }),
      );
      expect(excessiveFrameDepth.isError).toBe(true);
      expect(readText(excessiveFrameDepth)).toContain('Input validation error');
      const targetHandle = requiredValue(Array.from(engine.pages.values())[0]);
      engine.emitObservation(targetHandle, {
        kind: 'console',
        level: 'error',
        text: 'token=mcp-secret failed',
      });
      const defaultConsole = await callSuccess(client, 'browser_console_list', target);
      const defaultConsoleEvent = z
        .object({ events: z.array(z.object({ text: z.string().optional() })).min(1) })
        .parse(defaultConsole.structuredContent).events[0];
      expect(defaultConsoleEvent).not.toHaveProperty('text');
      const textConsole = await callSuccess(client, 'browser_console_list', {
        ...target,
        includeText: true,
      });
      expect(
        z
          .object({ events: z.array(z.object({ text: z.string() })).min(1) })
          .parse(textConsole.structuredContent).events[0]?.text,
      ).toBe('token=[REDACTED] failed');
      await callSuccess(client, 'browser_page_errors_list', { ...target, includeText: false });
      engine.emitObservation(targetHandle, {
        kind: 'request',
        requestId: 'request_mcp',
        method: 'GET',
        url: 'https://user:password@example.test/api?token=mcp-network-secret#fragment',
        resourceType: 'fetch',
      });
      engine.emitObservation(targetHandle, {
        kind: 'request_failed',
        requestId: 'request_failed_mcp',
        method: 'POST',
        url: 'https://example.test/fail?api_key=mcp-failure-secret',
        resourceType: 'fetch',
        durationMs: 12,
        failure: 'token=failure-message-secret connection reset',
      });
      const network = await callSuccess(client, 'browser_network_list', target);
      expect(JSON.stringify(network)).not.toContain('mcp-network-secret');
      expect(JSON.stringify(network)).not.toContain('password@');
      const failures = await callSuccess(client, 'browser_failed_requests_list', target);
      expect(JSON.stringify(failures)).not.toContain('failure-message-secret');
      expect(JSON.stringify(failures)).not.toContain('mcp-failure-secret');
      await callSuccess(client, 'browser_click', {
        ...target,
        locator: { strategy: 'role', value: 'button', name: 'Submit', exact: true },
      });
      const missingElementTarget = requireCallResult(
        await client.callTool({ name: 'browser_click', arguments: target }),
      );
      expect(missingElementTarget.isError).toBe(true);
      expect(JSON.parse(readText(missingElementTarget))).toMatchObject({
        error: { code: 'INVALID_ARGUMENT' },
      });
      for (const name of [
        'browser_double_click',
        'browser_hover',
        'browser_focus',
        'browser_check',
        'browser_uncheck',
        'browser_scroll_into_view',
      ] as const) {
        const result = await callSuccess(client, name, {
          ...target,
          locator: { strategy: 'testId', value: 'control' },
        });
        expect(result.structuredContent).toMatchObject({ ...target, completed: true });
      }
      await callSuccess(client, 'browser_scroll', { ...target, deltaX: 0, deltaY: 400 });
      await callSuccess(client, 'browser_drag_and_drop', {
        ...target,
        source: { strategy: 'testId', value: 'source' },
        target: { strategy: 'testId', value: 'destination' },
      });
      await callSuccess(client, 'browser_fill', {
        ...target,
        locator: { strategy: 'label', value: 'Name' },
        value: 'Alice',
      });
      await callSuccess(client, 'browser_press', {
        ...target,
        locator: { strategy: 'css', value: 'input' },
        key: 'Enter',
      });
      await callSuccess(client, 'browser_select_option', {
        ...target,
        locator: { strategy: 'label', value: 'Choice' },
        value: 'two',
      });
      const screenshot = await callSuccess(client, 'browser_screenshot', target);
      expect(screenshot.content.some((block) => block.type === 'image')).toBe(true);
      expect(screenshot.structuredContent).toMatchObject({ width: 1, height: 1, bytes: 24 });
      await callSuccess(client, 'browser_screenshot', {
        ...target,
        capture: { kind: 'element', locator: { strategy: 'testId', value: 'control' } },
      });
      await callSuccess(client, 'browser_wait', {
        ...target,
        condition: {
          kind: 'url',
          matcher: { kind: 'exact', value: 'https://example.test/contract' },
        },
      });
      await callSuccess(client, 'browser_action_and_wait', {
        ...target,
        action: { kind: 'click', target: { strategy: 'role', value: 'button', name: 'Submit' } },
        wait: {
          kind: 'response',
          matcher: { kind: 'exact', value: 'https://example.test/result' },
        },
      });
      const popupResult = await callSuccess(client, 'browser_action_and_wait', {
        ...target,
        action: { kind: 'click', locator: { strategy: 'testId', value: 'popup' } },
        wait: { kind: 'popup' },
      });
      expect(popupResult.structuredContent).toMatchObject({
        event: { kind: 'popup', page: { sessionId: target.sessionId, isDefault: false } },
      });
      const dialogResult = await callSuccess(client, 'browser_action_and_wait', {
        ...target,
        action: { kind: 'click', locator: { strategy: 'testId', value: 'prompt' } },
        wait: {
          kind: 'dialog',
          dialogType: 'prompt',
          action: 'accept',
          promptText: 'answer',
        },
      });
      expect(dialogResult.structuredContent).toMatchObject({
        event: {
          kind: 'dialog',
          dialogType: 'prompt',
          action: 'accept',
          message: 'Fake dialog',
        },
      });
      engine.failNextWait = true;
      const timedOutWait = requireCallResult(
        await client.callTool({
          name: 'browser_wait',
          arguments: {
            ...target,
            condition: { kind: 'text', text: 'missing', state: 'present' },
          },
        }),
      );
      expect(timedOutWait.isError).toBe(true);
      expect(timedOutWait.structuredContent).toBeUndefined();
      const timedOutError = publicErrorSchema.parse(JSON.parse(readText(timedOutWait))).error;
      expect(timedOutError.code).toBe('OPERATION_TIMEOUT');
      expect(timedOutError.operationId).toMatch(/^operation_/u);
      await callSuccess(client, 'browser_get_title', target);
      await callSuccess(client, 'browser_state_save', {
        sessionId: target.sessionId,
        stateId: 'contract-state',
      });
      await callSuccess(client, 'browser_state_list', {});
      await callSuccess(client, 'browser_state_remove', { stateId: 'contract-state' });
      await callSuccess(client, 'browser_page_close', {
        sessionId: target.sessionId,
        pageId: additionalPageId,
      });
      await callSuccess(client, 'browser_session_close', { sessionId: target.sessionId });
    } finally {
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });

  it('bounds application errors and removes causes, cycles, bigint, and secret fields', () => {
    const cyclic: Record<string, unknown> = {
      safe: 'x'.repeat(2_000),
      token: 'do-not-expose',
      count: 1n,
      nested: { password: 'do-not-expose-either', allowed: true },
    };
    cyclic.self = cyclic;
    const result = requireCallResult(
      applicationErrorResult(
        new BrowserMeshError('INVALID_ARGUMENT', 'token=do-not-expose', {
          cause: new Error('stack secret'),
          details: cyclic,
          operationId: 'operation_safe',
        }),
      ),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('do-not-expose');
    expect(serialized).not.toContain('stack secret');
    expect(serialized).not.toContain('token=');
    expect(serialized.length).toBeLessThan(2_000);
    expect(publicErrorSchema.parse(JSON.parse(readText(result))).error).toMatchObject({
      code: 'INVALID_ARGUMENT',
      operationId: 'operation_safe',
    });
    const hostileDetails = new Proxy<Record<string, unknown>>(
      {},
      {
        get: () => {
          throw new Error('getter secret');
        },
      },
    );
    expect(() =>
      JSON.stringify(
        applicationErrorResult(
          new BrowserMeshError('BROWSER_ERROR', 'unsafe', { details: hostileDetails }),
        ),
      ),
    ).not.toThrow();
  });

  it('maps unexpected runtime-info failures through the safe application error contract', async () => {
    const engine = new FakeEngine();
    engine.diagnostics = () => {
      throw new Error('private-path C:\\Users\\secret');
    };
    const { runtime } = testRuntime(engine);
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'runtime-info-error-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const failed = requireCallResult(
        await client.callTool({ name: 'browser_runtime_info', arguments: {} }),
      );
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toBeUndefined();
      expect(readText(failed)).toContain('INTERNAL_ERROR');
      expect(readText(failed)).not.toContain('private-path');
      expect(readText(failed)).not.toContain('Users');
    } finally {
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });

  it('mirrors label bounds and reports runtime-owned visible-text truncation', async () => {
    const { runtime } = testRuntime(new FakeEngine(), {
      resources: {
        ...DEFAULT_RESOURCE_LIMITS,
        visibleText: { maxChars: 10, maxBytes: 5 },
      },
    });
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'resource-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const invalid = requireCallResult(
        await client.callTool({
          name: 'browser_session_create',
          arguments: { metadata: { constructor: 'unsafe' } },
        }),
      );
      expect(invalid.isError).toBe(true);
      const created = await callSuccess(client, 'browser_session_create', {});
      const target = z
        .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
        .parse(created.structuredContent).initialPage;
      const text = await callSuccess(client, 'browser_visible_text', {
        ...target,
        locator: { strategy: 'text', value: 'a😀b' },
      });
      expect(text.structuredContent).toMatchObject({
        text: 'a😀',
        truncation: { truncated: true, originalBytes: 6, returnedBytes: 5 },
      });
    } finally {
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });

  it('propagates MCP cancellation without allowing same-session work to overtake', async () => {
    const engine = new FakeEngine();
    const { runtime } = testRuntime(engine);
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'cancellation-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    let releaseNavigation: (() => void) | undefined;
    try {
      const created = await callSuccess(client, 'browser_session_create', {});
      const page = z
        .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
        .parse(created.structuredContent).initialPage;
      engine.navigationGate = new Promise<void>((resolve) => (releaseNavigation = resolve));
      let navigationStarted!: () => void;
      const started = new Promise<void>((resolve) => (navigationStarted = resolve));
      engine.onNavigationStart = navigationStarted;
      const controller = new AbortController();
      const navigation = client.callTool(
        {
          name: 'browser_navigate',
          arguments: { ...page, url: 'https://cancelled.example' },
        },
        undefined,
        { signal: controller.signal },
      );
      await started;
      controller.abort();
      let cancellation: unknown;
      void navigation.catch((error: unknown) => {
        cancellation = error;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cancellation).toMatchObject({ name: 'McpError' });
      expect(cancellation).toBeInstanceOf(Error);
      expect((cancellation as Error).message).toContain('AbortError');

      let followerSettled = false;
      const follower = client
        .callTool({ name: 'browser_get_url', arguments: page })
        .finally(() => (followerSettled = true));
      await Promise.resolve();
      expect(followerSettled).toBe(false);
      releaseNavigation?.();
      const followerResult = await follower;
      expect(z.object({ url: z.string() }).parse(followerResult.structuredContent).url).toContain(
        'cancelled.example',
      );
    } finally {
      releaseNavigation?.();
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });
});

const expectedToolNames = Object.keys(outputSchemas).sort();

const publicErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string().max(512),
    details: z.record(z.string(), z.unknown()).optional(),
    operationId: z.string().optional(),
  }),
});

const resultSchema = z.looseObject({
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
});
type ResultLike = z.infer<typeof resultSchema>;

async function callSuccess(
  client: Client,
  name: ToolName,
  args: Readonly<Record<string, unknown>>,
): Promise<ResultLike> {
  const result = requireCallResult(await client.callTool({ name, arguments: args }));
  expect(result.isError, `${name} isError`).not.toBe(true);
  expect(result.structuredContent, `${name} structuredContent`).toBeDefined();
  outputSchemas[name].parse(result.structuredContent);
  expect(readCompatibilityText(result), `${name} compatibility text`).toEqual(
    result.structuredContent,
  );
  return result;
}

function readCompatibilityText(result: ResultLike): unknown {
  return JSON.parse(readText(result));
}

function readText(result: ResultLike): string {
  const text = result.content.find((block) => block.type === 'text')?.text;
  if (text === undefined) throw new Error('MCP result did not include text content');
  return text;
}

function requireCallResult(result: unknown): ResultLike {
  return resultSchema.parse(result);
}

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(outputSchemas, name);
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected test value');
  return value;
}
