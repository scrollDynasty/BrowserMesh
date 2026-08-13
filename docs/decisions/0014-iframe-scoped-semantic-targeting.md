# ADR 0014: Iframe-scoped semantic targeting

Status: Accepted

## Context

BrowserMesh locators currently resolve only in a page's top document. Professional application
workflows commonly place controls in same-origin or cross-origin iframes, but exposing Playwright
`Frame`, `FrameLocator`, names, URLs, or indexes would leak engine concepts and create brittle or
ambiguous identity. A frame handle would also need a new stale-handle registry and lifecycle.

## Decision

An engine-neutral `Locator` may carry an optional `frame` scope:

```json
{
  "strategy": "role",
  "value": "button",
  "name": "Save",
  "frame": {
    "kind": "iframe",
    "chain": [
      { "strategy": "testId", "value": "editor-frame" },
      { "strategy": "testId", "value": "tool-frame" }
    ]
  }
}
```

`frame.kind="main"` explicitly selects the top document and is equivalent to omitting `frame`.
`frame.kind="iframe"` contains one through five semantic/CSS `LocatorSelector` values. Each value
selects the iframe element in the document reached by the preceding value. Frame selectors cannot
carry their own frame scope. Empty or over-depth chains return `INVALID_ARGUMENT`.

Each chain step is resolved under the operation's existing deadline and cancellation signal. Zero
matches continue waiting; more than one match returns `LOCATOR_AMBIGUOUS` with the safe selector
and zero-based chain step. The final element retains the existing exact/ambiguity behavior.
BrowserMesh resolves the complete chain afresh for every operation and stores no public or runtime
frame handle. Iframe detach or navigation therefore cannot make a durable frame identity stale:
semantic operations resolve the current document, while a previously captured element ref becomes
`STALE_ELEMENT_REFERENCE` when its element is detached or belongs to the replaced document.

The scope is available anywhere the existing `Locator` contract is used: semantic actions,
composite click/press actions, locator waits, visible text, bounded snapshot scope/ref capture,
element screenshots, and drag/drop endpoints. URL/load/text waits and viewport/full-page
screenshots remain page-wide by definition. Snapshot results echo the applied scoped locator.
Short-lived refs remain owned by exactly one `sessionId + pageId`; they do not expose or grant
ownership of a frame and preserve the ADR 0013 TTL, quota, and cross-page behavior.

Only the Playwright adapter converts the chain to `FrameLocator` objects. No `Frame`,
`FrameLocator`, locator, or element handle crosses the browser-engine port. Cross-origin iframe
content is treated exactly like same-origin content, but BrowserMesh returns only the evidence
explicitly requested by the caller through an inspection/screenshot operation. It does not
enumerate frame URLs, names, document contents, or unrelated frames as part of resolution.

## Consequences

Frame selection is deterministic and portable across engines that can traverse iframe elements.
Callers should prefer accessible names or test IDs and use CSS only as the existing escape hatch.
Reordering unrelated iframes does not affect identity because numeric indexes are not supported.
The depth cap bounds work and maliciously deep input. A frame that repeatedly detaches or navigates
during one operation may time out safely; queue recovery and cross-session parallelism are
unchanged.
