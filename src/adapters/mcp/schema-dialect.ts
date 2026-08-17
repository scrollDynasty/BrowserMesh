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
 *
 * The declared dialect also has to be accurate for `schema-compaction.ts` to be
 * sound: `$ref` alongside sibling keywords is 2020-12 behaviour.
 * `tool-schema-publication.ts` owns the transport seam both corrections share.
 */
export const JSON_SCHEMA_2020_12_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const DRAFT_07_DIALECT = 'http://json-schema.org/draft-07/schema#';

/**
 * Relabel one published schema, leaving a schema that already declares a
 * supported dialect alone.
 *
 * A per-schema transform rather than a per-message one: `tool-schema-publication.ts`
 * walks the tool list once and applies every correction to each schema it finds,
 * so the traversal is not repeated per transform.
 */
export function withPublishedDialect(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.$schema !== DRAFT_07_DIALECT) return schema;
  return { ...schema, $schema: JSON_SCHEMA_2020_12_DIALECT };
}
