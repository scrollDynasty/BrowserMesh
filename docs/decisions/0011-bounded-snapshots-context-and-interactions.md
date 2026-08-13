# ADR 0011: Bound snapshots and extend typed browser coverage

Status: Accepted

Snapshots gain validated `interactiveOnly`, `maxDepth`, `maxChildren`, `maxChars`, semantic scope,
and optional bounding boxes. Results always state applied bounds and truncation. Pagination may be
added only with a stable opaque cursor contract.

The first implemented snapshot slice deliberately uses only Playwright 1.62's documented locator
ARIA snapshot controls: semantic scope, `depth`, `boxes`, timeout, and cancellation. Runtime-owned
snapshot-content `maxChars` and `maxBytes` limits are applied on Unicode code-point and UTF-8
boundaries. A truncated
result is labelled `aria-yaml-fragment` and `partial=true`; it is never represented as a complete,
parseable YAML snapshot. `interactiveOnly` and `maxChildren` remain pending until an
engine-independent deterministic tree transform is specified. Pagination and references remain
pending under the lifecycle rules below.

Element references are a later slice after bounded snapshots. References are opaque, bounded, and
scoped to one session/page. They are invalidated on navigation/page close and rejected after
relevant DOM replacement with `STALE_ELEMENT_REFERENCE`. They never expose engine handles; semantic
locators remain supported.

Session creation may accept validated viewport, scale, locale, timezone, color scheme, reduced
motion, user agent, and geolocation with explicit permissions. The normalized effective settings
are returned without secrets and remain isolated per context.

New interactions are typed capabilities: hover/focus, check/uncheck, double-click, scroll/scroll
into view, drag/drop, dialog handling, popup wait, iframe-scoped semantic targeting, and full-page or
element screenshot. Arbitrary JavaScript and arbitrary filesystem paths remain forbidden. Uploads
and downloads require ADR 0012 first.
