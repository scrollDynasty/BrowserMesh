# ADR 0018: Absolute deadlines and immutable capture plans

## Status

Accepted

## Context

The runtime creates one absolute deadline when it accepts a browser operation. Rejecting work only
when its queue wait consumes the whole budget is insufficient: passing the original timeout to a
later Playwright call can grant a second full budget. Browser-derived captures also need to limit
work before native serialization, not only reject an oversized result after allocation. Finally,
an npm range cannot support documentation that promises one reproducible Playwright/Chromium pair.

## Decision

- Every Playwright call that accepts timeout or cancellation receives the remaining runtime-owned
  budget and request signal. DOM reads used by title, load-state, and screenshot preflight use
  cancellable `Locator.evaluate`, not unbounded `Page.evaluate`.
- Screenshot preflight produces an immutable CSS-pixel capture plan. Full-page and element capture
  use its fixed clip, so page growth between measurement and capture cannot enlarge native image
  allocation. Runtime still validates returned PNG dimensions and encoded bytes.
- Before native ARIA serialization, the adapter performs a bounded, cancellable traversal of the
  addressed scope and rejects sources over 20,000 DOM/text nodes or 2,000,000 source characters.
  Runtime response, retained-snapshot, TTL, and pagination limits remain independent later bounds.
- Failures while explicitly disposing replaced, expired, detached, or partially captured element
  handles are surfaced through a typed error (or attached as the cause of the stale-ref result)
  instead of being silently discarded.
- The production Playwright dependency is an exact version. The install-browser command resolves
  and runs the CLI from that installed dependency; release tests reject range or lockfile drift.

## Consequences

Queue time and adapter time share one deadline, and a timed-out operation cannot obtain a new full
Playwright timeout. Capture limits now reduce peak native work in addition to bounding MCP output.
Element screenshots represent the immutable measured rectangle; callers needing changed layout
must request a new capture. Dependency upgrades require an explicit reviewed package and lockfile
change together with browser/package verification.
