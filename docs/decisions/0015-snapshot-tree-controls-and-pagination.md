# ADR 0015: Snapshot tree controls and immutable pagination

Status: Accepted

## Context

ADR 0011 bounded the serialized ARIA snapshot but deferred `interactiveOnly`, `maxChildren`, and
pagination. Applying a cursor to the live DOM would make later pages depend on mutations between
calls. Treating Playwright's ARIA YAML as ad-hoc lines would also make tree controls dependent on
undocumented formatting details.

## Decision

BrowserMesh parses the documented ARIA YAML result with a conforming YAML parser into an
engine-neutral tree, applies controls there, and serializes it back to ARIA YAML. Playwright and
MCP types do not cross this transformation boundary.

`interactiveOnly=true` retains interactive ARIA-role nodes and the minimum ancestor chain needed
to preserve their context. A subtree with no interactive node is omitted. The interactive roles
are the finite BrowserMesh set documented in the snapshot domain module. `maxChildren` is applied
after that filter, independently to every retained node's direct children in document order. Its
valid range is 1 through 1,000. Results report counts for subtrees omitted by the interactive
filter and by the per-node child limit; these intentional tree controls do not turn valid YAML into
a fragment.

Serialized response pages remain bounded by `maxChars` and `maxBytes`. If more serialized content
exists, the first call returns an opaque `nextCursor`, `snapshotId`, and expiry. Later calls pass
only that cursor and read the next page from the immutable captured serialization; they never
re-read the DOM. Cursor pages therefore remain stable across ordinary DOM mutation. A cursor is
scoped to exactly one `sessionId + pageId`, expires after 30 seconds, and is invalid after page
navigation, reload/history traversal, page close, session close, browser disconnect, or shutdown.
Unknown, expired, evicted, and cross-page/session cursors all return `STALE_SNAPSHOT_CURSOR`.

Each page retains at most four immutable paginated snapshots, oldest-first eviction. A retained
serialization is limited to 1,000,000 Unicode code points; larger captures are explicitly clipped
and reported as a source omission. Cleanup is opportunistic on capture/read and immediate on the
lifecycle events above, so no background timers are created. A failed or cancelled capture is not
inserted. Cursors contain no DOM, locator, filesystem, or Playwright reference.

## Consequences

Pagination is deterministic and bounded, at the cost of short-lived per-page memory. Navigation
intentionally invalidates cursors even though an immutable string could technically survive it;
this gives all page-derived handles one conservative lifecycle and releases memory promptly.
YAML parsing is explicit and testable rather than based on indentation or string heuristics.
