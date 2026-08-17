import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * `tools/list` schemas must declare the JSON Schema dialect that MCP clients
 * actually validate against.
 *
 * The SDK converts registered Zod schemas without passing a target, so
 * `toJsonSchemaCompat` falls back to `draft-7` and every published
 * `inputSchema`/`outputSchema` declares the draft-07 dialect. Clients whose
 * validator only understands 2020-12 (Ajv 2020, used by Claude Code) reject the
 * whole tool, so the entire server becomes uncallable rather than degrading.
 *
 * Zod v4 emits byte-identical schema bodies for both targets across every
 * BrowserMesh contract, so only the dialect declaration has to be corrected.
 * `tests/unit/schema-dialect.test.ts` pins that equivalence: a future contract
 * using a construct that genuinely differs between the drafts fails there
 * instead of silently publishing a mislabelled schema.
 */
export const JSON_SCHEMA_2020_12_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const DRAFT_07_DIALECT = 'http://json-schema.org/draft-07/schema#';
const SCHEMA_KEYS = ['inputSchema', 'outputSchema'] as const;

/**
 * Publish every tool schema under the 2020-12 dialect by correcting the
 * outgoing `tools/list` result. Wrapping `connect` keeps the correction on the
 * single seam every transport goes through, so stdio and in-memory clients
 * observe the same contract.
 */
export function withDraft202012ToolSchemas(server: McpServer): McpServer {
  const connect = server.connect.bind(server);
  server.connect = async (transport: Transport): Promise<void> =>
    connect(draft202012Transport(transport));
  return server;
}

/**
 * Correct a JSON-RPC message in place of the raw SDK output. Anything that is
 * not a `tools/list` result is forwarded untouched.
 */
export function normalizeToolSchemaDialect<Message>(message: Message): Message {
  if (!isRecord(message)) return message;
  const result = message.result;
  if (!isRecord(result) || !Array.isArray(result.tools)) return message;
  return {
    ...message,
    result: { ...result, tools: result.tools.map(normalizeTool) },
  };
}

function draft202012Transport(transport: Transport): Transport {
  // A proxy forwards the mutable `onmessage`/`onclose`/`onerror` handles and any
  // future SDK transport member without restating the interface here.
  return new Proxy(transport, {
    get(target, property) {
      if (property === 'send') {
        return async (
          message: Parameters<Transport['send']>[0],
          options?: Parameters<Transport['send']>[1],
        ): Promise<void> => target.send(normalizeToolSchemaDialect(message), options);
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

function normalizeTool(tool: unknown): unknown {
  if (!isRecord(tool)) return tool;
  const normalized = { ...tool };
  for (const key of SCHEMA_KEYS) {
    const schema = normalized[key];
    if (isRecord(schema) && schema.$schema === DRAFT_07_DIALECT) {
      normalized[key] = { ...schema, $schema: JSON_SCHEMA_2020_12_DIALECT };
    }
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
