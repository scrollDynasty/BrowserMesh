# BrowserMesh v0.1 — Technical Specification

Status: MVP responsibility boundary

## 1. Product definition

BrowserMesh is an open-source local runtime that exposes multiple isolated browser sessions over MCP.

The intended flow is:

```text
User → external AI client → MCP → BrowserMesh → isolated browser sessions
```

Claude Code, Codex, Cursor, Qwen, or another MCP client performs reasoning and orchestration. BrowserMesh provides browser capabilities only. A user normally configures BrowserMesh once in the external client and asks that client to complete browser tasks.

BrowserMesh is not an LLM framework, an internal agent runtime, a message bus, a Playwright fork, or a browser GUI.

## 2. Core guarantee

Browser actions within one BrowserSession are logically isolated from actions in every other BrowserSession. A session must not accidentally expose another session's:

- cookies or localStorage;
- authentication state;
- browser context;
- pages or page references;
- URLs, DOM snapshots, screenshots, or form state.

Each v0.1 session maps to a distinct Playwright `BrowserContext`. One Chromium process may host many contexts.

## 3. Explicit addressing

Every browser operation requires `sessionId`. Every page operation also requires `pageId`. There is no global current session, active page, current page, or current tab.

A newly created session has one deterministic initial page, returned by `browser_page_list` and marked `isDefault`. The default marker is informational; page operations remain explicitly addressed.

Session `name` and string `metadata` are optional neutral labels. An external client may use metadata such as `role=buyer` or `account=work` to organize workflows. Metadata does not create an internal Agent, owner, mailbox, permission boundary, or lease.

When a browser task involves different users, accounts, roles, or authentication states, the MCP client should create a separate session for each identity.

## 4. v0.1 scope

### Sessions

- create, list, get, close;
- unique immutable ID;
- lifecycle statuses: creating, ready, closing, closed, failed;
- optional name and metadata;
- configurable active-session limit;
- idempotent close.

### Pages

- initial page per session;
- create, list, close;
- unique page ID;
- configurable per-session page limit;
- cross-session page IDs rejected.

### Browser actions

- navigate, back, forward, reload;
- current URL and title;
- semantic click, fill, press, select option;
- accessibility-oriented snapshot and visible text;
- PNG screenshot returned in memory.

### Locator strategies

- role, text, label, placeholder, test ID;
- CSS as an escape hatch;
- extensible contract that does not expose Playwright locator objects.

### Concurrency

- different sessions execute concurrently;
- changing operations in one session are serialized by an independent per-session queue;
- no global runtime lock;
- every page operation has an operation ID;
- blocking operations have configurable bounded timeouts.

### Persistence

- save cookies/localStorage state;
- create a new session from saved state;
- list and remove saved states;
- filesystem adapter beneath `.browsermesh/` by default;
- safe logical state names, no arbitrary caller paths;
- no attempt to serialize a live `BrowserContext`.

### MCP

- TypeScript MCP SDK;
- local stdio transport;
- schema-validated tool inputs;
- application service calls only, never direct Playwright calls from handlers;
- typed error mapping with MCP `isError` responses;
- tool descriptions sufficient for an AI client to choose separate sessions for separate identities.

## 5. Explicit non-scope

BrowserMesh v0.1 does not contain:

- Agent entities or an Agent registry;
- agent creation/removal MCP tools;
- internal LLM reasoning or prompt orchestration;
- session ownership tied to an AI-agent abstraction;
- agent mailboxes, messaging, handoff, request/response, or message correlation;
- `browser_agent_*`, `browser_message_*`, session assign, or session release tools;
- authentication service, web dashboard, database, Redis, queue, broker, workers, microservices, Docker, Kubernetes, or cloud infrastructure;
- arbitrary shell execution, arbitrary filesystem reads, downloads, or a full Playwright API;
- Firefox/WebKit parity or remote Streamable HTTP.

Generic client/workflow leases may be considered later if a real multi-client protection requirement exists. They must remain independent of LLM/Agent concepts.

## 6. Architecture

BrowserMesh uses a modular monolith:

- **Domain**: session/page views, locators, operation results, typed errors. No Playwright, MCP, filesystem, or transport imports.
- **Application ports**: browser engine, persistence, and event contracts.
- **Runtime**: session/page registries, lifecycle, routing, per-session queues, limits, persistence orchestration, shutdown.
- **Adapters**: Playwright, MCP, filesystem persistence.
- **Infrastructure**: centralized configuration, IDs, structured logging.

Allowed dependency direction is adapters → runtime/application → domain. The Playwright adapter is the only layer that manipulates `Browser`, `BrowserContext`, and `Page`. MCP handlers call runtime/application services.

## 7. Browser lifecycle and shutdown

BrowserMesh lazily starts or explicitly starts one Chromium process. On shutdown it:

1. stops accepting new operations;
2. drains operations already queued;
3. closes sessions/contexts;
4. closes Chromium;
5. closes the transport/process connection;
6. reports cleanup failures rather than swallowing them.

Session initialization is queued with lifecycle operations so shutdown cannot leak a context created concurrently.

## 8. Error contract

Public error categories:

- `SESSION_NOT_FOUND`, `SESSION_NOT_READY`, `SESSION_CLOSED`;
- `PAGE_NOT_FOUND`;
- `INVALID_ARGUMENT`, `LIMIT_EXCEEDED`;
- `OPERATION_TIMEOUT`, `NAVIGATION_FAILED`, `ELEMENT_NOT_FOUND`;
- `BROWSER_ERROR`, `RUNTIME_SHUTTING_DOWN`, `SAVED_STATE_NOT_FOUND`;
- `INTERNAL_ERROR`.

Raw Playwright stacks are not public MCP contracts. Underlying causes may be retained internally but secrets must not be logged.

## 9. Security

- Configuration reads environment variables centrally.
- Structured logs go to stderr and never include cookies, tokens, storage state, page content, form values, or screenshots.
- Persistence paths are controlled by the configured data directory; state names cannot traverse directories.
- `.browsermesh/` is ignored by Git and documented as sensitive.
- Screenshots are returned as MCP image content, not written to caller-selected paths.
- Navigation accepts absolute HTTP(S) URLs only.
- BrowserMesh never exposes a shell tool.

## 10. MCP tools

Session/page:

- `browser_session_create`, `browser_session_list`, `browser_session_get`, `browser_session_close`;
- `browser_page_create`, `browser_page_list`, `browser_page_close`.

Navigation/actions/inspection:

- `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`;
- `browser_get_url`, `browser_get_title`, `browser_snapshot`, `browser_visible_text`;
- `browser_click`, `browser_fill`, `browser_press`, `browser_select_option`;
- `browser_screenshot`.

Persistence:

- `browser_state_save`, `browser_state_list`, `browser_state_remove`;
- `browser_session_create.fromState` restores state.

## 11. Configuration

- headless/headed Chromium;
- default operation timeout;
- data directory;
- log level;
- maximum active sessions;
- maximum pages per session;
- persistence enabled/disabled.

## 12. Implementation phases

1. Foundation: strict TypeScript, formatting, lint, test framework, config, logging, docs.
2. Browser engine: port, Playwright adapter, start/stop, graceful shutdown.
3. Multi-session core: session registry/lifecycle, BrowserContext-per-session, cleanup.
4. Pages: explicit IDs and lifecycle.
5. Browser actions and semantic locators.
6. Concurrency: per-session queues, cross-session parallelism, operation IDs, timeouts.
7. MCP: stdio server, schemas, errors, real client integration.
8. Persistence: safe storage-state save/restore/list/remove.
9. External-client workflow demo: one MCP client coordinates multiple explicitly labeled sessions without any internal Agent model.

## 13. Testing requirements

Unit tests cover session registry/lifecycle, queue ordering, limits, error mapping, input validation, and safe persistence naming without real Chromium where unnecessary.

Real Chromium integration tests cover:

- separate contexts, cookies, localStorage, pages, and URLs;
- concurrent operations in different sessions;
- deterministic serialization within one session;
- page lifecycle, actions, snapshots, screenshots;
- storage-state save/close/restore;
- shutdown and resource cleanup.

MCP integration tests cover tool discovery, descriptions, validation, calls, structured errors, stdio process startup, and clean exit.

The external-client e2e scenario uses separate buyer and seller sessions as workflow labels only. BrowserMesh does not represent, reason for, own, or message between those roles.

Stress coverage scales to 50 bounded concurrent sessions and verifies routing and cleanup without turning the test into a local denial of service.

## 14. Acceptance criteria

An external MCP client can:

1. create two independently labeled sessions for different roles/accounts;
2. obtain explicit page IDs;
3. navigate and interact with both concurrently;
4. observe correct independent URLs, cookies, storage, pages, DOM, and screenshots;
5. persist and restore supported browser state;
6. close sessions and the server without resource leaks.

No internal Agent/message/ownership API is present. Typecheck, lint, formatting, unit, integration, e2e, stress, build, stdio, and package-install verification must pass.
