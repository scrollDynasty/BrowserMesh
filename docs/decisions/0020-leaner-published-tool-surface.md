# ADR 0020 — Leaner published tool surface

Status: accepted

Date: 2026-08-17

## Context

ADR 0019 shared repeated subschemas inside each published contract and took
`tools/list` from 134,839 to 105,241 bytes. The remaining weight is not
duplication a mechanical transform can reach. It is the surface itself: how many
tools are published, and how much each contract states.

Three specific costs were measured against the built server:

- Four observability tools — `browser_console_list`, `browser_page_errors_list`,
  `browser_network_list`, `browser_failed_requests_list` — published four
  byte-identical result contracts and two near-identical argument contracts, for
  12,432 bytes of result schema alone. They differ only in which event kind they
  select.
- `browser_action_and_wait` and `browser_wait` echoed their own arguments back in
  their results, putting the whole locator union on the result side of the two
  largest contracts: 4,828 and 2,871 bytes.
- Every client paid for persistence and observability contracts whether or not
  the workflow used them.

SPEC §22.2 requires that every tool advertise an `outputSchema`, so removing
result contracts wholesale — as Playwright MCP does — is not available.

## Decision

**One observation tool.** `browser_observe` takes a `source` of `console`,
`pageError`, `network`, or `requestFailed` and returns the shared contract with
`source` echoed, because a caller reading several sources into one buffer cannot
otherwise tell the pages of results apart. The runtime keeps a reader per source;
only the published contract is shared.

`includeText` is rejected for the two network sources instead of being ignored.
A caller that asked for evidence should learn that none was available rather
than receive a metadata-only answer that looks complete. The check lives in the
input schema, not the handler, so the SDK reports it as an input-validation
error naming the offending field; a `BrowserMeshError` would reach the client as
the fixed, deliberately uninformative `INVALID_ARGUMENT` message, which cannot
say which argument was wrong.

**Results stop restating requests.** `browser_wait` returns `satisfied`, and
`browser_action_and_wait` returns only `event`. The caller already holds the
condition, action, and wait it sent; `operationId` correlates the result without
them; and `event` reports what was actually observed, which is the only part the
caller could not already know.

**One spelling per field.** `BrowserAction` accepted `target` and `locator` as
alternative names for the same value, doubling the largest argument contract and
leaving a model choosing between identical options. Only `target` remains, in
the domain type, the runtime, the engine, and the published schema.

**Tool profiles.** `--tools` / `BROWSERMESH_TOOLS` selects from `core`,
`observability`, and `persistence`. The default publishes every profile, so an
existing configuration keeps every tool it had; narrowing is opt-in. An unknown
profile fails configuration and names the alternatives rather than publishing a
surface the operator did not ask for.

Profiles are implemented by registering the full surface and withdrawing the
unselected tools before the server is connected. A wrapper taking the
registration arguments generically would lose the SDK's per-call type inference
at all 35 sites; no client observes the intermediate surface.

## Consequences

`tools/list` is 87,367 bytes across 35 tools, or 79,479 bytes across 31 with
`--tools=core`. Against the 134,839-byte starting point that is 35.2% and 41.1%.

Four tool names are removed and one added. This is a breaking change to the
published contract, taken at 0.1.x deliberately: tools are selected by a model
reading the current schema each session, so the cost of renaming falls almost
entirely on written configuration rather than on running workflows.

The floor for further reduction is structural and worth stating plainly.
BrowserMesh addresses elements with a semantic locator union — role, text,
label, placeholder, test ID, CSS, each optionally scoped through a bounded
iframe chain — and roughly twenty tools embed it. Playwright MCP publishes 24
tools in 18,512 bytes because its elements are addressed by two strings, a
human-readable description and a snapshot ref. The difference is the feature,
not waste: semantic locators survive DOM changes, which is what makes a
BrowserMesh workflow durable rather than a transcript of one session. Collapsing
the twelve interaction tools into one dispatcher would remove roughly 28,000
further bytes at the cost of the tool-selection clarity SPEC and AGENTS.md §22
require, and is rejected on those grounds.

## Alternatives considered

**Publish `core` by default.** It would show a smaller number, at the cost of
silently removing persistence and observability from every existing
configuration. After the merge those two profiles are 8,000 bytes of 87,000, so
the saving does not justify the breakage.

**Keep the four observability tools as deprecated aliases.** Aliases would
preserve written configurations while doubling the surface the decision exists
to reduce.

**Drop `outputSchema` from the twelve interaction tools.** Their result contracts
are 353 bytes each, 4,236 in total, and SPEC §22.2 requires them. The
information they carry — `operationId` correlation — is the same information the
error path relies on.
