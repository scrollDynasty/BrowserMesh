# ADR 0013: Short-lived element references

Status: Accepted

## Context

ADR 0011 requires opaque, bounded element references but does not define enough of their public
or lifecycle contract to implement them consistently. In particular, it does not choose a target
shape, expiry/quota values, eviction policy, or the exact stale-result behavior.

## Decision

`browser_snapshot` accepts `includeRefs` (default `false`) and `maxRefs` (default `50`, maximum
`100`). `maxRefs` is rejected unless `includeRefs=true`. When enabled, the adapter enumerates at
most `maxRefs` interactive HTML elements in document order within the snapshot scope. The result
contains a separate `refs` array; it does not modify or claim positional equivalence with the ARIA
YAML. Each item contains an opaque `ref` (`@e` plus an unguessable token), a bounded element tag,
and optional bounded role/name hints. Hints are advisory and contain no form values.

Actions accept either the existing semantic/CSS `locator` or `{ ref }` as their `target` value.
For compatibility, the MCP action inputs continue to accept `locator`; a caller supplies exactly
one of `locator` and `ref`. Runtime APIs use an engine-independent `ElementTarget` union. Refs are
supported by click, double-click, hover, focus, check, uncheck, scroll-into-view, fill, press,
select-option, and composite click/press actions. Snapshot scope and passive locator waits remain
semantic/CSS locators.

Refs are owned by one adapter page handle, which is already owned by one runtime `sessionId +
pageId`. Presenting a ref to any other page therefore returns `STALE_ELEMENT_REFERENCE`; refs are
not globally resolvable. A ref expires 30 seconds after capture. Each page retains at most 100
live refs; new capture replaces the page's prior snapshot refs and releases their engine handles.
Expiry is checked and cleaned opportunistically on capture and use, avoiding background timers.

Main-frame navigation, reload/history traversal, page/context close, adapter stop, and unexpected
browser disconnect invalidate and release all affected refs. A retained ref whose element is no
longer connected to the same document (including relevant DOM replacement) returns
`STALE_ELEMENT_REFERENCE`. Unknown, expired, evicted, cross-page, and otherwise invalid refs use
the same recoverable code so callers cannot probe another page's registry.

Reference capture and resolution run inside the owning session queue and honor the operation
deadline/cancellation. If capture is cancelled or fails, newly acquired handles are released and
the previous registry is unchanged. Engine locators and element handles remain adapter-private;
only strings and engine-neutral metadata cross the browser-engine port.

## Consequences

Refs reduce repeated locator discovery for immediate follow-up actions, but are intentionally not
durable test identity. Semantic locators remain preferred for durable workflows. BrowserMesh does
not use Playwright's undocumented AI/ref selectors.
