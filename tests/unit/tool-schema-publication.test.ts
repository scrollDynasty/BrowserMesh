import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it } from 'vitest';
import { JSON_SCHEMA_2020_12_DIALECT } from '../../src/adapters/mcp/schema-dialect.js';
import {
  publishToolSchemas,
  withPublishedToolSchemas,
  type ToolSchemaPublicationOptions,
} from '../../src/adapters/mcp/tool-schema-publication.js';

const DRAFT_07_DIALECT = 'http://json-schema.org/draft-07/schema#';

describe('published tool schemas', () => {
  it('corrects the dialect and shares repeated subschemas in one pass', () => {
    const published = publishToolSchemas(toolListMessage());

    const [tool] = published.result.tools;
    expect(tool?.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12_DIALECT);
    expect(JSON.stringify(tool?.inputSchema)).toContain('#/$defs/');
    expect(JSON.stringify(tool?.inputSchema).length).toBeLessThan(
      JSON.stringify(toolListMessage().result.tools[0]?.inputSchema).length,
    );
  });

  it('publishes the expanded form when a client cannot resolve references', () => {
    const published = publishToolSchemas(toolListMessage(), {
      shareRepeatedSubschemas: false,
    });

    const [tool] = published.result.tools;
    // The dialect correction is not optional: without it the whole tool is
    // rejected rather than merely restated at full size.
    expect(tool?.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12_DIALECT);
    expect(JSON.stringify(tool?.inputSchema)).not.toContain('$ref');
  });

  it('leaves the original message untouched so retries keep the caller payload', () => {
    const message = toolListMessage();

    publishToolSchemas(message);

    expect(message.result.tools[0]?.inputSchema.$schema).toBe(DRAFT_07_DIALECT);
    expect(JSON.stringify(message)).not.toContain('$ref');
  });

  it('forwards messages that carry no tool list', () => {
    const progress = { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } };

    expect(publishToolSchemas(progress)).toEqual(progress);
    expect(publishToolSchemas(null)).toBeNull();
  });

  it('applies the corrections on whichever transport the server is connected to', async () => {
    const sent: unknown[] = [];
    const transport = fakeTransport(sent);
    const { server, connected } = wrappedServer();

    await server.connect(transport);
    await connected()?.send(toolListMessage() as never);

    expect(sent).toHaveLength(1);
    expect(schemaDialectOf(sent[0])).toBe(JSON_SCHEMA_2020_12_DIALECT);
  });

  it('keeps transport members reachable through the wrapper', async () => {
    const sent: unknown[] = [];
    const transport = fakeTransport(sent);
    const { server, connected } = wrappedServer();

    await server.connect(transport);
    const handler = (): void => undefined;
    const wrapper = connected();
    if (wrapper) wrapper.onclose = handler;
    await wrapper?.start();

    // The SDK assigns handlers and calls methods on the transport it received;
    // both have to reach the real transport, not the wrapper.
    expect(transport.onclose).toBe(handler);
    expect(transport.started).toBe(true);
    expect(wrapper?.sessionId).toBe('fake-session');
  });
});

function wrappedServer(options: ToolSchemaPublicationOptions = {}): {
  server: McpServer;
  connected: () => Transport | undefined;
} {
  let received: Transport | undefined;
  const server = withPublishedToolSchemas(
    {
      connect: (candidate: Transport) => {
        received = candidate;
        return Promise.resolve();
      },
    } as unknown as McpServer,
    options,
  );
  return { server, connected: () => received };
}

/** A discovery result whose argument schema restates one selector twice. */
function toolListMessage(): {
  jsonrpc: string;
  id: number;
  result: {
    tools: { name: string; inputSchema: Record<string, unknown> }[];
  };
} {
  const selector = {
    type: 'object',
    properties: {
      strategy: { type: 'string', enum: ['role', 'text', 'label', 'placeholder', 'css'] },
      value: { type: 'string', minLength: 1, maxLength: 2_000 },
    },
    required: ['strategy', 'value'],
  };
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        {
          name: 'browser_drag_and_drop',
          inputSchema: {
            $schema: DRAFT_07_DIALECT,
            type: 'object',
            properties: { source: selector, target: selector },
          },
        },
      ],
    },
  };
}

function schemaDialectOf(message: unknown): unknown {
  const result = (message as { result: { tools: { inputSchema: { $schema: unknown } }[] } }).result;
  return result.tools[0]?.inputSchema.$schema;
}

function fakeTransport(sent: unknown[]): Transport & { started: boolean } {
  return {
    started: false,
    sessionId: 'fake-session',
    start(): Promise<void> {
      this.started = true;
      return Promise.resolve();
    },
    send(message: unknown): Promise<void> {
      sent.push(message);
      return Promise.resolve();
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}
