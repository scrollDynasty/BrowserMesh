# BrowserMesh

**Run many browser sessions at once, fully isolated from each other, from one MCP server.**

Every other browser MCP server gives your AI client one browser with a current tab. BrowserMesh
gives it as many independent sessions as the task needs — each with its own cookies, storage, and
authentication — running in parallel. Test checkout as a customer while an admin session verifies
the order, in one conversation, without either seeing the other's state.

- [Documentation](https://scrolldynasty.github.io/BrowserMesh/)
- [Getting started](https://scrolldynasty.github.io/BrowserMesh/guide/getting-started)
- [MCP tool reference](https://scrolldynasty.github.io/BrowserMesh/reference/tools)

```text
External AI client
        |
     MCP stdio
        |
BrowserMesh runtime
   |         |         |
Session A  Session B  Session C
Context A  Context B  Context C
```

The external client reasons and plans. BrowserMesh executes browser operations, enforces isolation,
orders work within each session, and returns structured results.

Works with Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Qwen, and any other MCP-compatible
client.

## Quick start

Claude Code:

```sh
claude mcp add browsermesh -- npx -y browsermesh
```

Any other client, in its MCP configuration file:

```json
{
  "mcpServers": {
    "browsermesh": {
      "command": "npx",
      "args": ["-y", "browsermesh"]
    }
  }
}
```

That is the whole setup. On its first start BrowserMesh downloads the Chromium build it uses, so
there is no separate install step. Pass `--no-auto-install` to manage the browser yourself, in
which case MCP discovery still works and `browser_session_create` returns an actionable
`BROWSER_ERROR` explaining what to run.

Then ask for the work in plain language:

> Test the checkout flow as a buyer and confirm the order appeared, as an admin, at the same time.

The client creates one session per role on its own. BrowserMesh also publishes a `parallel_roles`
prompt that spells the workflow out, so a client can offer it directly.

Check an installation without starting the protocol:

```sh
npx -y browsermesh --doctor
```

Chromium and BrowserMesh remain on your machine. There is no hosted BrowserMesh service.

> **Renamed in 0.2.** The npm package was `multi-agent-browser-mcp` and is now `browsermesh`,
> matching the name everything else already used. Change `args` to `["-y", "browsermesh"]`;
> nothing else moves.

## v0.1 architecture

BrowserMesh v0.1 is intentionally small: one local Node.js process, one Chromium process, and one
non-persistent `BrowserContext` for every ready session.

It provides:

- explicit session and page addressing;
- isolated browser contexts and page ownership checks;
- navigation, inspection, interaction, waits, capture, and persistence;
- per-session serialization with parallel execution across independent sessions;
- bounded timeouts, structured errors, graceful shutdown, and resource cleanup;
- MCP stdio integration with deterministic integration and end-to-end tests.

BrowserMesh is a browser runtime, not an internal agent framework, LLM orchestrator, message bus,
Playwright fork, browser GUI, or interactive shell.

## How it is normally used

1. Configure BrowserMesh once in an MCP-compatible AI client.
2. The client starts BrowserMesh over stdio and discovers its tools.
3. Describe the browser task in natural language.
4. The client creates the required sessions and chooses the tools to invoke.
5. BrowserMesh executes the operations and returns structured results.

Use a separate session for each user, account, role, authentication state, or independent parallel
workflow. BrowserMesh tools are normally selected by the external client rather than called by hand.

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

Each `timeoutMs` is one absolute budget starting when BrowserMesh accepts the operation. Time spent
waiting in the owning session queue and every later browser-adapter step consume that same budget;
no adapter step receives a renewed full timeout.

MCP request cancellation is propagated into BrowserMesh as an engine-independent operation signal.
A same-session request cancelled while queued is skipped before it can touch browser state. If a
Playwright action is already running and cannot be aborted safely, BrowserMesh keeps its queue slot
until the real action settles, so later work cannot overtake it. Passive waits detach their owned
abort listeners and timers promptly, and the session queue remains usable after cancellation. MCP
clients observe their SDK's cancellation error (typically an `AbortError`, or an MCP error carrying
that reason); a separate tool result after protocol cancellation is not guaranteed.

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

- `browser_runtime_info`
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

`browser_snapshot` is bounded by default and may be restricted with a semantic/CSS `scope`,
`interactiveOnly`, per-node `maxChildren`, `maxDepth`, `includeBoundingBoxes`, `maxChars`, and
`maxBytes`. Its structured result reports every applied bound, intentional tree omission, and
character/UTF-8 byte count. When either response cap is reached,
`partial=true`, `truncation.truncated=true`, and `contentFormat=aria-yaml-fragment`; do not parse
that fragment as a complete ARIA YAML document. Password values remain redacted. Set
`includeRefs=true` to receive at most `maxRefs` (default 50, maximum 100) opaque interactive-element
refs for immediate follow-up actions. Refs expire after 30 seconds, are scoped to the exact
session/page, and become stale after navigation, DOM replacement, page close, expiry, or a newer
ref snapshot. A non-null `nextCursor` continues the same immutable captured serialization without
rereading a changed DOM. Cursors are scoped to the exact session/page, expire after 30 seconds, and
become stale after navigation, page close, quota eviction, or shutdown. At most four paginated
snapshots and 1,000,000 Unicode code points per captured snapshot are retained per page.
Before native ARIA serialization, BrowserMesh also rejects a scope exceeding 20,000 DOM/text nodes
or 2,000,000 source characters. This pre-capture budget limits browser-side work independently of
the smaller per-response and retained-cursor bounds.

### Observability

- `browser_observe`

One tool reads all four recorded sources, selected by `source`: `console`, `pageError`, `network`,
or `requestFailed`. It requires an explicit `sessionId` and `pageId`, and echoes `source` so results
read into one buffer stay distinguishable.

Console and page-error reads are metadata-only by default; set `includeText=true` for bounded,
best-effort-redacted evidence. The two network sources carry no text and reject that flag rather
than returning a metadata-only answer that looks complete. Use `nextCursor` as the next
non-destructive `sinceEventId` checkpoint. Always inspect `gap` and `droppedCount` before concluding
that an event was absent. Text may be truncated further to satisfy the total response-byte limit;
the event and its cursor are still returned so pagination cannot stall. BrowserMesh never captures
console argument objects or raw error stacks.

Network reads expose only correlated request/response/request-failed metadata: a bounded request
ID, method, sanitized URL, resource type, status, duration, and safe failure classification where
applicable. Credentials and fragments are removed and sensitive query values are redacted before
storage. Headers, bodies, cookies, storage, service-worker traffic, WebSockets, `data:` URLs, and
`blob:` URLs are excluded. Page-originated HTTP(S) EventSource requests are included as ordinary
network metadata. HTTP error responses such as 500 appear under `source: "network"`; only
transport-level failures appear under `source: "requestFailed"`.

> Before 0.2 these were four tools — `browser_console_list`, `browser_page_errors_list`,
> `browser_network_list`, and `browser_failed_requests_list` — publishing four copies of one
> contract. Pass the matching `source` instead.

### Interaction

- `browser_click`
- `browser_double_click`
- `browser_hover`
- `browser_focus`
- `browser_check`
- `browser_uncheck`
- `browser_scroll_into_view`
- `browser_scroll`
- `browser_drag_and_drop`
- `browser_fill`
- `browser_press`
- `browser_select_option`

These typed operations accept exactly one semantic/CSS locator or short-lived snapshot `ref`. They are explicitly
addressed, bounded by `timeoutMs`, cancellation-aware, and serialized with all browser work in the
owning session. `check` and `uncheck` ensure the requested state idempotently. `browser_scroll`
accepts bounded integer pixel deltas (`deltaX` and `deltaY` from -1,000,000 through 1,000,000),
while drag-and-drop resolves both source and target with the same strict locator semantics. None of
these tools exposes arbitrary page JavaScript.

### Deterministic waits

- `browser_wait`
- `browser_action_and_wait`

`browser_wait` observes one passive, typed condition through the owning session queue: an exact or
safe-glob URL, `domcontentloaded`/`load`, locator state, or bounded text presence/absence. Text
matching is a case-sensitive substring check against at most the first 1,000,000 characters of
the page body's rendered `innerText`; `absent` means that substring is not present in that bounded
observation. Caller regular expressions, JavaScript predicates, arbitrary sleeps, and
`networkidle` are not supported.

Do not queue a passive wait before the same-session action expected to satisfy it.
`browser_action_and_wait` registers a typed navigation, HTTP response, popup, or dialog waiter first
and then performs one click or key press under one shared deadline. Returned response URLs remove
credentials and fragments and redact common sensitive query values. A popup is assigned a new
managed `pageId` in the same session with `isDefault=false`; overflow popups are closed before
`LIMIT_EXCEEDED` is returned. Dialogs are handled atomically with an expected type and accept/dismiss
choice because a blocking dialog cannot be safely inspected later. Prompt input and returned dialog
metadata are bounded.

`browser_action_and_wait` addresses its action with `target`, taking a semantic/CSS locator or a
snapshot `ref` exactly like the standalone interaction tools. Neither result restates the request:
`browser_wait` returns `satisfied`, and `browser_action_and_wait` returns the observed `event`. The
caller already holds the condition and action it sent, and `operationId` correlates the result.

### Capture

- `browser_screenshot`

Screenshots are returned as MCP image content instead of being written to a caller-controlled
filesystem path. The optional `capture` mode selects the viewport, the full scrollable page, or one
strictly resolved semantic/CSS element; the default remains the viewport. Structured output reports
actual PNG width, height, and encoded bytes. BrowserMesh measures CSS-pixel dimensions before capture
and validates actual PNG dimensions and bytes afterward. Full-page and element modes capture the
fixed measured clip, so later page growth cannot expand native image allocation. Configured
overflow returns `LIMIT_EXCEEDED` and does not poison the session queue.

### Persistence

- `browser_state_save`
- `browser_state_list`
- `browser_state_remove`

`browser_session_create` accepts an optional `stateId`.

Without `stateId`, it creates a fresh isolated context.

With `stateId`, it initializes the new context using a previously saved BrowserMesh state.

Saved-state count, individual bytes, and aggregate bytes are centrally bounded. Quota checks and
atomic replacement are serialized across all state IDs; a rejected replacement preserves the old
state. Existing files are size-checked and read with a hard bound before JSON parsing.

`browser_session_create` also accepts an optional `contextSettings` object for an isolated viewport,
device scale factor, locale, timezone, color scheme, reduced-motion preference, and user agent. The
session result returns the normalized effective settings. Use separate sessions for different
device/accessibility/permission profiles. Geolocation is optional and the only supported browser
permission is an explicit grant to one absolute HTTP(S) origin. Wildcards and arbitrary permission
names are rejected.

```text
browser_session_create({
  name: "mobile-fr",
  contextSettings: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "dark",
    reducedMotion: "reduce"
  }
})
```

Geolocation access must be scoped to the exact application origin:

```text
browser_session_create({
  name: "local-map-test",
  contextSettings: {
    geolocation: { latitude: 41.3111, longitude: 69.2797, accuracy: 25 },
    permissions: [
      { permission: "geolocation", origin: "https://maps.example.test" }
    ]
  }
})
```

The permission is isolated to that session context and is removed when the session closes. Saved
storage state does not contain or restore BrowserMesh permission grants.

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

Any locator may optionally set `frame` to `{ "kind": "main" }` or to a bounded
`{ "kind": "iframe", "chain": [...] }` of one through five outer-to-inner semantic/CSS iframe
element selectors. Each chain step must resolve exactly; numeric indexes and persistent frame
handles are not exposed. The same scope works for actions, locator waits, visible text, snapshot
scope/ref capture, element screenshots, and drag/drop endpoints. Cross-origin iframe content is
returned only when the caller explicitly requests that scoped evidence.

Accessibility snapshots redact non-empty values from `input[type="password"]` elements before any
snapshot content crosses the MCP boundary.

BrowserMesh does not expose Playwright `Locator` objects through its public API.

Element refs are conveniences for immediate snapshot-to-action workflows, not durable identity.
Invalid, expired, cross-page, or detached refs return `STALE_ELEMENT_REFERENCE`; semantic locators
remain preferred for durable tests. BrowserMesh does not use undocumented Playwright AI/ref
selectors or expose adapter-owned element handles.

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

| Environment variable                       |          Default | Meaning                                        |
| ------------------------------------------ | ---------------: | ---------------------------------------------- |
| `BROWSERMESH_TIMEOUT_MS`                   |          `10000` | Default bounded operation timeout              |
| `BROWSERMESH_DATA_DIR`                     | `~/.browsermesh` | Private local data directory                   |
| `BROWSERMESH_LOG_LEVEL`                    |           `info` | `debug`, `info`, `warn`, `error`, or `silent`  |
| `BROWSERMESH_MAX_SESSIONS`                 |             `50` | Active session limit                           |
| `BROWSERMESH_MAX_PAGES`                    |             `20` | Managed pages per session                      |
| `BROWSERMESH_PERSISTENCE`                  |           `true` | Enable saved browser state                     |
| `BROWSERMESH_HEADLESS`                     |          `false` | Launch Chromium without a visible window       |
| `BROWSERMESH_SCHEMA_REFS`                  |           `true` | Share repeated subschemas via `$defs`/`$ref`   |
| `BROWSERMESH_AUTO_INSTALL`                 |           `true` | Download Chromium on first start if missing    |
| `BROWSERMESH_TOOLS`                        |            (all) | Tool profiles to publish, comma-separated      |
| `BROWSERMESH_OBSERVABILITY_EVENTS`         |            `200` | Retained mixed observability events per page   |
| `BROWSERMESH_OBSERVABILITY_STRING_CHARS`   |           `2048` | Maximum exposed event string length            |
| `BROWSERMESH_OBSERVABILITY_PAGE_SIZE`      |            `100` | Maximum events returned by one read            |
| `BROWSERMESH_OBSERVABILITY_RESPONSE_BYTES` |          `65536` | Maximum serialized observability response size |
| `BROWSERMESH_SCREENSHOT_MAX_DIMENSION`     |          `10000` | Maximum PNG width or height in CSS pixels      |
| `BROWSERMESH_SCREENSHOT_MAX_PIXELS`        |       `40000000` | Maximum total PNG pixels                       |
| `BROWSERMESH_SCREENSHOT_MAX_BYTES`         |       `16777216` | Maximum encoded PNG bytes                      |
| `BROWSERMESH_VISIBLE_TEXT_MAX_CHARS`       |          `20000` | Maximum returned Unicode code points           |
| `BROWSERMESH_VISIBLE_TEXT_MAX_BYTES`       |          `65536` | Maximum returned visible-text UTF-8 bytes      |
| `BROWSERMESH_MAX_SAVED_STATES`             |            `100` | Maximum persisted logical states               |
| `BROWSERMESH_MAX_STATE_BYTES`              |        `1048576` | Maximum bytes in one persisted state           |
| `BROWSERMESH_MAX_STATE_TOTAL_BYTES`        |       `16777216` | Maximum aggregate persisted-state bytes        |

The options the command line accepts are `--headless`, `--headed`, `--timeout`, `--data-dir`,
`--log-level`, `--max-sessions`, `--max-pages`, `--tools`, `--no-persistence`, `--no-schema-refs`,
and `--no-auto-install`. Each sets the variable above that already configures it, and the command
line wins. The remaining variables — the observability, screenshot, visible-text, and persistence
budgets — are set through the environment only. Run `browsermesh --help` for the current list. A
rejected value names the variable it came from and exits with status 2 instead of printing a stack
trace.

Saved state lives under the user's home directory rather than the working directory. An MCP client
starts BrowserMesh from whichever directory it happens to be in, so a relative default scattered
saved authentication across unrelated folders and made `browser_state_list` come back empty for no
visible reason. Pass `--data-dir .browsermesh` for the previous project-scoped behaviour.

Configuration is read and validated centrally.

## Publishing fewer tools

Discovery costs context, once per session, in every client. `--tools` narrows what BrowserMesh
publishes to the profiles a workflow actually needs:

| Profile         | Tools | Contents                                                           |
| --------------- | ----: | ------------------------------------------------------------------ |
| `core`          |    31 | Sessions, pages, navigation, reading, interaction, waits, capture  |
| `observability` |     1 | `browser_observe`                                                  |
| `persistence`   |     3 | `browser_state_save`, `browser_state_list`, `browser_state_remove` |

Omitting `--tools` publishes every profile, so an existing configuration keeps the tools it had.

```sh
npx -y browsermesh --tools core,persistence
```

Published schemas share their repeated subschemas through `$defs`/`$ref`, which every JSON Schema
2020-12 validator resolves. Set `--no-schema-refs` for a client whose validator does not.

## Prompts and resources

BrowserMesh publishes two MCP prompts, so a client can offer the workflow rather than having to
infer it:

- `parallel_roles` — carry one task out as several roles at once, one isolated session each.
- `diagnose_page` — load a page and collect console, page-error, and network evidence about it.

It also publishes one read-only resource, `browsermesh://sessions`, listing the sessions the runtime
currently holds with their status and labels.

Both are static templates. BrowserMesh renders text and returns it; it makes no LLM call and keeps
no per-client state. The client still reasons and decides which tools to call.

BrowserMesh launches Chromium in headed mode by default so the user can observe browser automation.
Set `BROWSERMESH_HEADLESS=true` for CI, servers, and other environments without a display. Only the
literal values `true` and `false` are accepted; invalid values fail configuration instead of being
silently ignored. Browser startup remains lazy in either mode, so MCP discovery and actionable
setup errors stay available when Chromium has not been installed yet. The configured
`BROWSERMESH_TIMEOUT_MS` also bounds browser launch. Set a larger per-tool `timeoutMs` only for
operations that are expected to take longer than the safe default.

Session labels are bounded even for direct runtime callers: names allow at most 128 Unicode code
points, metadata at most 32 entries, and keys/values have character, UTF-8 byte, and aggregate byte
limits. Control characters and dangerous object keys are rejected before BrowserMesh allocates a
session ID, context, or page. `browser_visible_text` retains its `text` field and adds explicit
truncation metadata so a client can distinguish complete evidence from a bounded prefix.

Direct scattered `process.env` access throughout the codebase is not allowed.

`browser_runtime_info` is safe to call before creating a session. It reports exact BrowserMesh,
Node, and resolved Playwright versions; effective configuration and limits; browser launch state;
nullable live Chromium version; and active/failed session counts. It does not launch Chromium and
does not expose paths, environment values, browser state, or raw failures.

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
