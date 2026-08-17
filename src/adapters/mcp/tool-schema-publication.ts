import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { compactSchema, type JsonObject } from './schema-compaction.js';
import { normalizeToolSchemaDialect } from './schema-dialect.js';

/**
 * `tools/list` is the one message whose published schemas differ from what the
 * MCP SDK serializes on its own. Two corrections are needed, and both have to
 * apply to every transport, so they share this single outgoing seam:
 *
 * 1. the declared JSON Schema dialect must match what clients validate against
 *    (`schema-dialect.ts`);
 * 2. repeated subschemas are hoisted into `$defs` so the payload stays small
 *    enough to sit alongside other MCP servers in one context window
 *    (`schema-compaction.ts`).
 *
 * Wrapping `connect` rather than the individual request handler keeps stdio and
 * in-memory clients observing the same contract.
 */

const SCHEMA_KEYS = ['inputSchema', 'outputSchema'] as const;

export interface ToolSchemaPublicationOptions {
  /**
   * Share repeated subschemas through `$defs`/`$ref`. On by default. Set this
   * to `false` for a client whose validator cannot resolve references; the
   * published schemas stay semantically identical, only larger.
   */
  readonly shareRepeatedSubschemas?: boolean;
}

export function withPublishedToolSchemas(
  server: McpServer,
  options: ToolSchemaPublicationOptions = {},
): McpServer {
  const connect = server.connect.bind(server);
  server.connect = async (transport: Transport): Promise<void> =>
    connect(publishingTransport(transport, options));
  return server;
}

/** Apply every published-schema correction to one outgoing JSON-RPC message. */
export function publishToolSchemas<Message>(
  message: Message,
  options: ToolSchemaPublicationOptions = {},
): Message {
  const withDialect = normalizeToolSchemaDialect(message);
  if (options.shareRepeatedSubschemas === false) return withDialect;
  return mapToolSchemas(withDialect, compactSchema);
}

function mapToolSchemas<Message>(
  message: Message,
  transform: (schema: JsonObject) => JsonObject,
): Message {
  if (!isRecord(message)) return message;
  const result = message.result;
  if (!isRecord(result) || !Array.isArray(result.tools)) return message;
  return {
    ...message,
    result: {
      ...result,
      tools: result.tools.map((tool: unknown) => mapTool(tool, transform)),
    },
  };
}

function mapTool(tool: unknown, transform: (schema: JsonObject) => JsonObject): unknown {
  if (!isRecord(tool)) return tool;
  const mapped = { ...tool };
  for (const key of SCHEMA_KEYS) {
    const schema = mapped[key];
    if (isRecord(schema)) mapped[key] = transform(schema);
  }
  return mapped;
}

function publishingTransport(
  transport: Transport,
  options: ToolSchemaPublicationOptions,
): Transport {
  // A proxy forwards the mutable `onmessage`/`onclose`/`onerror` handles and any
  // future SDK transport member without restating the interface here.
  return new Proxy(transport, {
    get(target, property) {
      if (property === 'send') {
        return async (
          message: Parameters<Transport['send']>[0],
          sendOptions?: Parameters<Transport['send']>[1],
        ): Promise<void> => target.send(publishToolSchemas(message, options), sendOptions);
      }
      const value: unknown = Reflect.get(target, property, target);
      // Bound to the transport so methods keep reaching their private fields.
      return typeof value === 'function'
        ? (value as (...args: readonly unknown[]) => unknown).bind(target)
        : value;
    },
    set(target, property, value: unknown) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
