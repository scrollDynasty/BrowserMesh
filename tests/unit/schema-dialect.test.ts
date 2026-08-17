import { describe, expect, it } from 'vitest';
import * as z4mini from 'zod/v4-mini';
import { outputSchemas } from '../../src/adapters/mcp/contracts.js';
import {
  JSON_SCHEMA_2020_12_DIALECT,
  withPublishedDialect,
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

  it('relabels a draft-07 schema and leaves its body alone', () => {
    const schema = {
      $schema: DRAFT_07_DIALECT,
      type: 'object',
      properties: { sessionId: { type: 'string' } },
    };

    const published = withPublishedDialect(schema);

    expect(published.$schema).toBe(JSON_SCHEMA_2020_12_DIALECT);
    expect(published.properties).toEqual({ sessionId: { type: 'string' } });
    // The caller's object is reused on retries, so it must not be mutated.
    expect(schema.$schema).toBe(DRAFT_07_DIALECT);
  });

  it('keeps a schema that already declares a supported dialect', () => {
    const schema = { $schema: JSON_SCHEMA_2020_12_DIALECT, type: 'object' };

    expect(withPublishedDialect(schema)).toBe(schema);
  });

  it('leaves a schema that declares no dialect at all', () => {
    const schema = { type: 'object' };

    expect(withPublishedDialect(schema)).toBe(schema);
  });
});

function withoutDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const body = { ...schema };
  delete body.$schema;
  return body;
}
