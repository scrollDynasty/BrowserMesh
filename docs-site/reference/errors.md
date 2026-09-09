# Error reference

Application failures set MCP `isError: true` and return bounded JSON text:

```json
{
  "ok": false,
  "error": {
    "code": "PAGE_NOT_FOUND",
    "message": "The requested browser page was not found in the addressed session",
    "nextStep": "Call browser_page_list for this sessionId to get its live pageIds. A pageId belonging to another session is always rejected.",
    "operationId": "…"
  }
}
```

`message` says what went wrong and is fixed per code — it never carries a raw
cause, a locator, or a URL. `nextStep` says what to do about it and is also fixed
per code, so a client can act on a failure without consulting this page. The
table below quotes what is actually sent (ADR 0022); `src/adapters/mcp/results.ts`
is the source of truth.

| Code                      | `nextStep` sent to the caller                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_NOT_FOUND`       | Call `browser_session_list` to recover live sessionIds, or `browser_session_create` to start a new isolated session.                                                                                                                                                                                                      |
| `SESSION_NOT_READY`       | The session is still being created. Retry the operation; `browser_session_get` reports its current status.                                                                                                                                                                                                                |
| `SESSION_CLOSING`         | Stop sending work to this session. Use another session, or `browser_session_create` for a fresh one.                                                                                                                                                                                                                      |
| `SESSION_CLOSED`          | This session and its pages are gone. Create a replacement with `browser_session_create`; pass `stateId` to restore saved authentication.                                                                                                                                                                                  |
| `PAGE_NOT_FOUND`          | Call `browser_page_list` for this sessionId to get its live pageIds. A pageId belonging to another session is always rejected.                                                                                                                                                                                            |
| `INVALID_ARGUMENT`        | Re-read the tool inputSchema and check the per-argument bounds. Some are enforced by the runtime rather than the schema, so a value the schema accepts can still be rejected. `browser_runtime_info` reports the session, screenshot, visible-text, and persistence limits, but not the snapshot or observability bounds. |
| `OPERATION_TIMEOUT`       | A locator that matches nothing also times out. Confirm the element with `browser_snapshot` before raising `timeoutMs`, and try `exact:false` on a role locator whose name may not match the accessible name character for character.                                                                                      |
| `OPERATION_CANCELLED`     | The client cancelled this call. Reissue it if the work is still wanted, unless the action may have already taken effect — confirm the page state first.                                                                                                                                                                   |
| `NAVIGATION_FAILED`       | Check that the URL is absolute http(s) and reachable. `browser_observe` with source `requestFailed` reports the transport-level failure.                                                                                                                                                                                  |
| `ELEMENT_NOT_FOUND`       | Capture `browser_snapshot` with `interactiveOnly:true` to see what the page actually exposes, then target it by role, label, or test ID.                                                                                                                                                                                  |
| `LOCATOR_AMBIGUOUS`       | This locator matches more than one element. Narrow it with a role name, scope it to a container, or capture `browser_snapshot` with `includeRefs:true` and act on one ref.                                                                                                                                                |
| `STALE_ELEMENT_REFERENCE` | Refs expire 30 seconds after capture and do not survive navigation or another page. Capture `browser_snapshot` with `includeRefs:true` again, or use a semantic locator instead.                                                                                                                                          |
| `STALE_SNAPSHOT_CURSOR`   | Snapshot cursors expire 30 seconds after capture and do not survive navigation. Call `browser_snapshot` again without a cursor and page through the fresh capture.                                                                                                                                                        |
| `BROWSER_ERROR`           | Call `browser_runtime_info` to check the launch state. If the details name a remediation, run it; otherwise retry the operation.                                                                                                                                                                                          |
| `BROWSER_DISCONNECTED`    | Chromium is gone and live sessions cannot be recovered. Create new sessions with `browser_session_create`; restore authentication from a saved `stateId`.                                                                                                                                                                 |
| `INTERNAL_ERROR`          | Retry once, unless the action may have already taken effect — confirm the page state first. If it recurs, quote the `operationId` when reporting it.                                                                                                                                                                      |
| `LIMIT_EXCEEDED`          | Ask for less: lower `maxChars`, `maxBytes`, `maxRefs`, or `limit`, scope a snapshot to one container, or close sessions you no longer need. `browser_runtime_info` reports the session, screenshot, visible-text, and persistence limits, but not the snapshot or observability bounds.                                   |
| `RUNTIME_SHUTTING_DOWN`   | The server is shutting down and accepts no further browser work. Reconnect before retrying.                                                                                                                                                                                                                               |
| `SAVED_STATE_NOT_FOUND`   | Call `browser_state_list` for the stateIds this runtime holds, or save one first with `browser_state_save`.                                                                                                                                                                                                               |
| `PERSISTENCE_DISABLED`    | This runtime was started without persistence. Continue without saved state, or ask the operator to start BrowserMesh with `BROWSERMESH_PERSISTENCE=true`.                                                                                                                                                                 |

## Two failure channels

Argument shapes rejected by the published input schema come back as MCP
input-validation errors (`-32602`), not as the payload above. Those are more
specific by design — they name the offending field:

```text
MCP error -32602: Input validation error: Invalid arguments for tool browser_click:
Invalid discriminator value. Expected 'role' | 'text' | 'label' | 'placeholder' |
'testId' | 'css' at locator.strategy
```

Arguments the schema accepts but the runtime rejects come back as
`INVALID_ARGUMENT` with the fixed message, which cannot name the field. The
clearest case is `browser_observe`'s `limit`: the schema permits up to 200 while
a default server accepts 100 — and `maxPageSize`, the bound that rejected it, is
one `browser_runtime_info` does not return. This page is the reference for those;
see [Limits](/reference/limits).

## Details

Browser failures may include only an allowlisted `reason`: `timeout`, `dns`,
`connection`, `tls`, `invalid_url`, `locator_ambiguous`, `element_not_found`, or
`other`. Public URLs exclude credentials, queries, and fragments. Raw Playwright
messages, causes, stacks, tokens, and form values are not returned.

`ELEMENT_NOT_FOUND` is rarely what a locator-driven action returns today. A
locator that matches nothing waits for it to appear and then reports
`OPERATION_TIMEOUT`, which is why that code's next step tells you to check the
page rather than raise the timeout. ADR 0025 proposes fixing the classification.

## Recovery

A failed operation does not poison the session queue: the next accepted
operation on that session still runs. Do not automatically retry destructive
actions unless the workflow can establish whether the action took effect.

Cancellation does not roll anything back. A request cancelled while it waits in
the session queue never touches the browser, but one cancelled while its action
is in flight is not aborted — the queue re-checks the signal only after the
action resolves, so `OPERATION_CANCELLED` can name a click that already landed.
`INTERNAL_ERROR` carries the same caveat: any unexpected throw maps to it,
including one raised after the browser action completed.
