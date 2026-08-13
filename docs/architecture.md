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

Raw Playwright stacks are not part of the public MCP contract. A bounded cause summary and safe
operation context are returned for browser and locator failures. Rejected operations leave the MCP
transport, runtime, and unrelated sessions available.

Important lifecycle/concurrency errors include:

- `SESSION_NOT_FOUND`;
- `SESSION_NOT_READY`;
- `SESSION_CLOSING`;
- `SESSION_CLOSED`;
- `PAGE_NOT_FOUND`;
- `OPERATION_TIMEOUT`;
- `LOCATOR_AMBIGUOUS`;
- `STALE_ELEMENT_REFERENCE`;
- `STALE_SNAPSHOT_CURSOR`;
- `BROWSER_ERROR`;
- `BROWSER_DISCONNECTED`;
- `RUNTIME_SHUTTING_DOWN`.

The stdio adapter connects before Chromium is needed. Browser launch is lazy at session creation,
so missing Playwright binaries produce a structured MCP error with the exact installation command.
Accessibility snapshots redact password-input values inside the Playwright adapter before the
result reaches the runtime or MCP boundary.

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
- serializes all state mutations while enforcing count, per-state, and aggregate byte quotas;
- checks an opened state's size and bounds the read before parsing.

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

The runtime owns screenshot budgets. The browser adapter reports CSS-pixel dimensions before capture;
the runtime rejects oversized work, then validates actual PNG dimensions and encoded bytes after
capture. Both checks remain inside the addressed session queue. Visible-text reads use the same queue
and are truncated at safe Unicode/UTF-8 boundaries with explicit result metadata.

## Neutral label boundaries

Session names and metadata are validated in the runtime before IDs or browser resources are allocated.
The bounded immutable copy rejects control characters and dangerous object keys, so direct runtime
callers receive the same protection as MCP callers and session list/get responses remain bounded.

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

## Accepted post-v0.1 evolution

The improvement program extends the modular monolith without changing dependency direction or the
external-client boundary.

```text
MCP stdio adapter / doctor CLI
             │
             ▼
BrowserMeshRuntime ── version/config/runtime-health services
       │       │
       │       ├── bounded per-page observability stores
       │       └── per-session queue and cancellation ownership
       ▼
BrowserEnginePort / StateRepositoryPort
       ▲
       │
Playwright and filesystem adapters
```

Version data is generated at build time into infrastructure and injected toward adapters. Runtime
diagnostics consume safe runtime/config views; they do not inspect process environment, repository
files, adapter-private paths, or Playwright objects. The doctor CLI composes the same application
ports and owns a bounded, disposable smoke lifecycle. MCP discovery and `browser_runtime_info` do
not force browser launch.

Structured MCP mapping is implemented in the adapter. Central object-root output schemas mirror
stable application result models, while compatibility text and screenshot image blocks remain
presentation. Safe application failures carry typed runtime `operationId` correlation into a
bounded JSON-only MCP error mapper; raw causes never cross the adapter. Annotations are centralized,
statically reviewed metadata and never runtime authorization. MCP handlers translate request
cancellation to an engine-independent operation signal and runtime-owned deadline before crossing
inward. The deadline is absolute from acceptance: after a queue wait, the runtime rejects an
expired operation before resolving its page handle or touching the engine. Adapter waits/actions
use only the remaining budget.

Passive waits and atomic action/wait composites are application operations occupying one session
queue slot. Engine ports expose typed conditions/actions and cancellation; they do not expose
Playwright waiters. A composite registers its event waiter before its action and has one deadline
and cleanup owner.

The composite adapter supports navigation, response, popup, and dialog events. Popup handling
transfers the engine's opaque popup handle to the runtime inside the same queued operation. The
runtime attaches observability, generates a new `pageId`, marks it non-default, and returns its
`PageView`; if registration or the per-session page limit fails, it closes the popup before
returning the typed error. No Playwright `Page` crosses the port into a public result.

Dialogs are ephemeral and blocking, so there is no later inspect API. The adapter installs the
dialog listener before the typed click/press, verifies the expected dialog type, accepts or
dismisses it under the shared deadline, and returns only bounded message/default-value metadata.
Unexpected dialogs are dismissed before the operation fails, preventing a blocked page and queue.
A popup produced by a non-popup composite is likewise closed before a typed failure and is never
registered as a managed page. Composite listeners are removed on every outcome.

Observability listeners are implemented in the Playwright adapter, but their safe normalized event
models, bounded stores, cursors, ownership, and lifecycle are controlled by runtime/application
contracts. Each page owns at most one listener set. Teardown removes listeners before handles are
discarded. Ring-buffer overflow is observable through dropped counts. Browser event bodies,
headers, console object graphs, and raw exceptions never enter the normalized event port.

Observability normalizes `console`, `pageerror`, `request`, `response`, and `requestfailed`
subscriptions through the browser-engine port. Runtime page entries own the disposer and one
bounded mixed event store; reads filter by event kind without creating an adapter dependency.
Page-scoped cursor namespaces reject a cursor presented for another page even inside the same
session. The Playwright adapter owns a bounded per-page in-flight request map solely for correlation
and duration; response headers do not end correlation, while `requestfinished` or `requestfailed`
does. Terminal events remove entries and teardown clears the map. Redirect hops remain
separate correlated request pairs. Only page-owned HTTP(S) metadata enters the port, including
EventSource but excluding service-worker traffic, WebSockets, `data:` and `blob:` URLs.

Snapshot bounds, context settings, and new actions are engine-independent value contracts. The
runtime owns snapshot-content character/UTF-8 limits and explicit partial metadata; the adapter
uses only documented engine controls for semantic scope, depth, bounding boxes, timeout, and
cancellation. Truncated ARIA YAML is identified as a fragment rather than a complete document.
The runtime parses documented ARIA YAML with a conforming parser before applying engine-neutral
interactive filtering and per-node child limits. Cursor pages are served from a bounded immutable
per-page serialization (four entries, 30-second TTL, 1,000,000-code-point source cap), so ordinary
DOM mutations cannot reorder later pages. Navigation and all page/session teardown paths clear the
store; opaque cursor ownership is checked only within the addressed page. Every cursor page either
advances by at least one Unicode code point or returns a typed validation error when `maxBytes`
cannot contain that point. Normal navigation and action-and-navigation composites invalidate the
page's retained snapshots.
Session context settings are normalized and validated by the runtime before the Playwright adapter
is invoked. Each session entry retains an immutable effective value and passes it through the
`BrowserEnginePort` context-creation boundary; session views return defensive copies. The MCP
schema duplicates basic bounds for early feedback, while runtime validation remains authoritative
for direct API callers. Saved storage state and context settings are orthogonal: restoring storage
does not persist or override the newly requested context profile.

ADR 0016 adds only an origin-scoped geolocation permission. The domain contract canonicalizes and
validates explicit HTTP(S) origins and rejects every other permission before context creation. The
Playwright adapter removes permission descriptors from context options, creates the isolated
context with its validated geolocation, then grants `geolocation` per origin. A cancellation or
grant failure closes the unregistered context. Context close is the permission revocation and
cleanup boundary; there is no process-global permission registry.

Typed hover, focus, check, uncheck, double-click, and scroll-into-view follow that boundary: MCP
validates a semantic locator, runtime routes through the addressed session queue, and only the
Playwright adapter resolves and acts on the concrete locator. Queued cancellation never reaches the
engine, while an in-flight action retains its queue slot until it settles so later same-session work
cannot overtake it.
Short-lived element references, if introduced, are runtime IDs resolving only inside the adapter;
they are bounded and invalidated with page/document lifecycle. They are conveniences, not durable
identity or exposed locator handles.

ADR 0013 introduces that slice with an engine-independent `ElementTarget` value. The Playwright
adapter alone owns short-lived `ElementHandle` entries; the port returns only opaque strings and
bounded hints. Capture and use remain inside the owning session queue. Main-frame navigation and
all page/context/browser teardown paths clear the page registry; resolution also verifies expiry
and same-document connectivity before an action. Capture replaces prior refs atomically after a
successful, non-cancelled enumeration and releases partial results on failure.

ADR 0014 extends the engine-neutral `Locator` value with an optional main-document or bounded
outer-to-inner iframe selector chain. The Playwright adapter alone converts each selector to a
`FrameLocator`; every step is resolved exactly under the existing operation control, and no frame
object or durable frame ID enters runtime/domain state. All locator consumers inherit the same
scope, including waits, scoped snapshots/ref capture, visible text, element screenshots, and typed
actions. Chains are re-resolved for each queued operation. Descendant navigation or detach makes
old element refs stale without creating a separate frame lifecycle registry.

Filesystem-backed artifacts are not part of this architecture yet. ADR 0012 establishes a design
gate: a capability-specific follow-up ADR must define repository ports, quotas, retention,
redaction, and cleanup before code or public tools are added.

## Architectural evolution

Possible future adapters/features include:

- Streamable HTTP;
- additional browser engines;
- OpenTelemetry;
- remote browser workers;
- generic client/workflow leases.

These are deferred possibilities, not accepted implementation scope. In particular, the current
program adds neither remote HTTP nor internal agents.

They must be added around the existing core rather than by leaking transport/Playwright concepts into the domain.

Architectural decisions are recorded in:

```text
docs/decisions/
```

Significant behavioral or architectural changes require an ADR before or together with implementation.
