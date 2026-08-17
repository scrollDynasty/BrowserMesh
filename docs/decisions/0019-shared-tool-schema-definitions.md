# ADR 0019 — Shared tool-schema definitions

Status: accepted

Date: 2026-08-17

## Context

BrowserMesh publishes 38 tools. Their contracts share a small number of large
building blocks: the locator union, its bounded iframe chain, the element
target, and the URL matcher. The MCP SDK serializes every registered Zod schema
independently, so each block is re-expanded in full at every position it
occupies. `browser_action_and_wait` alone restates the locator union across its
action, wait, and event branches and accounts for 15% of the whole discovery
payload.

Measured against the built server, `tools/list` was 134,839 bytes, roughly
33,700 tokens. The official Playwright MCP server publishes 24 tools in 18,512
bytes. BrowserMesh was therefore 7.3 times more expensive to discover while
offering a comparable surface.

Discovery is paid once per session, in context, by every client. A client that
must fit several MCP servers into one window drops the most expensive server
rather than degrading it. Schema size is consequently an adoption property of
the product, not an implementation detail.

`browser_runtime_info` already reports effective limits, and ADR 0011 already
treats bounded responses as a contract concern. Bounding the contract itself is
the same principle applied to discovery.

## Decision

Hoist every repeated subschema of one published tool schema into that schema's
`$defs` and reference it with `$ref`.

The transform runs on the outgoing `tools/list` message, at the transport seam
introduced for the dialect correction (ADR 0018 follow-up, `schema-dialect.ts`).
`tool-schema-publication.ts` owns that seam and applies the dialect correction
and the compaction in one pass, so stdio and in-memory clients observe the same
contract. Registered Zod schemas, runtime validation, and every structured
result are untouched.

The transform is conservative by construction:

- it descends only into the JSON Schema 2020-12 applicator keywords that
  provably contain subschemas, so a value held by `const`, `enum`, or `default`
  can never be mistaken for a schema and replaced by a reference;
- it declines any schema already carrying `$ref`, `$id`, `$anchor`, or a dynamic
  reference, because relocating a subschema changes the base URI those resolve
  against;
- it compares whole nodes structurally, so a definition is byte-equivalent to
  every occurrence it replaces;
- it recounts occurrences after each hoist, so a child that only repeated
  because its parent did is not given a definition that costs more than it
  saves;
- it republishes the original schema unless the rewrite is genuinely smaller.

`BROWSERMESH_SCHEMA_REFS=false` publishes the expanded form for a client whose
validator cannot resolve references. The dialect correction is not optional
under that flag: a mislabelled schema makes a tool uncallable, whereas an
expanded one is merely large.

## Consequences

Published argument schemas shrink by 37.4% and result schemas by 12.7%, taking
`tools/list` from 134,839 to 105,241 bytes.

The remaining duplication is structural and cannot be removed this way. Each
tool's `inputSchema` is a separate JSON Schema document, so the locator union
that occurs across twenty tools cannot be shared between them; only repetition
_within_ one contract can be collapsed. Reducing the surface further is a
question of how many tools are published and how large each contract is, which
ADR 0020 takes up.

Two guarantees are held by tests rather than by review:

- `tests/unit/schema-compaction.test.ts` dereferences every published contract
  and asserts structural equality with the uncompacted form. If expanding every
  reference reproduces the input exactly, the two schemas accept exactly the
  same instances, which is a complete equivalence proof. It additionally
  compiles both forms with Ajv 2020, the validator Claude Code uses, and
  asserts they agree on accepted and rejected payloads.
- `tests/integration/mcp.test.ts` budgets the real discovery payload and asserts
  that every reference a client receives resolves inside the schema carrying it.

Signatures are cached on node identity because they are read once per node while
counting and again at every node while replacing; recomputing them would make
discovery quadratic in schema size on a request path.

## Alternatives considered

**Register pre-built JSON Schema instead of Zod.** The SDK owns the Zod-to-JSON
conversion, so emitting `$defs` at the source means bypassing `registerTool` and
losing the SDK's argument validation. The published-schema seam already exists
and applies to future contracts automatically.

**Shorten descriptions.** Descriptions are 9,957 bytes of 134,839. They are also
the part of the contract that drives correct model-driven tool selection
(AGENTS.md §22), so they are the wrong place to economise first.

**Drop `outputSchema` entirely.** Playwright MCP publishes none, which would
remove 52,600 bytes. It would also remove the client-side validation of
structured results that ADR 0008 introduced deliberately. ADR 0020 trims the
result contracts that carry no information instead.
