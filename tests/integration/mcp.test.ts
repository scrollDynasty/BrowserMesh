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
      expect(createTool?.inputSchema).not.toHaveProperty('properties.fromState');
      const clickTool = discovered.tools.find(({ name }) => name === 'browser_click');
      expect(clickTool?.description).toContain('exactly by default');
      expect(clickTool?.description).toContain('LOCATOR_AMBIGUOUS');
      expect(clickTool?.inputSchema).toHaveProperty('properties.locator');
      expect(
        discovered.tools.find(({ name }) => name === 'browser_snapshot')?.description,
      ).toContain('password-input values are redacted');
      expect(toolPresentation.browser_wait.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
      });
      expect(toolPresentation.browser_action_and_wait.annotations).toMatchObject({
        readOnlyHint: false,
        openWorldHint: true,
      });
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

      const created = await callSuccess(client, 'browser_session_create', { name: 'mcp' });
      const target = z
        .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
        .parse(created.structuredContent).initialPage;
      expect(created.structuredContent).not.toHaveProperty('value');
      expect(readCompatibilityText(created)).toEqual(created.structuredContent);

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
      await callSuccess(client, 'browser_snapshot', target);
      await callSuccess(client, 'browser_visible_text', {
        ...target,
        locator: { strategy: 'testId', value: 'status' },
      });
      await callSuccess(client, 'browser_click', {
        ...target,
        locator: { strategy: 'role', value: 'button', name: 'Submit', exact: true },
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
      await callSuccess(client, 'browser_wait', {
        ...target,
        condition: {
          kind: 'url',
          matcher: { kind: 'exact', value: 'https://example.test/contract' },
        },
      });
      await callSuccess(client, 'browser_action_and_wait', {
        ...target,
        action: { kind: 'click', locator: { strategy: 'role', value: 'button', name: 'Submit' } },
        wait: {
          kind: 'response',
          matcher: { kind: 'exact', value: 'https://example.test/result' },
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
