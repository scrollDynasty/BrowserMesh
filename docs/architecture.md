# Architecture

BrowserMesh is a modular monolith with inward-facing contracts.

```text
MCP stdio adapter ──> BrowserMeshRuntime ──> domain contracts
                           │
                           ├──> BrowserEnginePort <── Playwright adapter
                           ├──> StateRepositoryPort <── filesystem adapter
                           └──> EventSinkPort <── structured stderr logger
```

The domain and application ports do not import Playwright or MCP. The MCP adapter validates and maps calls but never sees `Browser`, `BrowserContext`, or `Page`. Playwright objects remain inside its adapter and are represented elsewhere by opaque handles.

## Runtime invariants

- One session owns exactly one non-persistent Chromium `BrowserContext` while ready.
- Every page has a runtime-generated ID scoped and looked up through its session. A page ID from another session returns `PAGE_NOT_FOUND`.
- Browser operations require `sessionId` and `pageId`; no mutable singleton stores a current target.
- Every session has its own promise-based serial queue. Different queues run concurrently; a single global mutex does not exist.
- A close marks the session as no longer accepting work, waits for already queued work, closes its context, and removes page handles. Repeated close is idempotent.
- Session initialization is itself queued. Shutdown queues close behind initialization, preventing a context from appearing after shutdown cleanup.
- Shutdown rejects new operations, drains/closes sessions in parallel, stops Chromium, and reports aggregated cleanup failures.
- Public session/page views are copies and do not expose internal maps or Playwright handles.

## Error contract

`BrowserMeshError` carries a stable code and safe message. Playwright causes remain internal. MCP returns structured error content and `isError: true`. Timeouts are bounded by configuration or per-operation overrides; navigation and locator failures are mapped rather than exposing raw Playwright stacks.

## Persistence and security

The filesystem adapter validates state names against a conservative filename pattern, writes through a temporary file, and atomically renames it. It does not accept caller-controlled paths. Saved state contains credentials and uses private directory/file modes where supported; `.browsermesh/` is Git-ignored. Screenshots are returned in memory as MCP image data, so no arbitrary overwrite path exists.

## External-client boundary

The MCP client is the reasoning and orchestration agent. BrowserMesh has no Agent entity, registry, ownership model, mailbox, message bus, or handoff protocol. It only manages explicitly addressed browser sessions. Optional session names and string metadata let an external client label roles or accounts without turning those labels into runtime principals.

If concurrent independent MCP clients later require access protection, a generic client/workflow lease can be added around session access. It must not depend on an internal LLM Agent abstraction.

Architectural decisions are recorded in [docs/decisions](decisions/).
