import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it } from 'vitest';
import * as z4mini from 'zod/v4-mini';
import { outputSchemas } from '../../src/adapters/mcp/contracts.js';
import {
  JSON_SCHEMA_2020_12_DIALECT,
  normalizeToolSchemaDialect,
  withDraft202012ToolSchemas,
} from '../../src/adapters/mcp/schema-dialect.js';

const DRAFT_07_DIALECT = 'http://json-schema.org/draft-07/schema#';

describe('tool schema dialect', () => {
  it('publishes every contract under a dialect the schema body actually matches', () => {
    // The SDK serializes registered Zod schemas with the draft-7 target, so
    // relabelling is only sound while both targets produce the same body.
    for (const [name, schema] of Object.entries(outputSchemas)) {
      const draft07 = z4mini.toJSONSchema(schema, { target: 'draft-7', io: 'output' });
      const draft202012 = z4mini.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
      expect(draft07.$schema, `${name} draft-7 dialect`).toBe(DRAFT_07_DIALECT);
      expect(draft202012.$schema, `${name} 2020-12 dialect`).toBe(JSON_SCHEMA_2020_12_DIALECT);
      expect(withoutDialect(draft07), `${name} body`).toEqual(withoutDialect(draft202012));
    }
  });

  it('relabels draft-07 input and output schemas in a tools/list result', () => {
    const message = toolListMessage(DRAFT_07_DIALECT, DRAFT_07_DIALECT);

    const normalized = normalizeToolSchemaDialect(message);

    const [tool] = normalized.result.tools;
    expect(tool?.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12_DIALECT);
    expect(tool?.outputSchema.$schema).toBe(JSON_SCHEMA_2020_12_DIALECT);
    expect(tool?.inputSchema.properties).toEqual({ sessionId: { type: 'string' } });
    expect(tool?.name).toBe('browser_session_create');
  });

  it('leaves the original message untouched so retries keep the caller payload', () => {
    const message = toolListMessage(DRAFT_07_DIALECT, DRAFT_07_DIALECT);

    normalizeToolSchemaDialect(message);

    expect(message.result.tools[0]?.inputSchema.$schema).toBe(DRAFT_07_DIALECT);
  });

  it('keeps schemas that already declare a supported dialect', () => {
    const message = toolListMessage(JSON_SCHEMA_2020_12_DIALECT, JSON_SCHEMA_2020_12_DIALECT);

    const normalized = normalizeToolSchemaDialect(message);

    expect(normalized.result.tools[0]?.outputSchema.$schema).toBe(JSON_SCHEMA_2020_12_DIALECT);
  });

  it('forwards messages that carry no tool list', () => {
    const progress = { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } };

    expect(normalizeToolSchemaDialect(progress)).toEqual(progress);
    expect(normalizeToolSchemaDialect({ jsonrpc: '2.0', id: 1, result: {} })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    });
    expect(normalizeToolSchemaDialect(null)).toBeNull();
  });

  it('corrects the dialect on whichever transport the server is connected to', async () => {
    const sent: unknown[] = [];
    const transport = fakeTransport(sent);
    let connected: Transport | undefined;
    const server = withDraft202012ToolSchemas({
      connect: (candidate: Transport) => {
        connected = candidate;
        return Promise.resolve();
      },
    } as unknown as McpServer);

    await server.connect(transport);
    await connected?.send(toolListMessage(DRAFT_07_DIALECT, DRAFT_07_DIALECT) as never);

    expect(sent).toHaveLength(1);
    expect(schemaDialectOf(sent[0])).toBe(JSON_SCHEMA_2020_12_DIALECT);
  });

  it('keeps transport members reachable through the wrapper', async () => {
    const sent: unknown[] = [];
    const transport = fakeTransport(sent);
    let connected: Transport | undefined;
    const server = withDraft202012ToolSchemas({
      connect: (candidate: Transport) => {
        connected = candidate;
        return Promise.resolve();
      },
    } as unknown as McpServer);

    await server.connect(transport);
    const handler = (): void => undefined;
    if (connected) connected.onclose = handler;
    await connected?.start();

    // The SDK assigns handlers and calls methods on the transport it received;
    // both have to reach the real transport, not the wrapper.
    expect(transport.onclose).toBe(handler);
    expect(transport.started).toBe(true);
    expect(connected?.sessionId).toBe('fake-session');
  });
});

function withoutDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const body = { ...schema };
  delete body.$schema;
  return body;
}

function toolListMessage(
  inputDialect: string,
  outputDialect: string,
): {
  jsonrpc: string;
  id: number;
  result: {
    tools: {
      name: string;
      inputSchema: Record<string, unknown>;
      outputSchema: Record<string, unknown>;
    }[];
  };
} {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        {
          name: 'browser_session_create',
          inputSchema: {
            $schema: inputDialect,
            type: 'object',
            properties: { sessionId: { type: 'string' } },
          },
          outputSchema: { $schema: outputDialect, type: 'object' },
        },
      ],
    },
  };
}

function schemaDialectOf(message: unknown): unknown {
  const result = (message as { result: { tools: { outputSchema: { $schema: unknown } }[] } })
    .result;
  return result.tools[0]?.outputSchema.$schema;
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
