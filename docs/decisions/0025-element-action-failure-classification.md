# ADR 0025 — Distinguish "matched nothing" from "timed out"

Status: Proposed

Date: 2026-09-08

This ADR changes which error code a shipped operation returns. No code change
accompanies it.

## Context

`ELEMENT_NOT_FOUND` is declared in `errorCodes`, documented in
`docs-site/reference/errors.md`, and allowlisted as a `reason` in the sanitized
details. For element actions driven by a locator it is close to unreachable.

`performElementOperation` classifies a failure as
`timedOut ? 'OPERATION_TIMEOUT' : ambiguous ? 'LOCATOR_AMBIGUOUS' : 'ELEMENT_NOT_FOUND'`.
Playwright's actionability wait does not fail fast when a locator matches
nothing; it waits for the element to appear and then reports a timeout. So
`timedOut` is true in exactly the case `ELEMENT_NOT_FOUND` exists to describe,
and the caller is told the operation was slow.

Reproduced against `https://the-internet.herokuapp.com/login`, which is worth
recording because BrowserMesh's own output leads into it:

1. `browser_snapshot` with `interactiveOnly` and `includeRefs` returns the
   snapshot line `- button " Login"` and the ref entry
   `{"ref":"@e87ea…","tag":"button","name":"Login"}`.
2. `browser_click` with `{"strategy":"role","value":"button","name":"Login"}` —
   the name copied from that ref entry, with the default `exact: true` — matches
   nothing. It returns after the full 10-second timeout with
   `OPERATION_TIMEOUT` and "The browser operation timed out".
3. The same locator with `"exact": false` succeeds immediately.

The caller is charged the whole timeout, told the wrong thing, and pointed at
`timeoutMs`, which cannot help. `ELEMENT_NOT_FOUND` would have said what
happened, and a fast failure would have cost 10 seconds less.

Two separate defects meet here. The classification is one. The other is that
`refs[].name` is computed in the page as
`(aria-label ?? alt ?? title ?? textContent).replace(/\s+/gu, ' ').trim()` —
a normalized approximation — while the role locator matches Playwright's
computed accessible name. When they differ, BrowserMesh has published a name
that its own matcher rejects, and `exact: true` turns a near miss into a
ten-second silence. ADR 0022 mitigates this in the `OPERATION_TIMEOUT` next step;
it does not fix it.

## Decision (proposed)

**Classify before reporting.** When an element operation times out, count the
locator once with a short bounded deadline. Zero matches becomes
`ELEMENT_NOT_FOUND` with `reason: "element_not_found"`; more than one becomes
`LOCATOR_AMBIGUOUS`; exactly one stays `OPERATION_TIMEOUT`, which now means what
it says — the element was there and the action could not complete on it.

The count runs inside the same session queue slot as the operation that failed,
so it cannot bypass an in-progress operation or race a close. It is bounded
separately and is best-effort: if the probe itself fails or the deadline is
already spent, the code stays `OPERATION_TIMEOUT`. A diagnostic must not be able
to turn one failure into a different one.

**Report the ambiguity count.** `LOCATOR_AMBIGUOUS` details gain
`matchCount`, a small non-negative integer. A caller that knows a CSS locator
matched 14 elements narrows differently than one that knows it matched 2. The
number is a count of DOM nodes and carries no page content.

**Anchor refs to snapshot nodes.** `browser_snapshot` returns `refs` as an array
parallel to a YAML document that does not mention them. A caller cannot map
`- textbox "Username"` to a ref except by position, and position is only
incidentally aligned: the snapshot filters by ARIA role while refs are collected
by a CSS interactive selector. Either embed the ref in the snapshot line, as
Playwright MCP does with `[ref=e5]`, or give each ref the byte offset of the node
it came from. This is the larger change of the three and can be decided
separately.

## Consequences

An element action against a locator that matches nothing returns in a fraction
of the timeout instead of all of it. For an agent retrying a locator two or three
times, that is the difference between a 30-second dead end and a 3-second one.

Callers that branch on `OPERATION_TIMEOUT` for missing elements will see
`ELEMENT_NOT_FOUND` instead. This is a public contract change and the reason
this ADR is proposed rather than applied. It is a change from a code that was
wrong to one that was already documented for the case, so no caller loses a
distinction it had.

`reason: "element_not_found"` is already in the sanitized allowlist and starts
appearing where it never did before. Anything asserting that it never appears is
asserting the defect.

## Alternatives considered

**Pass `state: 'attached'` with a short timeout before every element action.**
A second round trip on every successful action to improve the error message on
the rare failing one. The probe-on-failure path costs nothing on success.

**Leave the code and fix only the message.** ADR 0022 does exactly this, as a
mitigation. It does not recover the wasted timeout, and it leaves a documented
error code that the runtime cannot produce.

**Make `exact: false` the default for role names.** It would have made the
reproduction above succeed, and it makes every role locator match by substring,
so `name: "Save"` starts matching "Save and close". The default is right; the
failure mode is what is wrong.
