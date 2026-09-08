# ADR 0022 — Actionable error remediation on the wire

Status: Accepted

Date: 2026-09-08

## Context

Every application failure crosses MCP through `applicationErrorResult`, which
replaces the raw message with a fixed string chosen by error code. That is the
right boundary: raw messages carry locators, URLs, and Playwright internals, and
`SESSION_NOT_FOUND` must not become a place where a session name leaks.

The cost is that the fixed string says only what went wrong. `PAGE_NOT_FOUND`
reaches the client as "The requested browser page was not found in the addressed
session" — accurate, and silent about the fact that `browser_page_list` exists
and that a `pageId` from another session is rejected by design.

The remediation was written down. `docs-site/reference/errors.md` carries a
"Meaning / next step" column for all twenty codes. A client choosing its next
tool call does not read the documentation site; it reads the result it just got.
Two of the twenty codes — `STALE_ELEMENT_REFERENCE` and `STALE_SNAPSHOT_CURSOR`
— already carry their remediation in the message itself, which is what the other
eighteen should have been doing.

Walking the surface as a client makes the gap concrete. A cross-session `pageId`
returns `PAGE_NOT_FOUND` with no mention of `browser_page_list`. An element
action whose locator matches nothing returns `OPERATION_TIMEOUT` with "The
browser operation timed out", which reads as an invitation to raise `timeoutMs`
— the one remedy guaranteed not to work.

## Decision

`applicationErrorResult` adds a `nextStep` string to the public error object,
keyed only by `BrowserMeshErrorCode`:

```json
{
  "ok": false,
  "error": {
    "code": "LOCATOR_AMBIGUOUS",
    "message": "The locator matched multiple elements",
    "nextStep": "This locator matches more than one element. Narrow it with a role name, scope it to a container, or capture browser_snapshot with includeRefs:true and act on one ref.",
    "details": { "reason": "locator_ambiguous" }
  }
}
```

Three properties make this safe to state as strongly as the fixed message is.

**Every value is a compile-time constant.** `NEXT_STEPS` is a
`Readonly<Record<BrowserMeshErrorCode, string>>` of literals. Nothing is
interpolated from the error, the page, the locator, the session, or
configuration, so the field cannot become a leak channel however the failure
arose. The exhaustive `Record` type means a new error code fails to compile
until it has a next step, which is what keeps this from decaying the way a
documentation table does.

**It is additive.** `message` keeps its exact current text and its 512-character
bound. A client that reads only `code` and `message` is unaffected.

**It names tools and arguments, not prose.** `browser_page_list`,
`includeRefs:true`, `exact:false`, `browser_state_list` — the vocabulary the
client is about to type. A next step that says "check your inputs" would cost
bytes and buy nothing.

`OPERATION_TIMEOUT` gets the one entry that is not a straight lift from the
documentation table, because the table is describing behaviour the code does not
have: a locator matching nothing is indistinguishable, at the wire, from a slow
page. Until ADR 0025 is decided the next step has to say so, so the client
verifies with a snapshot instead of raising the timeout.

## Consequences

Each error result grows by roughly 100 to 200 bytes. Errors are a small fraction
of results, and the alternative is a retry loop, which is measured in tool calls.

The argument descriptions added alongside this decision are paid differently:
they are discovery, so every client pays them on every connect whether or not it
ever fails. They cost 6,516 characters, 7.5% of `tools/list`. ADR 0024 proposes
the ceiling that makes an increase like this a deliberate choice rather than a
side effect.

The remediation now exists in two places: `NEXT_STEPS` and
`docs-site/reference/errors.md`. The documentation table is updated to quote the
wire strings so the drift is visible on review, and the exhaustive `Record` makes
the code the one that cannot silently fall behind.

`tests/integration/mcp.test.ts` asserts that every code in `errorCodes` produces
a non-empty `nextStep` distinct from its message, and that a failure carrying a
hostile locator in its details cannot get any of that content into the field.

## Alternatives considered

**Return the raw message for some codes.** `INVALID_ARGUMENT` is the code that
most wants specifics — which argument, and why. Raw messages are constructed
across the runtime and the Playwright adapter from values that include locators
and URLs, and auditing them individually is a standing obligation rather than a
decision. Rejected in favour of a fixed string that names the invariant most
often violated (exactly one of `locator` or `ref`).

**Put the remediation in the tool descriptions.** Discovery is paid by every
client on every connect, whether or not the failure ever happens; error results
are paid only by the client that hit the error. ADR 0020 spent real effort
reducing discovery weight, and this would give it back to callers who never fail.

**Extend `details` instead of adding a field.** `details` is a sanitized
passthrough of runtime-supplied values and is filtered by an allowlist. Putting
a constant there would blur the distinction between "data from the failure,
filtered" and "text BrowserMesh wrote", which is the distinction that makes the
filter reviewable.
