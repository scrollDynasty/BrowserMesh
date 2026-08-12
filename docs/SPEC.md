# BrowserMesh v0.1 — Technical Specification

Status: MVP responsibility and behavioral contract

## 1. Product definition

BrowserMesh is an open-source local runtime that exposes multiple isolated browser sessions over MCP.

The intended responsibility boundary is:

```text
User
  ↓
external AI client
  ↓ MCP
BrowserMesh
  ↓
isolated browser sessions
```

Claude Code, Codex, Cursor, Qwen, or another MCP-compatible client performs reasoning and workflow orchestration.

BrowserMesh provides deterministic browser capabilities.

A normal user configures BrowserMesh once in their external AI client and then asks that client to complete browser tasks.

BrowserMesh is not:

- an LLM framework;
- an internal AI-agent runtime;
- an internal Agent registry;
- a message bus;
- a prompt orchestration framework;
- a Playwright fork;
- a browser GUI;
- an interactive shell that is required for normal usage.

The primary BrowserMesh interface for v0.1 is MCP stdio.

## 2. Core guarantee

Browser actions within one `BrowserSession` are logically isolated from actions in every other `BrowserSession`.

A session must not accidentally expose another session's:

- cookies;
- browser storage/authentication state;
- browser context;
- pages;
- page references;
- URLs;
- DOM snapshots;
- screenshots;
- form state.

Each ready v0.1 session maps to a distinct Playwright `BrowserContext`.

One Chromium process may host many isolated contexts.

BrowserMesh does not expose Playwright objects in its public contracts.

## 3. Explicit addressing

Every browser operation requires `sessionId`.

Every page-specific operation also requires `pageId`.

There is no global:

- current session;
- active session;
- current page;
- active page;
- current tab.

A newly created session contains one deterministic initial page.

`browser_session_create` returns:

- the new session identity;
- the initial page identity.

The initial page also appears in `browser_page_list` and is marked `isDefault`.

The default marker is informational only. Page operations remain explicitly addressed with `pageId`.

A `pageId` belonging to one session must be rejected when used with a different `sessionId`.

The public failure for cross-session page addressing is `PAGE_NOT_FOUND` unless a more specific safe public error is deliberately introduced by a future specification.

## 4. Neutral labels

Sessions may have:

- an optional human-readable `name`;
- optional string metadata.

An external client may use metadata such as:

```text
role=buyer
role=seller
account=work
```

to organize its own workflow.

Metadata does not create:

- an internal Agent;
- an owner principal;
- a mailbox;
- a permission boundary;
- a message channel;
- a lease.

When a browser task involves different users, accounts, roles, or authentication states, MCP tool descriptions must give the external client enough information to infer that a separate BrowserMesh session should normally be created for each identity.

## 5. v0.1 scope

### 5.1 Sessions

BrowserMesh supports:

- create;
- list;
- get;
- close.

Each session has:

- a unique immutable ID;
- lifecycle status;
- creation time;
- last-activity information where useful;
- optional name;
- optional string metadata.

Minimum lifecycle states:

- `creating`;
- `ready`;
- `closing`;
- `closed`;
- `failed`.

The runtime enforces a configurable active-session limit.

A close request against a known closing or closed session is idempotent.

A completely unknown session ID returns `SESSION_NOT_FOUND`.

Implementation may retain a bounded lightweight tombstone/view for recently closed sessions in order to provide deterministic idempotent-close behavior.

Closed sessions must not retain live Playwright handles.

### 5.2 Session creation result

`browser_session_create` creates one deterministic initial page and returns enough information for the caller to perform a page operation immediately.

The result must include at minimum:

- `sessionId`;
- initial `pageId`.

The caller must not be forced to invoke `browser_page_list` before the first navigation.

### 5.3 Pages

BrowserMesh supports:

- initial page per session;
- create;
- list;
- close.

Each page has:

- a unique runtime-generated page ID;
- a session association;
- an optional `isDefault` informational marker.

The runtime enforces a configurable per-session page limit.

Public callers never receive Playwright `Page` objects.

### 5.4 Browser actions

v0.1 supports:

- navigate;
- back;
- forward;
- reload;
- current URL;
- title;
- semantic click;
- fill;
- press;
- select option;
- accessibility-oriented snapshot;
- visible text;
- screenshot returned in memory.

BrowserMesh does not attempt to expose the complete Playwright API.

### 5.5 Locator strategies

v0.1 supports engine-independent locator contracts for:

- role;
- text;
- label;
- placeholder;
- test ID;
- CSS as an escape hatch.

The public contract must remain extensible.

It must not expose Playwright `Locator` objects.

Role locator names match exactly by default. Callers may explicitly request partial matching.
Multiple matches return `LOCATOR_AMBIGUOUS` rather than being misclassified as a missing element.

Accessibility snapshots must redact non-empty values held by password inputs before returning
content across MCP.

### 5.6 Navigation policy

`browser_navigate` accepts absolute HTTP(S) URLs.

BrowserMesh v0.1 does not expose arbitrary navigation to:

- `file:`;
- `javascript:`;
- caller-controlled local filesystem resources.

Loopback HTTP(S) URLs remain valid and are used by deterministic tests.

## 6. Concurrency

Concurrency semantics are a core BrowserMesh guarantee.

### 6.1 Per-session serialization

Every operation targeting the live browser state of one session must pass through that session's independent serial operation queue.

This includes, where applicable:

- navigation;
- interactions;
- inspection;
- screenshots;
- page creation;
- page closing;
- state saving;
- browser-backed session lifecycle work.

Read-style browser operations such as snapshot, title, URL, or visible-text inspection must not bypass the session queue while another browser operation for that session is active.

Registry-only immutable session/page listing may use a safe deterministic snapshot without entering the browser-operation queue when it does not touch live engine state.

### 6.2 Cross-session parallelism

Different sessions use independent queues.

There is no global browser-operation mutex.

Operations targeting different sessions may execute concurrently.

### 6.3 Queue failure isolation

A failed, rejected, or timed-out operation must not poison a session queue.

After the failed operation has settled, later operations that were validly accepted must continue processing normally.

The implementation must explicitly test this property.

### 6.4 Operation IDs

Every externally initiated BrowserMesh runtime operation receives a unique `operationId`.

This includes MCP operations for:

- sessions;
- pages;
- browser actions;
- persistence.

`operationId` is used for:

- structured logging;
- correlation;
- debugging;
- future tracing.

### 6.5 Timeouts

Potentially blocking browser operations have bounded timeouts.

Timeout behavior is:

- centrally configurable;
- optionally overridable where the public contract permits;
- deterministic;
- mapped to safe typed public errors.

BrowserMesh must not intentionally permit infinite browser-operation waits.

## 7. Session close semantics

When closing a ready session:

1. the session transitions to `closing`;
2. it stops accepting new session-targeted browser operations;
3. previously accepted queued operations are drained;
4. its pages are closed;
5. its `BrowserContext` is closed;
6. live opaque engine handles are removed;
7. the session becomes `closed`.

Operations arriving after a session begins closing are rejected with a documented safe session-lifecycle error.

Close must not race with initialization in a way that leaks a newly created context.

Session initialization participates in lifecycle synchronization.

## 8. Browser lifecycle

BrowserMesh v0.1 uses one local Chromium process at a time under normal operation.

The process may start lazily or through an explicit runtime startup method according to the implementation ADR.

The selected behavior must remain deterministic and documented.

### 8.1 Graceful shutdown

On BrowserMesh shutdown:

1. stop accepting new externally initiated operations;
2. mark runtime shutdown state;
3. drain accepted work according to queue semantics;
4. close active sessions/contexts;
5. remove live page/context handles;
6. close Chromium;
7. close transport/process resources;
8. report cleanup failures instead of silently swallowing them.

Independent session cleanup may occur concurrently when safe.

### 8.2 Unexpected Chromium disconnect

BrowserMesh must detect an unexpected Chromium disconnect.

Affected live sessions transition to `failed`.

Their engine handles become invalid and must be cleaned from the runtime.

BrowserMesh must **not** silently reconstruct existing live sessions.

Silent reconstruction would make browser state ambiguous.

The runtime may start a fresh Chromium process for subsequently created new sessions if it can safely recover.

Existing failed sessions remain failed.

Automatic reconstruction of live sessions is outside v0.1 scope.

## 9. Persistence

BrowserMesh supports:

- save browser storage/auth state;
- create a new session using previously saved state;
- list saved states;
- remove saved states.

### 9.1 Session creation from state

`browser_session_create` accepts an optional logical `stateId`.

Without `stateId`:

- create a fresh isolated context.

With `stateId`:

- load previously saved BrowserMesh state;
- create a new isolated context initialized from that state.

There is no separate public tool named `browser_session_create.fromState`.

### 9.2 State identifiers

External callers provide logical state identifiers, not filesystem paths.

State identifiers must be validated using a conservative format.

Path traversal and caller-selected arbitrary locations are forbidden.

### 9.3 Save synchronization

Saving state from a live session is a session-targeted browser operation.

It must pass through the session's serial operation queue so that storage-state capture occurs at a deterministic point relative to navigation and interactions.

### 9.4 State storage

The initial implementation uses a filesystem repository beneath the configured BrowserMesh data directory.

Writes should use safe temporary-file + atomic-replace semantics where supported.

Saved state may contain sensitive authentication material.

The runtime must not log serialized state.

### 9.5 Persistence semantics

Persistence represents serialized browser storage/authentication state supported by the BrowserMesh Playwright adapter.

BrowserMesh does not serialize:

- a live `BrowserContext`;
- open `Page` objects;
- current DOM runtime;
- active operations;
- locks/queues;
- Chromium process state.

## 10. MCP

BrowserMesh v0.1 exposes its public runtime through MCP stdio.

MCP is an adapter/transport boundary.

MCP handlers:

1. validate tool input;
2. call runtime/application services;
3. map successful results;
4. map typed application errors into safe MCP error results.

MCP handlers must never directly manipulate:

- Playwright `Browser`;
- Playwright `BrowserContext`;
- Playwright `Page`;
- Playwright locators.

The MCP layer must not contain BrowserMesh domain logic.

## 11. MCP tool descriptions

Tool descriptions are part of the public product contract.

Descriptions must explain:

- what the tool does;
- when an AI client should use it;
- important isolation/addressing semantics.

`browser_session_create` must explicitly communicate that separate sessions should normally be created for:

- different users;
- different accounts;
- different application roles;
- different authentication states;
- independent parallel workflows.

The goal is to make natural-language workflows discoverable without requiring the human user to manually specify BrowserMesh tool calls.

An AI client given a task such as:

> Test this flow simultaneously as a buyer and an administrator.

should receive enough MCP tool metadata to infer that separate sessions are appropriate.

LLM behavior itself is not deterministic and is not required as a CI assertion.

Tool-description semantics must instead be covered through contract review/tests.

## 12. MCP tools

### Sessions/pages

- `browser_session_create`
- `browser_session_list`
- `browser_session_get`
- `browser_session_close`
- `browser_page_create`
- `browser_page_list`
- `browser_page_close`

### Navigation/actions/inspection

- `browser_navigate`
- `browser_back`
- `browser_forward`
- `browser_reload`
- `browser_get_url`
- `browser_get_title`
- `browser_snapshot`
- `browser_visible_text`
- `browser_click`
- `browser_fill`
- `browser_press`
- `browser_select_option`
- `browser_screenshot`

### Persistence

- `browser_state_save`
- `browser_state_list`
- `browser_state_remove`

`browser_session_create` supports optional `stateId` restoration.

## 13. Result and error contract

MCP inputs are schema validated.

Successful JSON-oriented results follow one consistent public shape.

Application failures follow one consistent safe public error shape and set MCP `isError: true`.

Public error categories include:

- `SESSION_NOT_FOUND`
- `SESSION_NOT_READY`
- `SESSION_CLOSING`
- `SESSION_CLOSED`
- `PAGE_NOT_FOUND`
- `INVALID_ARGUMENT`
- `LIMIT_EXCEEDED`
- `OPERATION_TIMEOUT`
- `NAVIGATION_FAILED`
- `ELEMENT_NOT_FOUND`
- `LOCATOR_AMBIGUOUS`
- `BROWSER_ERROR`
- `BROWSER_DISCONNECTED`
- `RUNTIME_SHUTTING_DOWN`
- `SAVED_STATE_NOT_FOUND`
- `PERSISTENCE_DISABLED`
- `INTERNAL_ERROR`

The implementation may refine the list through ADR/API contracts when necessary, but public codes must remain stable and safe.

Raw Playwright stack traces are not public MCP contracts. Browser and element failures expose a
bounded cause summary and safe operation context (for example URL, locator strategy/value,
operation, and timeout) so callers can distinguish connection, DNS, timeout, and locator failures.
A rejected operation must not disconnect MCP, destroy the runtime, or invalidate unrelated sessions.

## 14. Architecture

BrowserMesh uses a modular monolith.

### Domain

Contains stable BrowserMesh concepts such as:

- session/page public views;
- locators;
- operation results;
- typed errors;
- engine-independent value types.

Domain must not import:

- Playwright;
- MCP;
- filesystem adapters;
- transport implementations.

### Application ports

Declare contracts for:

- browser engine;
- persistence;
- event/observability sink;
- supporting infrastructure where needed.

### Runtime/application services

Own:

- session registry;
- page registry;
- lifecycle;
- explicit routing;
- session queues;
- limits;
- persistence orchestration;
- operation IDs;
- shutdown.

### Adapters

Implement external/concrete boundaries:

- Playwright browser engine;
- MCP;
- filesystem persistence.

### Infrastructure

Owns:

- centralized configuration;
- ID generation;
- structured logging;
- clock/helpers where useful.

Allowed conceptual dependency direction:

```text
adapters
   ↓
runtime/application
   ↓
domain
```

Application/runtime code depends on ports rather than concrete Playwright implementations.

## 15. Engine handle boundary

The public/domain model uses BrowserMesh IDs:

- `sessionId`;
- `pageId`.

Runtime may store engine-independent opaque handle values declared by `BrowserEnginePort`.

Only the Playwright adapter may resolve those opaque handles to actual:

- `BrowserContext`;
- `Page`;
- browser objects.

MCP and domain code must never receive those concrete objects.

## 16. Security

BrowserMesh v0.1 security rules:

- environment configuration is read centrally;
- logs use stderr under MCP stdio;
- logs do not contain cookies, tokens, storage state, page contents, screenshots, passwords, or form values;
- persistence uses controlled application paths;
- caller-controlled arbitrary paths are forbidden;
- state names cannot traverse directories;
- `.browsermesh/` is Git-ignored and documented as sensitive;
- screenshots are returned in memory;
- arbitrary shell execution is not exposed;
- arbitrary local filesystem reading is not exposed;
- navigation is limited to allowed absolute HTTP(S) URLs.

Browser automation is a privileged capability and future remote/multi-tenant modes require separate threat modelling.

## 17. Configuration

v0.1 configuration includes:

- visible headed Chromium launched lazily for the first browser session;
- default operation timeout;
- data directory;
- log level;
- maximum active sessions;
- maximum pages per session;
- persistence enabled/disabled.

Configuration is validated centrally.

MCP negotiation and tool discovery do not depend on a successful Chromium launch. A missing
Playwright browser binary is reported by `browser_session_create` as an actionable `BROWSER_ERROR`.

Scattered direct `process.env` access across the application is forbidden.

## 18. Explicit non-scope

BrowserMesh v0.1 does not contain:

- internal Agent entities;
- Agent registry;
- `browser_agent_*`;
- internal LLM reasoning;
- prompt orchestration;
- session ownership tied to AI Agent concepts;
- Agent mailboxes;
- Agent messaging;
- handoff/request/response protocols;
- `browser_message_*`;
- session assign/release tools;
- Claude/Codex/Qwen process spawning;
- authentication service;
- web dashboard;
- database;
- Redis;
- external broker;
- distributed workers;
- microservices;
- Docker as a runtime requirement;
- Kubernetes;
- BrowserMesh cloud infrastructure;
- arbitrary shell execution;
- arbitrary filesystem reads;
- downloads;
- full Playwright API;
- Firefox/WebKit parity;
- remote Streamable HTTP;
- live-session crash recovery.

Generic client/workflow leases may be considered later only if a real multi-client access-protection requirement exists.

Any future lease must remain independent of LLM/Agent concepts.

## 19. Implementation phases

### Phase 0 — Foundation

Implement:

- project structure;
- strict TypeScript;
- lint;
- formatting;
- tests;
- centralized configuration;
- structured logging;
- documentation;
- package scripts.

### Phase 1 — Browser engine

Implement:

- engine port;
- Playwright adapter;
- Chromium start;
- Chromium stop;
- unexpected disconnect handling;
- graceful engine cleanup.

### Phase 2 — Multi-session core

Implement:

- session model;
- registry;
- lifecycle;
- BrowserContext-per-session;
- create/list/get/close;
- initial page;
- cleanup;
- limits.

### Phase 3 — Pages

Implement:

- explicit page IDs;
- page create/list/close;
- cross-session rejection;
- page limits.

### Phase 4 — Browser operations

Implement:

- navigation;
- inspection;
- interactions;
- semantic locators;
- screenshot;
- typed error mapping.

### Phase 5 — Concurrency

Implement:

- per-session serial queues;
- cross-session parallelism;
- operation IDs;
- bounded timeouts;
- failed-operation queue recovery;
- close/operation lifecycle synchronization.

### Phase 6 — MCP

Implement:

- stdio server;
- validated tool schemas;
- tool descriptions;
- result mapping;
- error mapping;
- actual stdio client/server verification.

### Phase 7 — Persistence

Implement:

- state save;
- state list;
- state remove;
- optional `stateId` on session creation;
- safe logical state names;
- atomic filesystem persistence;
- secret-safe logging.

### Phase 8 — External-client workflow demo

Implement a deterministic multi-role workflow using one external MCP client model conceptually coordinating multiple isolated sessions.

Buyer and seller/admin are session labels only.

BrowserMesh must not create internal Agent entities.

### Phase 9 — Release readiness

Verify:

- clean build;
- complete test suite;
- package contents;
- `npm pack`;
- installation from the generated tarball into a clean temporary project;
- CLI/bin startup;
- MCP stdio tool discovery from packaged output;
- README quick-start correctness.

Prepare CI that verifies the repository on push/pull request.

Do not publish an npm package or create an external release without explicit authorization.

## 20. Testing requirements

### Unit tests

Cover:

- session registry/lifecycle;
- page registry;
- cross-session page rejection;
- queue ordering;
- queue recovery after failure/timeout;
- limits;
- error mapping;
- input validation;
- safe state naming;
- configuration validation.

Do not launch Chromium where a deterministic fake port is sufficient.

### Real Chromium integration tests

Cover:

- distinct BrowserContexts;
- cookie/storage isolation;
- page isolation;
- URL isolation;
- concurrent different-session operations;
- deterministic same-session serialization;
- failed-operation queue recovery;
- page lifecycle;
- actions;
- snapshots;
- screenshots;
- persistence save/close/restore;
- close with queued operations;
- operation after close begins;
- repeated close;
- shutdown during session initialization;
- shutdown with queued operations;
- unexpected Chromium disconnect where practical;
- resource cleanup.

### MCP integration tests

Cover:

- process startup;
- stdio transport;
- tool discovery;
- tool descriptions;
- input validation;
- successful calls;
- structured errors;
- explicit session/page routing;
- clean exit.

### External-client e2e

Use a deterministic local web application.

Create separate labeled sessions such as:

- buyer;
- seller;
- admin.

BrowserMesh only exposes the sessions.

The external MCP client conceptually coordinates the workflow.

No internal Agent model exists.

### Stress

Exercise a bounded concurrency profile scaling toward 50 sessions where the local/CI environment safely permits.

Verify:

- correct routing;
- isolation;
- queue independence;
- cleanup;
- absence of obvious listener/handle leaks.

Stress testing must remain bounded and must not intentionally become a local denial of service.

### Packaging

Use the generated npm tarball rather than the working source tree to verify:

- package files;
- executable/bin;
- build output;
- runtime imports;
- MCP startup;
- tool discovery.

## 21. Acceptance criteria

BrowserMesh v0.1 is complete only when an external MCP client can:

1. create two or more independently labeled sessions;
2. receive an initial `pageId` directly from session creation;
3. navigate and interact with sessions independently;
4. run operations on different sessions concurrently;
5. observe deterministic ordering inside each individual session;
6. survive a failed operation without poisoning that session queue;
7. observe isolated URLs, storage/auth state, pages, DOM and screenshots;
8. reject cross-session `pageId` misuse;
9. save supported browser state;
10. create a new isolated session from a saved `stateId`;
11. close sessions deterministically;
12. shut down without known browser-resource leaks;
13. discover BrowserMesh through MCP stdio;
14. receive tool descriptions explaining multi-identity session usage;
15. run successfully from the packaged npm artifact.

The project must pass:

- typecheck;
- lint;
- formatting check;
- unit tests;
- integration tests;
- e2e tests;
- concurrency tests;
- isolation tests;
- persistence tests;
- stress tests;
- enforced source coverage thresholds;
- dependency review for pull-request dependency changes;
- build;
- MCP stdio verification;
- package-install verification.

No internal Agent/message/ownership API may be present.

No known blocker, critical, or high-severity defect that is fixable within the defined v0.1 scope may remain at completion.
