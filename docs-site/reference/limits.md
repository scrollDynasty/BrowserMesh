# Limits reference

Every bound BrowserMesh enforces, in one table. Defaults are what an unconfigured
server uses; the range is what the environment variable accepts.

Exceeding a bound produces `LIMIT_EXCEEDED` when the request cannot be served, or
a truncated result flagged in the response when it can. The two are different
outcomes and both are explicit — no result is silently shortened.

## Runtime

| Bound             | Default  | Range     | Set with                   |
| ----------------- | -------- | --------- | -------------------------- |
| Operation timeout | 10,000ms | 1–300,000 | `BROWSERMESH_TIMEOUT_MS`   |
| Live sessions     | 50       | 1–1,000   | `BROWSERMESH_MAX_SESSIONS` |
| Pages per session | 20       | 1–100     | `BROWSERMESH_MAX_PAGES`    |

`timeoutMs` on an individual call overrides the default for that call, up to
300,000ms.

## Snapshots

`browser_snapshot` bounds are fixed in the build, not configurable. Per-call
arguments may lower them but never raise them past the maximum.

| Bound                    | Default   | Per-call maximum | Argument      |
| ------------------------ | --------- | ---------------- | ------------- |
| Returned characters      | 50,000    | 100,000          | `maxChars`    |
| Returned bytes           | 65,536    | 131,072          | `maxBytes`    |
| Tree depth               | unbounded | 100              | `maxDepth`    |
| Element refs             | 50        | 100              | `maxRefs`     |
| Children per node        | unbounded | 1,000            | `maxChildren` |
| Source DOM nodes         | 20,000    | —                | —             |
| Source characters        | 2,000,000 | —                | —             |
| Retained captures / page | 4         | —                | —             |
| Cursor lifetime          | 30s       | —                | —             |
| Element ref lifetime     | 30s       | —                | —             |

`maxChars` and `maxBytes` both apply; whichever binds first truncates, and
`truncation.byMaxChars` / `truncation.byMaxBytes` say which did. For ASCII text
characters bind first. For content averaging three bytes per character the byte
bound is reached at roughly 21,800 characters, so the same arguments return less
text on a CJK page than on an English one — by design, and reported.

A source page over 20,000 DOM nodes or 2,000,000 characters is rejected with
`LIMIT_EXCEEDED` before serialization rather than truncated. Scope the snapshot
to a container with `scope`.

Cursors and refs both expire 30 seconds after capture and are invalidated by
navigation or page close, whichever comes first.

## Reading page text

| Bound      | Default | Range         | Set with                             |
| ---------- | ------- | ------------- | ------------------------------------ |
| Characters | 20,000  | 128–1,000,000 | `BROWSERMESH_VISIBLE_TEXT_MAX_CHARS` |
| Bytes      | 65,536  | 512–4,194,304 | `BROWSERMESH_VISIBLE_TEXT_MAX_BYTES` |

`browser_visible_text` has no per-call bound argument and no cursor. When
`truncation.truncated` is true, the remedy is a narrower locator or a
server-side change to the limit — not a follow-up call. Use `browser_snapshot`,
which paginates, when the whole of a long page is needed.

## Observability

| Bound                    | Default | Range         | Set with                                   |
| ------------------------ | ------- | ------------- | ------------------------------------------ |
| Retained events per page | 200     | 1–1,000       | `BROWSERMESH_OBSERVABILITY_EVENTS`         |
| Events per response      | 100     | 1–200         | `BROWSERMESH_OBSERVABILITY_PAGE_SIZE`      |
| Captured string length   | 2,048   | 128–8,192     | `BROWSERMESH_OBSERVABILITY_STRING_CHARS`   |
| Response bytes           | 65,536  | 1,024–262,144 | `BROWSERMESH_OBSERVABILITY_RESPONSE_BYTES` |

`browser_observe`'s `limit` argument is validated against the configured events
per response, not against the maximum the published schema allows. On a default
server `limit: 150` is accepted by the schema and rejected by the runtime with
`INVALID_ARGUMENT`; the safe ceiling is 100 unless the operator raised it.

The event buffer is a ring. When it overflows, `droppedCount` and `gap` say so.
Read both before concluding that something did not happen.

## Screenshots

| Bound              | Default    | Range              | Set with                               |
| ------------------ | ---------- | ------------------ | -------------------------------------- |
| Dimension (pixels) | 10,000     | 256–32,768         | `BROWSERMESH_SCREENSHOT_MAX_DIMENSION` |
| Total pixels       | 40,000,000 | 65,536–268,435,456 | `BROWSERMESH_SCREENSHOT_MAX_PIXELS`    |
| Encoded bytes      | 16 MiB     | 1,024–64 MiB       | `BROWSERMESH_SCREENSHOT_MAX_BYTES`     |

A full-page capture of a long page reaches the pixel or byte bound before the
dimension bound. Capture a single element instead of raising the limit.

## Session labels

Fixed in the build. Names and metadata are workflow labels, not identity.

| Bound                      | Value       |
| -------------------------- | ----------- |
| Name characters / bytes    | 128 / 512   |
| Metadata entries           | 32          |
| Metadata key chars/bytes   | 64 / 256    |
| Metadata value chars/bytes | 512 / 2,048 |
| Metadata aggregate bytes   | 8,192       |

Control characters are rejected, as are the keys `__proto__`, `constructor`,
and `prototype`.

## Saved state

| Bound           | Default | Range        | Set with                            |
| --------------- | ------- | ------------ | ----------------------------------- |
| Saved states    | 100     | 1–10,000     | `BROWSERMESH_MAX_SAVED_STATES`      |
| Bytes per state | 1 MiB   | 1,024–64 MiB | `BROWSERMESH_MAX_STATE_BYTES`       |
| Bytes in total  | 16 MiB  | 1,024–1 GiB  | `BROWSERMESH_MAX_STATE_TOTAL_BYTES` |

`stateId` is 1–128 characters from a safe identifier set.

## Argument bounds

Enforced by the published input schemas.

| Argument                  | Bound            |
| ------------------------- | ---------------- |
| `timeoutMs`               | 1–300,000        |
| `url` matcher value       | 2,048 characters |
| URL glob wildcards        | 32               |
| `wait` text               | 2,000 characters |
| Dialog `promptText`       | 2,000 characters |
| `key`                     | 1–64 characters  |
| Iframe chain depth        | 1–5 selectors    |
| `stateId`, `sinceEventId` | 1–128 characters |
| Snapshot `cursor`         | 1–160 characters |

## What `browser_runtime_info` reports

`browser_runtime_info` returns the session, screenshot, visible-text, and
persistence limits plus the timeout, session, and page counts. It does not
report snapshot bounds, observability bounds, or the 30-second cursor and ref
lifetimes. Those are fixed in the build or come from environment variables the
tool does not echo; this page is the reference for them.
