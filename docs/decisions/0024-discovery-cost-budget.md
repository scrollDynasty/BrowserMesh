# ADR 0024 — A discovery-cost budget for the published surface

Status: Proposed

Date: 2026-09-08

This ADR proposes changes to the published tool surface, including one that
conflicts with a current SPEC requirement. No code change accompanies it.

## Context

ADR 0019 shared repeated subschemas and ADR 0020 removed tools and echoed
arguments. Both were measured, both worked. Neither established what the number
should be, so there is no way to tell whether the surface is now acceptable.

Measured against `tools/list` on `master` at `aec6f25`, and against two other
browser MCP servers over stdio on the same machine on the same day:

| Server                       | Tools | `tools/list` JSON | Descriptions | Input schemas | Output schemas |
| ---------------------------- | ----: | ----------------: | -----------: | ------------: | -------------: |
| BrowserMesh, all profiles    |    35 |            87,259 |        9,555 |        36,831 |         30,827 |
| BrowserMesh, `--tools core`  |    31 |            79,394 |            — |             — |              — |
| `chrome-devtools-mcp@latest` |    29 |            25,130 |            — |             — |              — |
| `@playwright/mcp@latest`     |    24 |            18,477 |        1,721 |        13,629 |             48 |

BrowserMesh publishes 46% more tools than Playwright MCP and 4.7 times the
bytes. `--tools core` — the narrowest profile that can run a browser workflow —
still costs 4.3 times the full Playwright MCP surface. At roughly four characters
per token that is about 22,000 tokens of every client's context before a single
browser operation.

The composition matters more than the total:

- **Output schemas are 35% of the surface and are BrowserMesh's alone.**
  Playwright MCP publishes `{}` for every tool: 2 bytes each, 48 in total.
  BrowserMesh spends 30,827. Three session tools publish the full
  `sessionView` — including all of `contextSettings` — for 2,033 bytes each.
- **The locator union is paid 20 times.** `$defs` sharing is per tool; MCP has
  no cross-tool definitions. `browser_click` costs 1,739 bytes of input schema,
  and eighteen sibling element actions cost within 60 bytes of the same, almost
  all of it the same locator union restated.
- **Descriptions are 5.5 times Playwright MCP's.** Some of that is deliberate
  and correct — `browser_session_create` has to convey when a second session is
  required, which is the product. Some is repetition: "one explicitly addressed
  page" appears in 24 descriptions, and the `instructions` string already
  establishes it once per connection.

ADR 0022 has since added argument descriptions to the union-typed parameters,
taking the full surface to 93,775 and `core` to 85,910. That was the right call —
a union a client flattens during ingestion is unusable without prose — and it
moves the number the wrong way, which is the argument for fixing the ceiling
rather than reacting to each change on its own.

SPEC §22.2 requires every tool to advertise an `outputSchema`, which is why
ADR 0020 could not take the Playwright MCP route. That requirement is the single
largest line item in the table, and it has never been weighed against its price.

## Decision (proposed)

**A budget, checked by a test.** `tests/unit` asserts that the serialized
`tools/list` for `--tools core` stays under a committed ceiling. A change that
crosses it either finds the bytes elsewhere or moves the ceiling deliberately,
in a diff a reviewer sees. The number matters less than the fact that it stops
moving unobserved.

**Optional output schemas, on by default.**
`BROWSERMESH_OUTPUT_SCHEMAS=false` publishes tools without `outputSchema`.
Structured results are unchanged — `structuredContent` is still returned and
still matches the contract; only the advertisement is dropped. This needs a SPEC
§22.2 amendment, which is why it is proposed rather than done. It is worth about
30,827 bytes, 35% of the surface, for clients that do not validate against
published output schemas.

**A `minimal` profile.** `core` is 31 tools because it holds everything that is
not observability or persistence, including `browser_double_click`,
`browser_drag_and_drop`, `browser_scroll_into_view`, `browser_focus`, and both
history directions. A profile of roughly a dozen tools — sessions, pages,
navigate, snapshot, visible text, click, fill, press, screenshot, wait,
action-and-wait — covers the workflows the README leads with. `core` keeps its
current meaning; `minimal` is new, so nothing an operator configured changes.

**A description budget.** Cap tool descriptions at 400 characters, enforced by
the same test. Six tools exceed it today. The isolation rule those descriptions
repeat is stated once in `instructions`, which every client receives before the
first `tools/list`.

## Consequences

The `minimal` profile and the description cap are additive and cost nothing to
callers who do not opt in. The output-schema switch is not: a client that
validates results against the published schema and is started with the switch on
loses that check. That is why it defaults to on.

Committing a ceiling means routine additions can fail a test for being large.
That is the intent. A tool that cannot fit is a tool that belongs behind a
profile.

The comparison table above is a measurement of three servers on one day, not a
claim about their design. Playwright MCP omits output schemas and uses flat
string parameters; that is a different set of trade-offs, not a cheaper way to
make the same ones. BrowserMesh's typed locator union is a deliberate choice
that buys strict ambiguity errors and semantic targeting, and this ADR does not
propose giving it up.

## Alternatives considered

**Flatten the locator to strings, as Playwright MCP does.** `element` plus `ref`
as plain strings would take the element actions from 1,739 bytes to a few
hundred each, roughly 25,000 bytes across the surface. It also gives up
discriminated validation, the strict `LOCATOR_AMBIGUOUS` contract, and the
iframe chain. Rejected: that union is the contract, not the packaging.

**Publish output schemas only for tools whose results are not obvious.**
`{completed: true}` on nineteen element actions is 353 bytes each and carries no
information a caller could act on. Splitting the rule by tool makes "does this
tool advertise an output schema" a per-tool question a client cannot answer from
the protocol. Rejected in favour of one switch.

**Ship a second server binary with a lean surface.** Two artifacts, two release
paths, two sets of documentation, for something `--tools` already expresses.
