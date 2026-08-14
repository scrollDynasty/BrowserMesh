# Troubleshooting

## Chromium is missing

Symptom: `BROWSER_ERROR` includes the install remediation.

```bash
npx -y multi-agent-browser-mcp --install-browser
npx -y multi-agent-browser-mcp --doctor --json
```

## Server exits after start

BrowserMesh uses stdout for MCP stdio. Starting it in a terminal is not an interactive shell. Configure an MCP client to own the child process. Invalid CLI arguments exit with status 2 and print usage to stderr.

## Headed browser cannot start

The runtime defaults to `BROWSERMESH_HEADLESS=false`. On a machine without a display, set:

```text
BROWSERMESH_HEADLESS=true
```

## `PAGE_NOT_FOUND`

Verify that `pageId` belongs to the supplied `sessionId`. Rediscover pages with `browser_page_list`. A page ID from another session is intentionally rejected.

## Locator timeouts or ambiguity

Capture a current bounded snapshot. Prefer exact accessible role/name or test ID. Make a locator more specific when it matches several elements. Refs expire after 30 seconds and after navigation or relevant DOM replacement.

## Wait never observes an action

Do not queue a passive wait followed by its triggering action in the same session. Use `browser_action_and_wait`, which registers the event listener before the click/key action under one deadline.

## Snapshot cursor is stale

Capture a new snapshot. Cursors expire after 30 seconds and are invalidated by navigation, page/session close, disconnect, and shutdown.

## Persistence errors

- `PERSISTENCE_DISABLED`: set `BROWSERMESH_PERSISTENCE=true` or stop using state tools.
- `SAVED_STATE_NOT_FOUND`: call `browser_state_list` and verify the logical ID.
- `LIMIT_EXCEEDED`: remove unused states or revise safe configured quotas.

Never edit state files while BrowserMesh is running. Corrupted state is rejected rather than partially restored.

## Browser disconnected

`BROWSER_DISCONNECTED` is terminal for affected live sessions. Restart the server and recreate sessions; BrowserMesh intentionally does not pretend the prior pages survived.
