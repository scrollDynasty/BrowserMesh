# Observability and state tools

## Bounded observations

BrowserMesh maintains per-page bounded ring buffers. Reads remain explicitly addressed and follow the session queue.

| Tool                                             | Event types                              |
| ------------------------------------------------ | ---------------------------------------- |
| `browser_observe` with `source: "console"`       | console level and optional redacted text |
| `browser_observe` with `source: "pageError"`     | page error and optional redacted text    |
| `browser_observe` with `source: "network"`       | request and response metadata            |
| `browser_observe` with `source: "requestFailed"` | failed-request metadata                  |

`includeText` applies to the `console` and `pageError` sources. The network sources carry no text
and reject the flag rather than returning a metadata-only answer that looks complete.

All accept `sessionId`, `pageId`, optional `timeoutMs`, optional `sinceEventId`, and optional `limit` (maximum 200). Console and page-error tools also accept `includeText` (default `false`).

Results contain `events`, `nextCursor`, `droppedCount`, and `gap`. Event URLs remove credentials/fragments and redact sensitive query values. Headers, bodies, cookies, raw stacks, and console object serialization are excluded.

## Persisted state

| Tool                   | Input                  | Output                         |
| ---------------------- | ---------------------- | ------------------------------ |
| `browser_state_save`   | `sessionId`, `stateId` | safe state metadata            |
| `browser_state_list`   | none                   | logical IDs and creation times |
| `browser_state_remove` | `stateId`              | `removed: true`                |

Restore state by passing `stateId` to `browser_session_create`. BrowserMesh never returns state contents or accepts a caller-controlled path.

Saving is serialized with the live session. This makes the order deterministic:

```text
navigate → fill → state_save → click
```

The stored state represents browser state at the accepted save position.
