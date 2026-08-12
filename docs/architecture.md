# BrowserMesh Architecture

BrowserMesh v0.1 is a local modular monolith with inward-facing contracts.

Its responsibility boundary is:

```text
User
  ↓
external AI client
  ↓ MCP stdio
BrowserMesh
  ↓
isolated browser sessions
```

The external MCP client performs reasoning and workflow orchestration.

BrowserMesh performs browser execution only.

## High-level architecture

```text
MCP stdio adapter
        │
        ▼
BrowserMeshRuntime
        │
        ├── BrowserEnginePort
        │        ▲
        │        │
        │   Playwright adapter
        │
        ├── StateRepositoryPort
        │        ▲
        │        │
        │   filesystem adapter
        │
        └── EventSinkPort
                 ▲
                 │
        structured stderr logger
```

The domain and application-facing ports do not import Playwright or MCP.

The MCP adapter validates and maps calls but never manipulates:

- `Browser`;
- `BrowserContext`;
- `Page`;
- Playwright locator objects.

Concrete Playwright objects remain inside the Playwright adapter.

## Layer responsibilities

### Domain

Contains engine-independent public concepts:

- session/page views;
- locator contracts;
- result models;
- stable error codes;
- value types.

Domain imports no:

- Playwright;
- MCP;
- filesystem adapter;
- transport implementation.

### Application/runtime

Owns:

- session registry;
- page registry;
- session/page lifecycle;
- explicit routing;
- per-session synchronization;
- limits;
- persistence orchestration;
- operation IDs;
- shutdown.

### Ports

Declare engine-independent contracts for:

- browser engine;
- state persistence;
- event/observability output.

### Adapters

Provide concrete integrations:

- Playwright;
- MCP;
- filesystem persistence.

### Infrastructure

Provides:

- centralized configuration;
- ID generation;
- structured logging;
- shared deterministic helpers.

## Dependency direction

Conceptually:

```text
adapters
   ↓
runtime/application
   ↓
domain
```

Runtime/application depends on abstractions, not concrete Playwright implementations.

The MCP adapter calls BrowserMesh runtime/application services.

It does not bypass them.

## Public IDs vs engine handles

External callers use:

```text
sessionId
pageId
```

Runtime may associate them with opaque engine handle values declared by `BrowserEnginePort`.

Conceptually:

```text
sessionId
   ↓
opaque ContextHandle
   ↓
Playwright adapter
   ↓
BrowserContext
```

and:

```text
pageId
   ↓
opaque PageHandle
   ↓
Playwright adapter
   ↓
Page
```

MCP and domain code never receive engine handles or Playwright objects.

Only the Playwright adapter can resolve opaque handles to concrete Playwright instances.

## Runtime invariants

### Session isolation

One ready session owns exactly one non-persistent Chromium `BrowserContext`.

Two independent sessions do not share one context.

### Explicit addressing

Every session-targeted browser operation requires `sessionId`.

Every page-targeted operation requires `pageId`.

No mutable singleton stores:

- current session;
- active session;
- current page;
- active page;
- current tab.

### Page ownership

Each page ID belongs to exactly one session.

A page ID used through another session returns `PAGE_NOT_FOUND`.

### Public views

Session/page views returned outside the runtime are copies/value objects.

They do not expose:

- internal maps;
- queues;
- mutable registries;
- browser engine handles;
- Playwright objects.

## Session operation queue

Every live session has one independent serial browser-operation queue.

All operations that target its live browser state pass through that queue.

Examples include:

- navigate;
- back;
- forward;
- reload;
- click;
- fill;
- press;
- select option;
- get URL;
- get title;
- snapshot;
- visible text;
- screenshot;
- page creation;
- page closing;
- persistence capture/state save;
- browser-backed close/lifecycle work where applicable.

This deliberately favors deterministic v0.1 behavior over intra-session read parallelism.

Registry-only immutable list/get operations may return safe snapshots outside the browser queue when they do not touch live engine state.

## Cross-session parallelism

Each session has its own queue.

There is no global browser-operation mutex.

Therefore:

```text
Session A queue ═══════════════════►

Session B queue ═══════════════════►

Session C queue ═══════════════════►
```

may progress concurrently.

A slow session must not unnecessarily serialize unrelated sessions.

## Queue failure semantics

A rejected, failed, or timed-out operation must not poison the queue.

Conceptually:

```text
operation A → success
operation B → failure
operation C → still executes
operation D → still executes
```

Queue chaining must recover after a settled failure.

Tests must explicitly verify this invariant.

## Session creation

Session initialization participates in lifecycle synchronization.

Conceptually:

```text
create requested
    ↓
creating
    ↓
BrowserContext created
    ↓
initial Page created
    ↓
opaque handles registered
    ↓
ready
```

`browser_session_create` returns both:

- the session identity;
- the initial page identity.

This avoids a required follow-up `browser_page_list` before first navigation.

## Close semantics

Closing a session follows:

```text
ready
  ↓
closing
  ↓
reject new work
  ↓
drain accepted queued work
  ↓
close pages/context
  ↓
remove live handles
  ↓
closed
```

Close is idempotent for a known session that is already closing/closed.

A completely unknown session ID remains `SESSION_NOT_FOUND`.

Implementation may use a bounded lightweight closed-session tombstone/view to preserve deterministic close semantics without retaining browser resources indefinitely.

Session initialization is synchronized with close/shutdown so a context cannot appear after cleanup has already passed.

## Shutdown semantics

Runtime shutdown performs:

1. reject new external operations;
2. mark runtime as shutting down;
3. allow accepted work to settle according to lifecycle rules;
4. close active sessions;
5. remove page/context handles;
6. stop Chromium;
7. close transport/process resources;
8. report aggregated cleanup failures.

Independent sessions may drain/close concurrently when safe.

Cleanup failures are not silently swallowed.

## Unexpected Chromium disconnect

BrowserMesh observes unexpected browser disconnect.

When Chromium disconnects unexpectedly:

1. affected ready/creating sessions transition to `failed`;
2. live page/context handles become invalid;
3. runtime removes invalid handles;
4. future operations against those sessions fail with a safe browser/session error;
5. existing sessions are not silently reconstructed.

The runtime may later launch a new Chromium process for newly created sessions if a clean restart is possible.

This is not live-session recovery.

Live-session crash recovery is outside v0.1 scope.

## Operation IDs

Every externally initiated BrowserMesh runtime operation receives a unique `operationId`.

Structured events/logs may correlate:

- `operationId`;
- `sessionId`;
- `pageId`;
- operation/tool name;
- safe status;
- duration;
- safe error code.

Operation IDs do not grant permissions and are not secrets.

## Error contract

`BrowserMeshError` carries:

- stable safe code;
- safe message;
- optional safe details.

Raw Playwright stacks are not part of the public MCP contract.

Underlying exceptions may be retained internally for debugging as long as secrets are not logged.

Important lifecycle/concurrency errors include:

- `SESSION_NOT_FOUND`;
- `SESSION_NOT_READY`;
- `SESSION_CLOSING`;
- `SESSION_CLOSED`;
- `PAGE_NOT_FOUND`;
- `OPERATION_TIMEOUT`;
- `BROWSER_ERROR`;
- `BROWSER_DISCONNECTED`;
- `RUNTIME_SHUTTING_DOWN`.

## Persistence

BrowserMesh persistence uses logical state IDs.

The external caller never supplies arbitrary filesystem paths.

The filesystem adapter:

- validates state IDs;
- resolves them beneath the configured BrowserMesh data directory;
- rejects traversal;
- writes through a temporary file;
- atomically replaces the destination where supported;
- uses private directory/file permissions where supported.

Saved browser state may contain credentials.

`.browsermesh/` is Git-ignored.

Persistence content must never be emitted through structured logs.

## Persistence synchronization

Capturing state from a live session is a browser operation.

Therefore:

```text
navigate
   ↓
fill
   ↓
state_save
   ↓
click
```

has deterministic ordering inside the session queue.

`state_save` must not race independently with navigation/interactions in the same session.

## Screenshots

Screenshots are returned as MCP image content.

BrowserMesh does not allow the caller to specify an arbitrary local output path.

This avoids arbitrary filesystem overwrite behavior in v0.1.

## Logging and stdio

MCP stdio protocol traffic uses stdout.

BrowserMesh logs use stderr.

Logs may contain correlation/resource identifiers but must not include:

- cookies;
- tokens;
- persisted browser state;
- page text/content;
- screenshots;
- passwords;
- form values.

## External-client boundary

The MCP client is the reasoning and orchestration agent.

BrowserMesh has no:

- internal Agent entity;
- Agent registry;
- LLM ownership model;
- mailbox;
- message bus;
- handoff protocol;
- prompt orchestration;
- internal LLM calls.

BrowserMesh only manages explicitly addressed browser sessions.

Optional session names and string metadata allow an external client to label roles/accounts without turning labels into runtime principals.

If concurrent independent MCP clients later require access protection, a generic client/workflow lease may be added around session access.

Such a lease must not depend on an internal LLM Agent abstraction.

## Architectural evolution

Possible future adapters/features include:

- Streamable HTTP;
- additional browser engines;
- OpenTelemetry;
- remote browser workers;
- generic client/workflow leases.

They must be added around the existing core rather than by leaking transport/Playwright concepts into the domain.

Architectural decisions are recorded in:

```text
docs/decisions/
```

Significant behavioral or architectural changes require an ADR before or together with implementation.