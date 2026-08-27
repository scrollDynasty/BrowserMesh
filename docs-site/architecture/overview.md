# Architecture

BrowserMesh is a modular monolith with dependency direction toward engine-neutral domain and application contracts.

```text
external MCP client
        │ stdio / MCP
        ▼
MCP adapter ──────── validation, descriptions, structured results
        │
        ▼
runtime/application ─ sessions, pages, queues, deadlines, lifecycle
        │                │
        │                └── persistence port → filesystem adapter
        ▼
browser-engine port → Playwright adapter → Chromium
```

## Layers

### Domain

Engine-neutral models, context settings, snapshots, observability, resource limits, and stable errors. The domain does not import MCP, Playwright, concrete adapters, or filesystem APIs.

### Application ports

Contracts for browser engines, state storage, events, data-directory probing, and operation control.

### Runtime

`BrowserMeshRuntime` owns registries, explicit ownership validation, independent serial queues, deadlines, lifecycle transitions, bounded terminal records, persistence ordering, and disconnect handling.

### Adapters

The Playwright adapter exclusively owns `Browser`, `BrowserContext`, `Page`, locator, frame, and element-handle objects. The MCP adapter never manipulates those objects; it calls the runtime. The persistence adapter exposes only logical state IDs.

## Lifecycle

Chromium starts lazily. Each ready session receives a new non-persistent context and initial page. Closing a session drains/rejects work according to its state and releases pages, event listeners, refs, snapshot cursors, and context. Shutdown closes all sessions and the browser. Unexpected disconnect fails live sessions without reconstruction.

## Security boundaries

There is no arbitrary JavaScript evaluation, shell, caller-controlled file read/write, or caller-chosen screenshot path. Artifacts such as HAR, trace, video, uploads, and downloads are intentionally deferred until a controlled artifact contract exists.

For design rationale, see the repository's [architecture and accepted ADRs](https://github.com/scrollDynasty/BrowserMesh/tree/master/docs).
