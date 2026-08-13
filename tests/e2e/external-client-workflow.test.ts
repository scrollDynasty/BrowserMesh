import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createMcpServer } from '../../src/adapters/mcp/server.js';
import type { BrowserMeshRuntime } from '../../src/runtime/browsermesh-runtime.js';
import { createRealRuntimeHarness, type RealRuntimeHarness } from '../support/real-runtime.js';
import { startTestWebServer, type TestWebServer } from '../support/test-web-server.js';

describe('external MCP client multi-role workflow', () => {
  let runtime: BrowserMeshRuntime;
  let harness: RealRuntimeHarness;
  let web: TestWebServer;

  beforeEach(async () => {
    harness = await createRealRuntimeHarness();
    runtime = harness.runtime;
    web = await startTestWebServer();
  });

  afterEach(async () => {
    await Promise.all([harness.cleanup(), web.close()]);
  });

  it('uses independent buyer and seller sessions without internal agent orchestration', async () => {
    const server = createMcpServer(runtime);
    const client = new Client({ name: 'external-workflow-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const buyer = readStructured(
        await client.callTool({
          name: 'browser_session_create',
          arguments: {
            name: 'buyer',
            metadata: { role: 'buyer', account: 'buyer@example.test' },
          },
        }),
      );
      const seller = readStructured(
        await client.callTool({
          name: 'browser_session_create',
          arguments: {
            name: 'seller',
            metadata: { role: 'seller', account: 'seller@example.test' },
          },
        }),
      );
      const buyerTarget = requireTarget(buyer);
      const sellerTarget = requireTarget(seller);

      await call(client, 'browser_navigate', { ...buyerTarget, url: `${web.baseUrl}/buyer` });
      await call(client, 'browser_fill', {
        ...buyerTarget,
        locator: { strategy: 'label', value: 'Item' },
        value: 'book',
      });
      await call(client, 'browser_click', {
        ...buyerTarget,
        locator: { strategy: 'role', value: 'button', name: 'Create order' },
      });
      expect(
        readStructured(
          await client.callTool({
            name: 'browser_visible_text',
            arguments: {
              ...buyerTarget,
              locator: { strategy: 'testId', value: 'status' },
            },
          }),
        ).text,
      ).toBe('created:book');

      await call(client, 'browser_navigate', { ...sellerTarget, url: `${web.baseUrl}/seller` });
      expect(
        readStructured(
          await client.callTool({
            name: 'browser_visible_text',
            arguments: {
              ...sellerTarget,
              locator: { strategy: 'testId', value: 'order' },
            },
          }),
        ).text,
      ).toBe('book');
      await call(client, 'browser_click', {
        ...sellerTarget,
        locator: { strategy: 'role', value: 'link', name: 'Approve' },
      });

      await call(client, 'browser_navigate', {
        ...buyerTarget,
        url: `${web.baseUrl}/buyer-status`,
      });
      expect(
        readStructured(
          await client.callTool({
            name: 'browser_visible_text',
            arguments: {
              ...buyerTarget,
              locator: { strategy: 'testId', value: 'status' },
            },
          }),
        ).text,
      ).toBe('approved');
      const timedOutLocator = await client.callTool({
        name: 'browser_press',
        arguments: {
          ...buyerTarget,
          timeoutMs: 100,
          locator: { strategy: 'css', value: '#missing-select' },
          key: 'Enter',
        },
      });
      expect(timedOutLocator.isError).toBe(true);
      expect(JSON.stringify(timedOutLocator.content)).toContain('OPERATION_TIMEOUT');
      expect(JSON.stringify(timedOutLocator.content)).toContain('operationId');
      const sessionsAfterError = await client.callTool({
        name: 'browser_session_list',
        arguments: {},
      });
      expect(sessionsAfterError.isError).not.toBe(true);
      expect(JSON.stringify(sessionsAfterError.structuredContent)).toContain(buyerTarget.sessionId);
      expect(JSON.stringify(sessionsAfterError.structuredContent)).toContain(
        sellerTarget.sessionId,
      );
      const crossSession = await client.callTool({
        name: 'browser_get_url',
        arguments: { sessionId: buyerTarget.sessionId, pageId: sellerTarget.pageId },
      });
      expect(crossSession.isError).toBe(true);
      expect(JSON.stringify(crossSession.content)).toContain('PAGE_NOT_FOUND');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function readStructured(result: unknown): Readonly<Record<string, unknown>> {
  return z.object({ structuredContent: z.record(z.string(), z.unknown()) }).parse(result)
    .structuredContent;
}

function requireTarget(operation: Readonly<Record<string, unknown>>): {
  sessionId: string;
  pageId: string;
} {
  return z
    .object({ initialPage: z.object({ sessionId: z.string(), pageId: z.string() }) })
    .parse(operation).initialPage;
}

async function call(
  client: Client,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(`MCP tool ${name} failed`);
}
