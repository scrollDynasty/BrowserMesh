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
import { JSON_SCHEMA_2020_12_DIALECT } from '../../src/adapters/mcp/schema-dialect.js';
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
        // Clients validating with a 2020-12-only validator reject the whole tool
        // when discovery declares any other dialect.
        for (const schema of [tool.inputSchema, tool.outputSchema]) {
          const dialect = (schema as { $schema?: unknown } | undefined)?.$schema;
          if (dialect !== undefined) {
            expect(dialect, `${name} schema dialect`).toBe(JSON_SCHEMA_2020_12_DIALECT);
          }
          expect(draftSevenOnlyKeywords(schema), `${name} draft-07 keywords`).toEqual([]);
        }
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
      const defaultConsole = await callSuccess(client, 'browser_observe', {
        ...target,
        source: 'console',
      });
      const defaultConsoleEvent = z
        .object({ events: z.array(z.object({ text: z.string().optional() })).min(1) })
        .parse(defaultConsole.structuredContent).events[0];
      expect(defaultConsoleEvent).not.toHaveProperty('text');
      const textConsole = await callSuccess(client, 'browser_observe', {
        ...target,
        source: 'console',
        includeText: true,
      });
      expect(
        z
          .object({ events: z.array(z.object({ text: z.string() })).min(1) })
          .parse(textConsole.structuredContent).events[0]?.text,
      ).toBe('token=[REDACTED] failed');
      await callSuccess(client, 'browser_observe', {
        ...target,
        source: 'pageError',
        includeText: false,
      });
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
      const network = await callSuccess(client, 'browser_observe', {
        ...target,
        source: 'network',
      });
      expect(JSON.stringify(network)).not.toContain('mcp-network-secret');
      expect(JSON.stringify(network)).not.toContain('password@');
      const failures = await callSuccess(client, 'browser_observe', {
        ...target,
        source: 'requestFailed',
      });
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
        action: { kind: 'click', target: { strategy: 'testId', value: 'popup' } },
        wait: { kind: 'popup' },
      });
      expect(popupResult.structuredContent).toMatchObject({
        event: { kind: 'popup', page: { sessionId: target.sessionId, isDefault: false } },
      });
      const dialogResult = await callSuccess(client, 'browser_action_and_wait', {
        ...target,
        action: { kind: 'click', target: { strategy: 'testId', value: 'prompt' } },
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

  it('reads every observation source through one contract and refuses text it cannot carry', async () => {
    const { runtime, engine } = testRuntime();
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'observe-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const created = await callSuccess(client, 'browser_session_create', {});
      const page = z
        .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
        .parse(created.structuredContent).initialPage;
      const handle = requiredValue(Array.from(engine.pages.values())[0]);
      engine.emitObservation(handle, { kind: 'console', level: 'error', text: 'boom' });
      engine.emitObservation(handle, {
        kind: 'request_failed',
        requestId: 'r1',
        method: 'GET',
        url: 'https://example.test/x',
        resourceType: 'fetch',
        durationMs: 3,
        failure: 'connection reset',
      });

      for (const source of ['console', 'pageError', 'network', 'requestFailed'] as const) {
        const listed = await callSuccess(client, 'browser_observe', { ...page, source });
        // The source is echoed because a caller reading several sources into
        // one buffer cannot otherwise tell the pages of results apart.
        expect(outputSchemas.browser_observe.parse(listed.structuredContent).source).toBe(source);
      }

      const consoleEvents = outputSchemas.browser_observe.parse(
        (await callSuccess(client, 'browser_observe', { ...page, source: 'console' }))
          .structuredContent,
      ).events;
      expect(consoleEvents[0]).not.toHaveProperty('text');

      for (const source of ['network', 'requestFailed'] as const) {
        // Silently ignoring includeText would hand back a metadata-only answer
        // that looks like complete evidence.
        const refused = requireCallResult(
          await client.callTool({
            name: 'browser_observe',
            arguments: { ...page, source, includeText: true },
          }),
        );
        expect(refused.isError, source).toBe(true);
        // Reported as MCP input validation so the message can name the field;
        // a BrowserMeshError would arrive as the fixed INVALID_ARGUMENT text.
        expect(readText(refused)).toContain('Input validation error');
        expect(readText(refused)).toContain('includeText');
      }
    } finally {
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });

  it('publishes only the profiles the configuration selects', async () => {
    const { runtime } = testRuntime();
    const server = createMcpServer(runtime, { tools: 'core' });
    const client = new Client({ name: 'profile-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const names = (await client.listTools()).tools.map(({ name }) => name);

      expect(names).toContain('browser_navigate');
      expect(names).not.toContain('browser_observe');
      expect(names).not.toContain('browser_state_save');

      // A withdrawn tool must be uncallable, not merely undiscoverable.
      const withdrawn = requireCallResult(
        await client.callTool({ name: 'browser_state_list', arguments: {} }),
      );
      expect(withdrawn.isError).toBe(true);
      expect(readText(withdrawn)).toContain('browser_state_list');
    } finally {
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });

  it('publishes exactly one way to address a composite action target', async () => {
    const { runtime } = testRuntime();
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'action-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const created = await callSuccess(client, 'browser_session_create', {});
      const page = z
        .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
        .parse(created.structuredContent).initialPage;

      // `locator` used to be accepted alongside `target` for the same action.
      // It doubled the largest published contract and left a model choosing
      // between two spellings of one field, so only `target` remains.
      const rejected = requireCallResult(
        await client.callTool({
          name: 'browser_action_and_wait',
          arguments: {
            ...page,
            action: { kind: 'click', locator: { strategy: 'testId', value: 'submit' } },
            wait: { kind: 'popup' },
          },
        }),
      );
      expect(rejected.isError).toBe(true);
      // The SDK reports this as MCP input validation, which stays
      // distinguishable from a BrowserMesh application error.
      expect(readText(rejected)).toContain('Input validation error');
      expect(readText(rejected)).toContain('action.target');

      const schema = (await client.listTools()).tools.find(
        ({ name }) => name === 'browser_action_and_wait',
      )?.inputSchema;
      expect(JSON.stringify(schema)).not.toContain('"locator"');
    } finally {
      await client.close();
      await server.close();
      await runtime.shutdown();
    }
  });

  it('publishes a tool surface small enough to share a client context window', async () => {
    // Discovery is paid once per session, in context, by every client. A client
    // that has to fit several MCP servers in one window drops the most
    // expensive one, so the size of this payload is an adoption property and is
    // budgeted here rather than left to drift with the contracts.
    const compact = await discoveredToolPayload({});
    const expanded = await discoveredToolPayload({
      toolSchemas: { shareRepeatedSubschemas: false },
    });

    expect(compact.bytes).toBeLessThan(expanded.bytes * 0.85);
    expect(compact.bytes).toBeLessThan(TOOL_DISCOVERY_BYTE_BUDGET);
    // Every reference a client receives has to resolve inside the schema that
    // carries it, or the tool is undiscoverable rather than merely large.
    expect(compact.danglingReferences).toEqual([]);

    // Equivalence, proven on the payload a client actually receives. The unit
    // suite proves it for result contracts, but argument contracts are
    // registered inline in the server and are where the sharing actually pays,
    // so they can only be reached from here. Expanding every reference has to
    // reproduce the uncompacted schema exactly; if it does, the two accept
    // exactly the same arguments.
    expect(compact.schemas.size).toBe(expanded.schemas.size);
    for (const [key, schema] of compact.schemas) {
      expect(dereference(schema), `${key} round trip`).toEqual(expanded.schemas.get(key));
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

    const partlyHostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(partlyHostile, 'timeoutMs', {
      get: () => {
        throw new Error('timeout getter secret');
      },
    });
    partlyHostile.reason = 'connection';
    partlyHostile.url = 'https://user:password@example.test/safe/path?token=secret#private';
    partlyHostile.locator = new Proxy(
      { strategy: 'testId', exact: true },
      {
        get: (target, property, receiver) => {
          if (property === 'value') throw new Error('locator getter secret');
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const hardened = publicErrorSchema.parse(
      JSON.parse(
        readText(
          requireCallResult(
            applicationErrorResult(
              new BrowserMeshError('NAVIGATION_FAILED', 'unsafe raw failure', {
                details: partlyHostile,
                operationId: 'operation_hardened',
              }),
            ),
          ),
        ),
      ),
    ).error;
    expect(hardened).toMatchObject({
      code: 'NAVIGATION_FAILED',
      operationId: 'operation_hardened',
      details: {
        reason: 'connection',
        url: 'https://example.test/safe/path',
        locator: { strategy: 'testId', exact: true },
      },
    });
    expect(JSON.stringify(hardened)).not.toContain('password');
    expect(JSON.stringify(hardened)).not.toContain('token');
    expect(JSON.stringify(hardened)).not.toContain('secret');
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

/**
 * Constructs a 2020-12 validator reads differently than draft-07 does. Their
 * absence is what makes publishing the 2020-12 dialect accurate rather than
 * merely accepted.
 */
function draftSevenOnlyKeywords(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(draftSevenOnlyKeywords);
  if (typeof schema !== 'object' || schema === null) return [];
  const found: string[] = [];
  for (const [keyword, value] of Object.entries(schema)) {
    // `definitions` moved to `$defs`, `dependencies` split into
    // `dependentSchemas`/`dependentRequired`, and tuple `items`/`additionalItems`
    // became `prefixItems`/`items`.
    if (keyword === 'definitions' || keyword === 'dependencies') found.push(keyword);
    if (keyword === 'additionalItems') found.push(keyword);
    if (keyword === 'items' && Array.isArray(value)) found.push('items[]');
    found.push(...draftSevenOnlyKeywords(value));
  }
  return found;
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected test value');
  return value;
}

/**
 * Serialized size of `tools/list` as a client receives it. The ceiling is set
 * above the current payload with room for ordinary contract work; crossing it
 * should be a deliberate decision, not a surprise.
 */
const TOOL_DISCOVERY_BYTE_BUDGET = 115_000;

async function discoveredToolPayload(options: Parameters<typeof createMcpServer>[1]): Promise<{
  bytes: number;
  danglingReferences: string[];
  schemas: Map<string, Record<string, unknown>>;
}> {
  const { runtime } = testRuntime();
  const server = createMcpServer(runtime, options);
  const client = new Client({ name: 'size-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const discovered = await client.listTools();
    const schemas = new Map<string, Record<string, unknown>>();
    for (const tool of discovered.tools) {
      for (const kind of ['inputSchema', 'outputSchema'] as const) {
        const schema = tool[kind];
        if (schema !== undefined) schemas.set(`${tool.name}.${kind}`, schema);
      }
    }
    return {
      bytes: JSON.stringify(discovered.tools).length,
      danglingReferences: discovered.tools.flatMap((tool) => [
        ...unresolvedReferences(tool.inputSchema),
        ...unresolvedReferences(tool.outputSchema),
      ]),
      schemas,
    };
  } finally {
    await client.close();
    await server.close();
    await runtime.shutdown();
  }
}

/** Expand every `$ref` back into place and drop the definitions they came from. */
function dereference(schema: Record<string, unknown>): Record<string, unknown> {
  const definitions = (schema.$defs ?? {}) as Record<string, Record<string, unknown>>;
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expand);
    if (typeof value !== 'object' || value === null) return value;
    const node = value as Record<string, unknown>;
    const reference = node.$ref;
    if (typeof reference === 'string') {
      const target = definitions[reference.replace('#/$defs/', '')];
      if (target === undefined) throw new Error(`unresolved reference ${reference}`);
      return expand(target);
    }
    return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, expand(entry)]));
  };
  const body = expand(schema) as Record<string, unknown>;
  delete body.$defs;
  return body;
}

/** Every `$ref` in one schema that does not name a definition the schema carries. */
function unresolvedReferences(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const definitions = (schema as { $defs?: Record<string, unknown> }).$defs ?? {};
  const collect = (node: unknown): string[] => {
    if (Array.isArray(node)) return node.flatMap(collect);
    if (typeof node !== 'object' || node === null) return [];
    const found: string[] = [];
    for (const [keyword, value] of Object.entries(node)) {
      if (keyword === '$ref' && typeof value === 'string') {
        const name = value.replace('#/$defs/', '');
        if (!Object.prototype.hasOwnProperty.call(definitions, name)) found.push(value);
      }
      found.push(...collect(value));
    }
    return found;
  };
  return collect(schema);
}
