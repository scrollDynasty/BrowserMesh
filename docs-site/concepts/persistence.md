# Persistence

BrowserMesh can save Playwright storage state—cookies and supported origin storage—under a logical `stateId`. Callers never supply filesystem paths.

```text
live session → browser_state_save → private state file
private state file → browser_session_create { stateId } → new isolated context
```

Saving state passes through the session queue, so it observes the accepted order of navigation and interaction. Writes are atomic. Repository-wide mutation serialization protects count, per-state, and aggregate quotas.

State IDs are 1–128 characters and must match the implementation's safe logical identifier rules. State contents are not returned by list operations and must not be logged or committed. The default data directory is `.browsermesh`; persistence is enabled by default.

Set `BROWSERMESH_PERSISTENCE=false` to disable save/list/remove/restore. These operations then return `PERSISTENCE_DISABLED`.

Saved state is sensitive. Protect the configured data directory and delete state with `browser_state_remove` when no longer required.
