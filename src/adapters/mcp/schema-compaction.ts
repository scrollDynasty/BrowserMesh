/**
 * BrowserMesh publishes 38 tools whose contracts share a small number of large
 * building blocks: the locator union, its bounded iframe chain, the URL matcher,
 * and the element target. The MCP SDK serializes every registered Zod schema
 * independently, so each of those blocks is re-expanded in full at every
 * position it occurs. One `browser_action_and_wait` contract restates the
 * locator union six times.
 *
 * The cost is paid by the client, once per session, in context: an uncompacted
 * `tools/list` is roughly 135 KB. Clients that must fit several MCP servers in
 * one context window drop the most expensive server, so schema size is an
 * adoption property rather than a micro-optimisation.
 *
 * JSON Schema 2020-12 already has the mechanism for this. Hoisting each repeated
 * subschema into `$defs` and referencing it with `$ref` leaves the set of valid
 * instances untouched while removing the duplication. See ADR 0019.
 *
 * The transform is deliberately conservative:
 *
 * - it traverses only the applicator keywords that provably contain subschemas,
 *   so a `const`, `enum`, or `default` value can never be mistaken for a schema;
 * - it refuses to touch a schema that already carries `$ref`, `$id`, `$anchor`,
 *   or a dynamic reference, because relocating a subschema changes how those
 *   resolve;
 * - it compares whole nodes structurally, so a hoisted definition is
 *   byte-equivalent to every occurrence it replaces;
 * - it returns the original schema unless the rewrite is genuinely smaller.
 */

/** Keywords whose value is a single subschema. */
const SINGLE_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

/** Keywords whose value is an array of subschemas. */
const LIST_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
]);

/** Keywords whose value maps names to subschemas. */
const MAP_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

/**
 * Relocating a subschema changes the base URI it resolves against, so a schema
 * carrying any of these is republished untouched rather than guessed at.
 */
const RELOCATION_UNSAFE_KEYWORDS: readonly string[] = [
  '$anchor',
  '$dynamicAnchor',
  '$dynamicRef',
  '$id',
  '$recursiveAnchor',
  '$recursiveRef',
  '$ref',
];

const DEFINITION_NAME_PREFIX = 'shared';

/**
 * Upper bound on hoisted definitions. Every iteration strictly reduces
 * duplicated content, so the loop terminates on its own; this only stops a
 * pathological contract from spending unbounded time on `tools/list`.
 */
const MAX_DEFINITIONS = 64;

export type JsonObject = Record<string, unknown>;

interface Occurrence {
  readonly node: JsonObject;
  readonly serializedLength: number;
  count: number;
}

/**
 * Hoist every repeated subschema of one published tool schema into `$defs`.
 *
 * Returns the input unchanged when compaction is unsound, finds nothing worth
 * sharing, or would not actually reduce the serialized size.
 */
export function compactSchema(schema: JsonObject): JsonObject {
  if (containsRelocationUnsafeKeyword(schema)) return schema;

  const existingDefinitions = isJsonObject(schema.$defs) ? schema.$defs : {};
  const definitions: JsonObject = { ...existingDefinitions };
  const reservedNames = new Set(Object.keys(existingDefinitions));
  let body: JsonObject = withoutDefinitions(schema);
  let nameIndex = 0;

  // Hoisting a subschema changes how often its own children still repeat: once
  // the locator union is shared, the role enum inside it exists in exactly one
  // place and no longer earns a definition. Recounting after each hoist is what
  // keeps the result from filling `$defs` with entries that cost more than they
  // save, so the loop takes one definition at a time instead of choosing a
  // whole set up front.
  for (let hoisted = 0; hoisted < MAX_DEFINITIONS; hoisted += 1) {
    const documents = [body, ...Object.values(definitions).filter(isJsonObject)];
    const occurrences = new Map<string, Occurrence>();
    for (const document of documents) collectOccurrences(document, occurrences, true);

    let name = `${DEFINITION_NAME_PREFIX}${String(nameIndex)}`;
    while (reservedNames.has(name)) {
      nameIndex += 1;
      name = `${DEFINITION_NAME_PREFIX}${String(nameIndex)}`;
    }

    const best = bestCandidate(occurrences, name);
    if (best === undefined) break;

    reservedNames.add(name);
    nameIndex += 1;
    const reference: JsonObject = { $ref: `#/$defs/${name}` };
    // The new body keeps its own shape; only occurrences elsewhere collapse.
    definitions[name] = replaceOccurrences(best.node, best.signature, reference, true);
    for (const [existing, definition] of Object.entries(definitions)) {
      if (existing === name || !isJsonObject(definition)) continue;
      definitions[existing] = replaceOccurrences(definition, best.signature, reference, true);
    }
    body = replaceOccurrences(body, best.signature, reference, true);
  }

  if (Object.keys(definitions).length === Object.keys(existingDefinitions).length) return schema;

  const compacted: JsonObject = { ...body, $defs: definitions };
  return serializedLength(compacted) < serializedLength(schema) ? compacted : schema;
}

/**
 * The repeated subschema whose removal frees the most bytes, or `undefined`
 * when no candidate pays for the definition it would need.
 *
 * Ties break on the signature so the published contract, and therefore the
 * definition names a client caches, stay stable across runs.
 */
function bestCandidate(
  occurrences: ReadonlyMap<string, Occurrence>,
  name: string,
): (Occurrence & { readonly signature: string }) | undefined {
  let best: (Occurrence & { readonly signature: string; readonly saving: number }) | undefined;
  for (const [signature, occurrence] of occurrences) {
    if (occurrence.count < 2) continue;
    const saving = savingOf(occurrence, name);
    if (saving <= 0) continue;
    if (
      best === undefined ||
      saving > best.saving ||
      // Ordered by code unit rather than `localeCompare`, whose result depends
      // on the runner's locale and ICU build. Definition names are supposed to
      // be stable across runs, and a locale-sensitive tie-break is not.
      (saving === best.saving && signature < best.signature)
    )
      best = { ...occurrence, signature, saving };
  }
  return best;
}

/** Bytes removed by replacing every occurrence of one subschema with a reference. */
function savingOf(occurrence: Occurrence, name: string): number {
  const referenceLength = `{"$ref":"#/$defs/${name}"}`.length;
  const entryLength = `${JSON.stringify(name)}:`.length + occurrence.serializedLength;
  const before = occurrence.count * occurrence.serializedLength;
  const after = occurrence.count * referenceLength + entryLength;
  return before - after;
}

/** Replace every subschema matching `signature` below `node` with `reference`. */
function replaceOccurrences(
  node: JsonObject,
  signature: string,
  reference: JsonObject,
  isRoot: boolean,
): JsonObject {
  if (!isRoot && signatureOf(node) === signature) return { ...reference };

  const replaced: JsonObject = {};
  const replaceChild = (value: unknown): unknown =>
    isJsonObject(value) ? replaceOccurrences(value, signature, reference, false) : value;

  for (const [keyword, value] of Object.entries(node)) {
    if (SINGLE_SUBSCHEMA_KEYWORDS.has(keyword)) {
      // draft-07 allows a tuple form of `items`; 2020-12 uses `prefixItems`.
      replaced[keyword] = Array.isArray(value) ? value.map(replaceChild) : replaceChild(value);
    } else if (LIST_SUBSCHEMA_KEYWORDS.has(keyword) && Array.isArray(value)) {
      replaced[keyword] = value.map(replaceChild);
    } else if (MAP_SUBSCHEMA_KEYWORDS.has(keyword) && isJsonObject(value)) {
      replaced[keyword] = Object.fromEntries(
        Object.entries(value).map(([entryName, entry]) => [entryName, replaceChild(entry)]),
      );
    } else {
      replaced[keyword] = value;
    }
  }
  return replaced;
}

function withoutDefinitions(schema: JsonObject): JsonObject {
  if (!('$defs' in schema)) return schema;
  const body = { ...schema };
  delete body.$defs;
  return body;
}

/**
 * Count how often each subschema shape occurs.
 *
 * The root is never counted: it is the document itself and cannot be replaced
 * by a reference to one of its own definitions.
 */
function collectOccurrences(
  node: JsonObject,
  occurrences: Map<string, Occurrence>,
  isRoot: boolean,
): void {
  if (!isRoot) {
    const signature = signatureOf(node);
    const existing = occurrences.get(signature);
    if (existing === undefined)
      occurrences.set(signature, {
        node,
        serializedLength: serializedLength(node),
        count: 1,
      });
    else existing.count += 1;
  }
  for (const child of subschemasOf(node)) collectOccurrences(child, occurrences, false);
}

/** Every subschema directly below `node`, following applicator keywords only. */
function* subschemasOf(node: JsonObject): Generator<JsonObject> {
  for (const [keyword, value] of Object.entries(node)) {
    if (SINGLE_SUBSCHEMA_KEYWORDS.has(keyword)) {
      if (Array.isArray(value)) yield* value.filter(isJsonObject);
      else if (isJsonObject(value)) yield value;
    } else if (LIST_SUBSCHEMA_KEYWORDS.has(keyword) && Array.isArray(value)) {
      yield* value.filter(isJsonObject);
    } else if (MAP_SUBSCHEMA_KEYWORDS.has(keyword) && isJsonObject(value)) {
      yield* Object.values(value).filter(isJsonObject);
    }
  }
}

/**
 * Whether anything anywhere in the document would make relocation unsound.
 *
 * This walks the whole tree rather than only the applicator keywords the
 * rewriter follows. The rewriter can afford to be narrow because a position it
 * does not visit is a position it cannot move; the guard cannot, because a
 * keyword it fails to notice is one it fails to be warned by. draft-07
 * `dependencies` is the concrete case: it may hold subschemas, the rewriter
 * deliberately ignores it, and an `$id` inside one would have gone unseen.
 *
 * Scanning values as well as keywords can only cause a false alarm, and a false
 * alarm costs nothing but the compaction.
 */
function containsRelocationUnsafeKeyword(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRelocationUnsafeKeyword);
  if (!isJsonObject(value)) return false;
  if (RELOCATION_UNSAFE_KEYWORDS.some((keyword) => keyword in value)) return true;
  return Object.values(value).some(containsRelocationUnsafeKeyword);
}

/**
 * A key-order-independent identity for one schema node.
 *
 * Two nodes with the same signature accept exactly the same instances, so one
 * may stand in for the other. Ordering is only used for comparison; the body
 * that gets published is always the original node.
 */
function signatureOf(value: unknown): string {
  // A property explicitly set to `undefined` serializes to nothing at all, so
  // it is named here rather than allowed to collide with an absent key.
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);

  // Signatures are read once per node while counting and again at every node
  // while replacing, on each of up to `MAX_DEFINITIONS` passes. Computing them
  // afresh would make the whole transform quadratic in schema size on a request
  // path. Nodes are never mutated, so caching on identity is sound; rewritten
  // passes allocate new objects and the old entries fall out on their own.
  const cached = signatureCache.get(value);
  if (cached !== undefined) return cached;

  const signature = Array.isArray(value)
    ? `[${value.map(signatureOf).join(',')}]`
    : `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${signatureOf((value as JsonObject)[key])}`)
        .join(',')}}`;
  signatureCache.set(value, signature);
  return signature;
}

const signatureCache = new WeakMap<object, string>();

function serializedLength(value: JsonObject): number {
  return JSON.stringify(value).length;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
