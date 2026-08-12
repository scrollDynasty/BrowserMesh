# BrowserMesh

BrowserMesh is a local, open-source multi-session browser runtime for AI agents. It replaces an implicit “current page” with explicit `sessionId` + `pageId` addressing, isolates every session in its own Chromium `BrowserContext`, and exposes the runtime over MCP stdio.

Version 0.1 is a small modular monolith: one Node.js process, one Chromium process, many isolated contexts. It includes session/page lifecycle, browser actions, per-session concurrency control, storage-state persistence, agent ownership, deterministic mailboxes, and a tested buyer/seller demonstration.

## Requirements and installation

- Node.js 24 LTS recommended; Node.js 22+ supported.
- npm 10+.

```sh
npm install
npx playwright install chromium
npm run build
```

Storage state is sensitive. BrowserMesh writes it below `.browsermesh/states/`, which is ignored by Git. Do not copy or publish this directory.

## Run as an MCP server

```sh
npm start
```

Example client configuration after a local build:

```json
{
  "mcpServers": {
    "browsermesh": {
      "command": "node",
      "args": ["/absolute/path/to/browsermesh/dist/cli.js"],
      "env": {
        "BROWSERMESH_HEADLESS": "true"
      }
    }
  }
}
```

Typical flow:

1. Call `browser_session_create`; its initial page is available through `browser_page_list`.
2. Pass both returned `sessionId` and `pageId` to every page operation.
3. Call `browser_session_close` when finished. Runtime shutdown also drains queued work and closes all contexts.

There is no global active session, page, or tab. The initial page is deterministic and marked `isDefault`, but operations still require an explicit `pageId`.

## Supported MCP tools

Session and page:

- `browser_session_create`, `browser_session_list`, `browser_session_get`, `browser_session_close`
- `browser_page_create`, `browser_page_list`, `browser_page_close`

Navigation, interaction, inspection, capture:

- `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`
- `browser_get_url`, `browser_get_title`, `browser_snapshot`, `browser_visible_text`
- `browser_click`, `browser_fill`, `browser_press`, `browser_select_option`
- `browser_screenshot` (returns an MCP PNG image plus correlation IDs)

Persistence:

- `browser_state_save`, `browser_state_list`, `browser_state_remove`
- Restore with `browser_session_create.fromState`.

Agents and messages:

- `browser_agent_create`, `browser_agent_list`, `browser_agent_get`, `browser_agent_remove`
- `browser_session_assign`, `browser_session_release`
- `browser_message_send`, `browser_message_list`, `browser_message_acknowledge`

Tool inputs are schema validated. Successful JSON responses have `{ "ok": true, "value": ... }`; application failures have `{ "ok": false, "error": { "code", "message", "details" } }` with MCP `isError: true`.

## Locators

Actions accept semantic locators (`role`, `text`, `label`, `placeholder`, `testId`) and CSS as an escape hatch. Role values in v0.1 are intentionally limited to common interactive roles: button, link, textbox, checkbox, radio, combobox, heading, listitem, option, and tab.

## Configuration

| Environment variable       |        Default | Meaning                                       |
| -------------------------- | -------------: | --------------------------------------------- |
| `BROWSERMESH_HEADLESS`     |         `true` | Run Chromium headless                         |
| `BROWSERMESH_TIMEOUT_MS`   |        `30000` | Default bounded operation timeout             |
| `BROWSERMESH_DATA_DIR`     | `.browsermesh` | Private persistence directory                 |
| `BROWSERMESH_LOG_LEVEL`    |         `info` | `debug`, `info`, `warn`, `error`, or `silent` |
| `BROWSERMESH_MAX_SESSIONS` |           `50` | Active session limit                          |
| `BROWSERMESH_MAX_PAGES`    |           `20` | Per-session managed page limit                |
| `BROWSERMESH_PERSISTENCE`  |         `true` | Enable storage-state persistence              |

Logs are JSON lines on stderr so stdout remains reserved for MCP. They contain correlation/resource IDs, not cookies, tokens, page contents, message payloads, or form values.

## Development

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:e2e
npm run test:stress
npm run verify
```

Integration/e2e tests use a local deterministic HTTP server and real Chromium. See [development documentation](docs/development.md) and [architecture](docs/architecture.md).

## Intentional v0.1 limitations

- Chromium only; no Firefox/WebKit parity.
- Local stdio transport only; no remote Streamable HTTP, authentication, or multi-tenant boundary.
- One Node.js process and one browser process; no distributed workers or crash recovery of live operations.
- Persistence covers Playwright cookies and localStorage state, not live contexts, active operations, or virtual WebAuthn credentials.
- In-memory agents, ownership, events, and mailboxes are lost on process restart. Ownership has explicit handoff but not expiring leases yet.
- No downloads, arbitrary filesystem paths, shell execution, web dashboard, network allowlist, or full Playwright API.

These are future scope, not incomplete guarantees: within one runtime, explicitly addressed sessions are isolated and different sessions execute concurrently while changing operations in one session are serialized.
