import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import * as z4mini from 'zod/v4-mini';
import { outputSchemas, type ToolName } from '../../src/adapters/mcp/contracts.js';
import { compactSchema, type JsonObject } from '../../src/adapters/mcp/schema-compaction.js';

describe('schema compaction', () => {
  it('publishes a schema that inlines back to the original, definition for definition', () => {
    // Structural equality after dereferencing is a complete equivalence proof:
    // if expanding every `$ref` reproduces the input exactly, the compacted
    // schema accepts exactly the same instances. Asserting it over every real
    // contract means a future tool cannot regress the guarantee unnoticed.
    for (const [name, schema] of Object.entries(outputSchemas)) {
      const original = publishedSchema(schema);

      const compacted = compactSchema(original);

      expect(dereference(compacted), `${name} round trip`).toEqual(original);
    }
  });

  it('keeps a real 2020-12 validator agreeing on accepted and rejected payloads', () => {
    // Dereferencing proves the schemas are equal on paper. This proves the
    // references actually resolve in Ajv 2020, the validator Claude Code uses,
    // so a client cannot reject the compact form the server publishes.
    const original = publishedSchema(outputSchemas.browser_snapshot);
    const compacted = compactSchema(original);
    const ajv = new Ajv2020({ strict: false });
    const validateOriginal = ajv.compile(original);
    const validateCompacted = ajv.compile(compacted);

    for (const instance of [snapshotResult(), { ...snapshotResult(), snapshot: 42 }, {}, null]) {
      expect(validateCompacted(instance)).toBe(validateOriginal(instance));
    }
    expect(validateOriginal(snapshotResult())).toBe(true);
  });

  it('materially shrinks the published contract surface', () => {
    const originalBytes = totalBytes((schema) => schema);
    const compactedBytes = totalBytes(compactSchema);

    // Sharing is bounded by what one contract repeats internally: each tool
    // schema is its own JSON Schema document, so the locator union that occurs
    // across twenty tools cannot be shared between them. This floor is modest
    // on purpose. Result contracts no longer restate the request (ADR 0020), so
    // most of what used to repeat here is simply gone; argument schemas are
    // where sharing pays, and their guard is the payload budget in the MCP
    // integration suite.
    expect(compactedBytes).toBeLessThan(originalBytes * 0.95);
  });

  it('shares the repeated bounds of the largest result contract', () => {
    // `browser_snapshot` reports applied bounds, omissions, pagination, and
    // truncation, several of which repeat the same bounded-integer shape. It is
    // the largest result contract BrowserMesh publishes.
    const original = publishedSchema(outputSchemas.browser_snapshot);

    const compacted = compactSchema(original);

    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(original).length * 0.85);
  });

  it('produces identical output for identical input', () => {
    const original = publishedSchema(outputSchemas.browser_action_and_wait);

    expect(JSON.stringify(compactSchema(original))).toBe(JSON.stringify(compactSchema(original)));
  });

  it('returns the input untouched when nothing repeats', () => {
    const schema: JsonObject = {
      type: 'object',
      properties: { sessionId: { type: 'string' }, count: { type: 'integer' } },
    };

    expect(compactSchema(schema)).toBe(schema);
  });

  it('never publishes a larger schema than it received', () => {
    // Two tiny repeated nodes cost more as references than they save inline.
    const schema: JsonObject = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    };

    expect(JSON.stringify(compactSchema(schema)).length).toBeLessThanOrEqual(
      JSON.stringify(schema).length,
    );
  });

  it('refuses to relocate subschemas when references already resolve positionally', () => {
    for (const unsafe of ['$ref', '$id', '$anchor', '$dynamicRef', '$dynamicAnchor']) {
      const shared = repeatedBody();
      const schema: JsonObject = {
        type: 'object',
        properties: {
          first: { ...shared, [unsafe]: '#/$defs/thing' },
          second: { ...shared, [unsafe]: '#/$defs/thing' },
        },
      };

      // Hoisting would change the base URI these resolve against, so the
      // schema is republished exactly as received rather than guessed at.
      expect(compactSchema(schema), unsafe).toBe(schema);
    }
  });

  it('treats compaction as a one-way transform', () => {
    const original = publishedSchema(outputSchemas.browser_click);
    const compacted = compactSchema(original);

    // The output carries `$ref`, so a second pass declines it rather than
    // rewriting references whose resolution it cannot reason about.
    expect(compactSchema(compacted)).toBe(compacted);
  });

  it('does not mistake data for a schema', () => {
    // `const`, `enum`, and `default` hold instance values. An object sitting in
    // one of them may look exactly like a repeated subschema; descending into
    // it and replacing it with a `$ref` would turn a literal the client must
    // match into a reference, silently corrupting the contract. The containing
    // subschemas are kept distinct so that only the data can repeat.
    const value = { type: 'string', minLength: 1, description: 'x'.repeat(200) };
    const schema: JsonObject = {
      type: 'object',
      properties: {
        first: { const: value, title: 'first' },
        second: { const: value, title: 'second' },
        third: { enum: [value], title: 'third' },
        fourth: { default: value, title: 'fourth' },
      },
    };

    const compacted = compactSchema(schema);

    // Nothing repeats once the data is off limits, so the schema is untouched.
    expect(compacted).toBe(schema);
    expect(JSON.stringify(compacted)).not.toContain('$ref');
  });

  it('keeps definitions the source schema already declared', () => {
    const schema: JsonObject = {
      type: 'object',
      $defs: { shared0: { type: 'string', description: 'pre-existing' } },
      properties: { first: repeatedBody(), second: repeatedBody() },
    };

    const compacted = compactSchema(schema);

    const definitions = compacted.$defs as Record<string, JsonObject>;
    expect(definitions.shared0).toEqual({ type: 'string', description: 'pre-existing' });
    // The new definition had to claim a name that was not already taken.
    expect(Object.keys(definitions).length).toBe(2);
    const body = { ...schema };
    delete body.$defs;
    expect(dereference(compacted)).toEqual(body);
  });

  it('shares subschemas reached through the draft-07 tuple form of items', () => {
    const schema: JsonObject = {
      type: 'object',
      properties: {
        pair: { type: 'array', items: [repeatedBody(), repeatedBody()] },
      },
    };

    const compacted = compactSchema(schema);

    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(schema).length);
    expect(dereference(compacted)).toEqual(schema);
  });

  it('shares a subschema that repeats at different depths', () => {
    const schema: JsonObject = {
      type: 'object',
      properties: {
        direct: repeatedBody(),
        nested: { type: 'object', properties: { inner: repeatedBody() } },
        listed: { anyOf: [repeatedBody(), { type: 'null' }] },
      },
    };

    const compacted = compactSchema(schema);

    expect(dereference(compacted)).toEqual(schema);
    expect(JSON.stringify(compacted)).toContain('#/$defs/');
  });
});

/** A body large enough that sharing it beats restating it. */
function repeatedBody(): JsonObject {
  return {
    type: 'object',
    properties: {
      strategy: { type: 'string', enum: ['role', 'text', 'label', 'placeholder', 'css'] },
      value: { type: 'string', minLength: 1, maxLength: 2_000 },
    },
    required: ['strategy', 'value'],
  };
}

function snapshotResult(): JsonObject {
  return {
    operationId: 'op-1',
    sessionId: 'session-1',
    pageId: 'page-1',
    snapshot: '- button "Save"',
    contentFormat: 'aria-yaml',
    partial: false,
    refs: [],
    appliedBounds: {
      scope: null,
      maxDepth: null,
      includeBoundingBoxes: false,
      maxChars: 20_000,
      maxBytes: 65_536,
      includeRefs: false,
      maxRefs: 50,
      interactiveOnly: false,
      maxChildren: null,
    },
    omissions: { nonInteractiveNodes: 0, maxChildrenNodes: 0, sourceLimitReached: false },
    pagination: { snapshotId: null, nextCursor: null, offsetChars: 0, expiresAt: null },
    truncation: {
      truncated: false,
      byMaxChars: false,
      byMaxBytes: false,
      originalChars: 15,
      originalBytes: 15,
      returnedChars: 15,
      returnedBytes: 15,
    },
  };
}

function totalBytes(transform: (schema: JsonObject) => JsonObject): number {
  return Object.values(outputSchemas).reduce(
    (bytes, schema) => bytes + JSON.stringify(transform(publishedSchema(schema))).length,
    0,
  );
}

function publishedSchema(schema: (typeof outputSchemas)[ToolName]): JsonObject {
  return z4mini.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
}

/** Expand every `$ref` back into place and drop the definitions they came from. */
function dereference(schema: JsonObject): JsonObject {
  const definitions = (schema.$defs ?? {}) as Record<string, JsonObject>;
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expand);
    if (typeof value !== 'object' || value === null) return value;
    const node = value as JsonObject;
    const reference = node.$ref;
    if (typeof reference === 'string') {
      const name = reference.replace('#/$defs/', '');
      const target = definitions[name];
      if (target === undefined) throw new Error(`unresolved reference ${reference}`);
      return expand(target);
    }
    return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, expand(entry)]));
  };
  const body = expand(schema) as JsonObject;
  delete body.$defs;
  return body;
}
