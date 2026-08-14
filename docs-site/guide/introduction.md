# Introduction

BrowserMesh is a local browser runtime exposed over the Model Context Protocol (MCP). An external AI client decides which actions to take. BrowserMesh executes those actions in explicitly addressed, isolated Chromium sessions.

```text
User → external MCP client → BrowserMesh → Playwright → Chromium
```

BrowserMesh is useful when one workflow needs several independent browser identities—for example a buyer, seller, and administrator—or when concurrent work must not share an implicit “current page.”

## What BrowserMesh owns

- one local Node.js server process and a lazily started Chromium process;
- a separate non-persistent `BrowserContext` for each ready session;
- explicit session and page lifecycle;
- per-session operation ordering and cross-session parallelism;
- bounded snapshots, text, screenshots, and browser observations;
- optional storage-state persistence through logical state IDs;
- structured MCP results and stable public error codes.

## What it does not own

BrowserMesh contains no LLM, prompt planner, agent registry, mailbox, message bus, or autonomous reasoning loop. It is not a wrapper around Playwright MCP. MCP and Playwright are replaceable adapters around BrowserMesh's application/runtime boundary.

Continue with [Why BrowserMesh](./why-browsermesh) or go directly to [Getting started](./getting-started).
