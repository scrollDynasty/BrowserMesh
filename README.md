# BrowserMesh — Multi-Session Browser MCP Runtime

BrowserMesh is a local, open-source browser runtime for external AI clients.

It lets Claude Code, Codex, Cursor, Qwen, and other MCP-compatible clients control multiple isolated browser sessions through one MCP server.

BrowserMesh replaces an implicit "current page" model with explicit `sessionId` + `pageId` addressing.

Each session runs in its own Chromium `BrowserContext`, so independent users, accounts, roles, and authentication states do not accidentally share cookies, storage, pages, or browser state.

```text
User
  ↓
External AI client
  ↓ MCP
BrowserMesh
  ├── Session buyer  → isolated BrowserContext
  ├── Session seller → isolated BrowserContext
  └── Session admin  → isolated BrowserContext
```

BrowserMesh does not perform LLM reasoning.

The external MCP client decides what to do. BrowserMesh provides deterministic browser capabilities.

A normal user configures BrowserMesh once and then asks their AI client things like:

> Test the checkout flow as a customer while simultaneously verifying the order from the admin account.

The AI client can discover BrowserMesh tools through MCP, create separate sessions for the required identities, operate them independently, and report the result.

BrowserMesh is not:

- an internal AI-agent framework;
- an LLM orchestrator;
- a message bus;
- a Playwright fork;
- a browser GUI;
- an interactive shell that users must operate manually.

## v0.1 architecture

Version 0.1 is intentionally small:

```text
one Node.js process
        │
        ▼
one Chromium process
        │
        ├── BrowserContext A
        ├── BrowserContext B
        ├── BrowserContext C
        └── ...
```

BrowserMesh v0.1 includes:

- explicit session/page addressing;
- isolated Chromium contexts;
- session/page lifecycle;
- browser navigation and interaction;
- semantic locators;
- per-session operation serialization;
- parallel execution across independent sessions;
- bounded operation timeouts;
- structured application errors;
- Playwright storage-state persistence;
- MCP stdio integration;
- deterministic local integration/e2e testing;
- graceful shutdown and resource cleanup.

Reasoning and workflow orchestration remain in the external MCP client.

## How it is normally used

You normally do **not** call BrowserMesh tools manually.

The intended flow is:

1. Configure BrowserMesh once in your MCP-compatible AI client.
2. The client starts BrowserMesh as an MCP stdio process.
3. The client discovers BrowserMesh tools.
4. You describe the browser task in natural language.
5. The AI client chooses and invokes the appropriate BrowserMesh tools.
6. BrowserMesh executes the browser operations and returns structured results.

For tasks involving multiple users, accounts, roles, or authentication states, the external AI client should create a separate BrowserMesh session for each identity.

## Quick start after npm publication

Once the npm package is published, the expected MCP configuration will use the package executable directly.

Install the Playwright-managed Chromium build once before starting BrowserMesh. This command uses
the exact Playwright version bundled with the selected BrowserMesh package:

```sh
npx -y multi-agent-browser-mcp --install-browser
```

Playwright browser binaries are versioned separately from the npm package and may need to be
installed again after a BrowserMesh/Playwright update. If Chromium is missing, BrowserMesh keeps
MCP discovery available and `browser_session_create` returns an actionable `BROWSER_ERROR` instead
of terminating the stdio connection.

Example:

```json
{
  "mcpServers": {
    "browsermesh": {
      "command": "npx",
      "args": ["-y", "multi-agent-browser-mcp"]
    }
  }
}
```

The exact configuration format depends on the MCP client.

During MCP initialization, BrowserMesh reports the exact installed package version in
`serverInfo.version`. This value is generated from package metadata before build/pack and is kept
in sync with the MCP Registry manifest, so clients can detect stale local installations without
BrowserMesh reading repository files at runtime.

BrowserMesh itself remains local: Chromium and BrowserMesh run on the user's machine.

No BrowserMesh cloud server is required for the open-source local mode.

## Build from source

BrowserMesh v0.1 targets Node.js 24 and supports Node.js 22 as its minimum supported major version.

Clone the repository and run:

```sh
npm install
npx playwright install chromium
npm run build
```

Then configure an MCP client to launch the locally built server:

```json
{
  "mcpServers": {
    "browsermesh": {
      "command": "node",
      "args": ["/absolute/path/to/browsermesh/dist/cli.js"]
    }
  }
}
```

For development:

```sh
npm run verify
npm run verify:package
```

## Session model

There is no global:

- current session;
- active session;
- current page;
- active page;
- current tab.

Every browser operation explicitly identifies its session.

Every page-specific operation explicitly identifies its page.

Conceptually:

```text
browser_session_create
        │
        ▼
{
  sessionId,
  pageId
}
        │
        ▼
browser_navigate({
  sessionId,
  pageId,
  ...
})
```

A newly created session contains one deterministic initial page.

`browser_session_create` returns the initial `pageId` immediately so an AI client does not need an additional `browser_page_list` call before its first browser action.

The page also appears in `browser_page_list` and is marked `isDefault`.

Session views consistently expose `sessionId`; page views consistently expose `pageId` and their owning `sessionId`.

The `isDefault` marker is informational only. Browser operations still use explicit `pageId` addressing.

## Isolation

Each ready BrowserMesh session maps to its own non-persistent Chromium `BrowserContext`.

Therefore independent sessions must not accidentally share:

- cookies;
- browser storage/authentication state;
- pages;
- page references;
- current URLs;
- DOM snapshots;
- screenshots;
- form state.

A `pageId` belonging to one session cannot be used through another session.

Cross-session page addressing is rejected.

## Concurrency model

Every live session has an independent serial operation queue.

Operations targeting the same session execute deterministically in accepted order.

For example:

```text
Session A

navigate
   ↓
snapshot
   ↓
click
   ↓
get_url
```

A read-style operation does not bypass an in-progress navigation or interaction.

A failed or timed-out operation must not poison the queue. Later accepted operations continue normally after the failed operation settles.

Different sessions do **not** share a global operation lock:

```text
Session A ═════════════════════►

Session B ═════════════════════►

Session C ═════════════════════►
```

This allows independent browser workflows to run concurrently.

## Session closing

When session close begins:

1. the session enters `closing`;
2. new operations targeting it are rejected;
3. operations already accepted into its queue are drained;
4. its pages and `BrowserContext` are closed;
5. live engine handles are removed;
6. the session becomes closed.

Repeated close of a known closing/closed session is safe and returns an idempotent success result.

A completely unknown session ID still returns `SESSION_NOT_FOUND`.

## Supported MCP tools

### Sessions and pages

- `browser_session_create`
- `browser_session_list`
- `browser_session_get`
- `browser_session_close`
- `browser_page_create`
- `browser_page_list`
- `browser_page_close`

### Navigation

- `browser_navigate`
- `browser_back`
- `browser_forward`
- `browser_reload`

### Inspection

- `browser_get_url`
- `browser_get_title`
- `browser_snapshot`
- `browser_visible_text`

### Interaction

- `browser_click`
- `browser_fill`
- `browser_press`
- `browser_select_option`

### Deterministic waits

- `browser_wait`
- `browser_action_and_wait`

`browser_wait` observes one passive, typed condition through the owning session queue: an exact or
safe-glob URL, `domcontentloaded`/`load`, locator state, or bounded text presence/absence. Text
matching is a case-sensitive substring check against at most the first 1,000,000 characters of
the page body's rendered `innerText`; `absent` means that substring is not present in that bounded
observation. Caller regular expressions, JavaScript predicates, arbitrary sleeps, and
`networkidle` are not supported.

Do not queue a passive wait before the same-session action expected to satisfy it. For an action
that triggers navigation or an HTTP response, `browser_action_and_wait` registers the typed waiter
first and then performs one click or key press under one shared deadline. Returned response URLs
remove credentials and fragments and redact common sensitive query values. Popup waiting remains
deferred until popup pages can be atomically assigned a BrowserMesh `pageId` while enforcing the
per-session page limit.

### Capture

- `browser_screenshot`

Screenshots are returned as MCP image content instead of being written to a caller-controlled filesystem path.

### Persistence

- `browser_state_save`
- `browser_state_list`
- `browser_state_remove`

`browser_session_create` accepts an optional `stateId`.

Without `stateId`, it creates a fresh isolated context.

With `stateId`, it initializes the new context using a previously saved BrowserMesh state.

Example conceptually:

```text
browser_session_create({
  name: "buyer",
  stateId: "buyer-auth"
})
```

## Session labels

A session may have:

- an optional human-readable `name`;
- optional string metadata.

For example an external AI client may label sessions:

```text
role=buyer
role=seller
account=work
```

These values are neutral workflow labels only.

They do **not** create:

- internal Agent entities;
- ownership principals;
- permissions;
- mailboxes;
- message channels;
- LLM identities.

## MCP tool discovery

BrowserMesh tool descriptions are part of the product contract.

Descriptions must explain both what a tool does and when an AI client should use it.

For example, the description for `browser_session_create` must make it clear that separate sessions should be used for:

- different users;
- different accounts;
- different roles;
- different authentication states;
- independent parallel browser workflows.

The goal is that a user can say:

> Test this application as a buyer and an administrator.

without having to manually instruct the AI to call `browser_session_create` twice.

Every discovered tool also publishes a human-readable title, an object-root `outputSchema`, and
reviewed MCP risk hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`).
These hints improve client UX only; BrowserMesh never treats them as authorization.

Successful calls return schema-validated `structuredContent` with direct semantic fields. For
example, `browser_session_create` exposes `operationId`, `session`, and `initialPage` directly,
without a nested `value.value` envelope. A concise JSON text block remains for text-only clients.
Screenshots retain their in-memory MCP image block and add structured PNG/correlation metadata.

Application failures use `isError: true` and a bounded JSON error containing a stable code, safe
message, optional sanitized details, and `operationId` correlation when the runtime accepted the
operation. Raw causes, stacks, cycles, non-JSON values, and secret-bearing detail fields never cross
the MCP boundary. SDK input-schema failures remain distinguishable as MCP input-validation errors.

## Locators

Browser actions prefer semantic locator strategies.

Supported v0.1 strategies include:

- role;
- text;
- label;
- placeholder;
- test ID;
- CSS as an escape hatch.

Common interactive role values are supported by the v0.1 public contract.

Role names use exact accessible-name matching by default. Set `exact: false` only when partial
matching is intentional. If a locator resolves to multiple elements, BrowserMesh returns
`LOCATOR_AMBIGUOUS` and keeps the session usable.

Accessibility snapshots redact non-empty values from `input[type="password"]` elements before any
snapshot content crosses the MCP boundary.

BrowserMesh does not expose Playwright `Locator` objects through its public API.

## Persistence and sensitive state

BrowserMesh stores local persistence data beneath:

```text
.browsermesh/
```

by default.

Saved browser state may contain authentication credentials or equivalent sensitive browser state.

Therefore:

- `.browsermesh/` is ignored by Git;
- saved state must not be committed;
- saved state must not be published;
- logs must not contain storage-state contents;
- callers provide logical state IDs, not arbitrary filesystem paths.

Persistence represents serialized browser storage/auth state.

BrowserMesh never attempts to serialize a live `BrowserContext`, open pages, pending operations, or live browser process state.

## Configuration

| Environment variable       |        Default | Meaning                                       |
| -------------------------- | -------------: | --------------------------------------------- |
| `BROWSERMESH_TIMEOUT_MS`   |        `10000` | Default bounded operation timeout             |
| `BROWSERMESH_DATA_DIR`     | `.browsermesh` | Private local data directory                  |
| `BROWSERMESH_LOG_LEVEL`    |         `info` | `debug`, `info`, `warn`, `error`, or `silent` |
| `BROWSERMESH_MAX_SESSIONS` |           `50` | Active session limit                          |
| `BROWSERMESH_MAX_PAGES`    |           `20` | Managed pages per session                     |
| `BROWSERMESH_PERSISTENCE`  |         `true` | Enable saved browser state                    |
| `BROWSERMESH_HEADLESS`     |        `false` | Launch Chromium without a visible window      |

Configuration is read and validated centrally.

BrowserMesh launches Chromium in headed mode by default so the user can observe browser automation.
Set `BROWSERMESH_HEADLESS=true` for CI, servers, and other environments without a display. Only the
literal values `true` and `false` are accepted; invalid values fail configuration instead of being
silently ignored. Browser startup remains lazy in either mode, so MCP discovery and actionable
setup errors stay available when Chromium has not been installed yet. The configured
`BROWSERMESH_TIMEOUT_MS` also bounds browser launch. Set a larger per-tool `timeoutMs` only for
operations that are expected to take longer than the safe default.

Direct scattered `process.env` access throughout the codebase is not allowed.

## Logging

MCP stdio reserves stdout for protocol traffic.

BrowserMesh structured logs therefore go to stderr.

Logs may contain safe correlation information such as:

- `operationId`;
- `sessionId`;
- `pageId`;
- tool/operation name;
- duration;
- safe error code.

Logs must not contain:

- cookies;
- tokens;
- saved state;
- page contents;
- screenshots;
- form values;
- passwords;
- arbitrary message payloads.

## Chromium disconnect behavior

BrowserMesh does not silently reconstruct live sessions if Chromium unexpectedly disconnects.

Affected sessions transition to a failed state and their live handles are invalidated.

Existing sessions are never silently recreated because doing so would violate BrowserMesh state guarantees.

A fresh Chromium process may be started for future newly created sessions if the runtime can safely recover, but old live sessions remain failed.

## Development

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run test:e2e
npm run test:stress
npm run test:coverage
npm run build
npm run verify
```

Browser integration/e2e tests use real Chromium together with a deterministic loopback HTTP test server.

Tests do not depend on public websites.

See:

- [Technical specification](docs/SPEC.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Contributing](CONTRIBUTING.md)
- [Release process](docs/releasing.md)
- [Security policy](SECURITY.md)
- [Architecture decisions](docs/decisions/)

Pull request titles follow Conventional Commits. Every PR is checked by the full test matrix,
package-install smoke tests, semantic-title validation, and CodeQL. Releases are prepared by
Release Please and published to npm through GitHub OIDC only after a maintainer merges the
generated Release PR.

BrowserMesh is distributed under the [Apache License 2.0](LICENSE).

## Intentional v0.1 limitations

BrowserMesh v0.1 intentionally does not include:

- Firefox/WebKit parity;
- remote Streamable HTTP;
- BrowserMesh-hosted cloud infrastructure;
- multi-tenant authentication;
- distributed browser workers;
- live-operation crash recovery;
- internal Agent entities;
- internal session ownership tied to LLM agents;
- Agent registries;
- mailboxes;
- agent-to-agent messaging;
- internal LLM calls;
- prompt orchestration;
- Claude/Codex/Qwen process spawning;
- arbitrary shell execution;
- arbitrary filesystem reads;
- caller-controlled screenshot paths;
- downloads;
- web dashboard;
- network allowlist;
- full Playwright API.

A future generic client/workflow lease may be introduced if real multi-client protection requires it.

Such a lease must remain independent of LLM/Agent abstractions.

## Core v0.1 guarantee

Within one BrowserMesh runtime:

- sessions are explicitly addressed;
- pages are explicitly addressed;
- each session has an isolated browser context;
- different sessions may execute concurrently;
- operations targeting one session execute deterministically through that session's queue;
- failures do not poison future queued operations;
- persisted state is handled through controlled logical identifiers;
- shutdown cleans up live browser resources;
- BrowserMesh performs browser execution while reasoning remains outside the runtime.
