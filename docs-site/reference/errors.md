# Error reference

Application failures set MCP `isError: true` and return bounded JSON text:

```json
{
  "ok": false,
  "error": {
    "code": "PAGE_NOT_FOUND",
    "message": "The requested browser page was not found in the addressed session",
    "operationId": "…"
  }
}
```

| Code                      | Meaning / next step                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `SESSION_NOT_FOUND`       | rediscover or create the session                                   |
| `SESSION_NOT_READY`       | session has not reached ready state                                |
| `SESSION_CLOSING`         | stop submitting work to this session                               |
| `SESSION_CLOSED`          | create a new session                                               |
| `PAGE_NOT_FOUND`          | verify both IDs and page ownership                                 |
| `INVALID_ARGUMENT`        | correct the request schema/value                                   |
| `OPERATION_TIMEOUT`       | inspect state, use a deterministic wait, or adjust bounded timeout |
| `OPERATION_CANCELLED`     | caller cancelled the request                                       |
| `NAVIGATION_FAILED`       | inspect safe reason/URL context and network conditions             |
| `ELEMENT_NOT_FOUND`       | recapture state or correct the locator                             |
| `LOCATOR_AMBIGUOUS`       | make the locator unique                                            |
| `STALE_ELEMENT_REFERENCE` | capture a new snapshot/ref                                         |
| `STALE_SNAPSHOT_CURSOR`   | capture a new snapshot                                             |
| `BROWSER_ERROR`           | operation failed; install Chromium if remediation says so          |
| `BROWSER_DISCONNECTED`    | existing sessions cannot recover; restart and recreate them        |
| `LIMIT_EXCEEDED`          | reduce requested/captured data or revise configured budget         |
| `RUNTIME_SHUTTING_DOWN`   | stop submitting work and reconnect later                           |
| `SAVED_STATE_NOT_FOUND`   | list states or use another ID                                      |
| `PERSISTENCE_DISABLED`    | enable persistence or omit state operations                        |
| `INTERNAL_ERROR`          | unexpected safe failure; gather bounded diagnostics                |

Browser failures may include only an allowlisted reason: `timeout`, `dns`, `connection`, `tls`, `invalid_url`, `locator_ambiguous`, `element_not_found`, or `other`. Public URLs exclude credentials, queries, and fragments. Raw Playwright messages, causes, stacks, tokens, and form values are not returned.

A failed operation does not poison the session queue. Do not automatically retry destructive actions unless the workflow can establish whether the action took effect.
