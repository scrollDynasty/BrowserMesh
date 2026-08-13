# ADR 0011: Bound snapshots and extend typed browser coverage

Status: Accepted

Snapshots gain validated `interactiveOnly`, `maxDepth`, `maxChildren`, `maxChars`, semantic scope,
and optional bounding boxes. Results always state applied bounds and truncation. Pagination may be
added only with a stable opaque cursor contract.

Element references are a later slice after bounded snapshots. References are opaque, bounded, and
scoped to one session/page. They are invalidated on navigation/page close and rejected after
relevant DOM replacement with `STALE_ELEMENT_REFERENCE`. They never expose engine handles; semantic
locators remain supported.

Session creation may accept validated viewport, scale, locale, timezone, color scheme, reduced
motion, user agent, and geolocation with explicit permissions. The normalized effective settings
are returned without secrets and remain isolated per context.

The first context-settings slice accepts viewport width/height (integers `1..10000`), device scale
factor (`0.1..10`), one canonical Unicode locale identifier, one canonical IANA timezone ID,
`light|dark|no-preference` color scheme, `reduce|no-preference` reduced motion, and a user agent of
at most 512 characters. Text values reject C0/C1 controls. These engine-independent values are
normalized before context creation and returned in every session view. Geolocation and permissions
remain deferred until a follow-up contract defines an exact permission allowlist and a safe,
validated origin-scoping policy; accepting this ADR does not permit an open-ended permission API.

New interactions are typed capabilities: hover/focus, check/uncheck, double-click, scroll/scroll
into view, drag/drop, dialog handling, popup wait, iframe-scoped semantic targeting, and full-page or
element screenshot. Arbitrary JavaScript and arbitrary filesystem paths remain forbidden. Uploads
and downloads require ADR 0012 first.
