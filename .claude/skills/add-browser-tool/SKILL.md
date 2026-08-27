---
name: add-browser-tool
description: Add a new browser capability to BrowserMesh end to end - engine port, Playwright adapter, runtime routing, MCP contract, tool profile, and tests. Use when adding, extending, or renaming a browser_* MCP tool, adding a method to BrowserEnginePort, or exposing a new Playwright capability through BrowserMesh.
---

# Adding a browser operation

Dependency direction is the whole point: define the contract first, implement it at the edge last.
A capability that shows up in the MCP adapter before it exists in the port has already broken the
architecture test.

## Order of work

1. **Define the engine-independent contract.** Input and result types in `src/domain/`. No
   Playwright types, no MCP types.
2. **Extend `BrowserEnginePort`** (`src/application/ports/browser-engine.ts`) only if genuinely new
   engine capability is required. Reuse an existing method where the difference is routing.
3. **Implement the concrete behaviour** in `src/adapters/playwright/playwright-browser-engine.ts`.
   This is the only place that resolves handles into real `Browser`, `BrowserContext`, `Page`, or
   locators.
4. **Route through `BrowserMeshRuntime`** (`src/runtime/browsermesh-runtime.ts`).
5. **Target an explicit `sessionId`.** No implicit current session.
6. **Target an explicit `pageId`** for page-scoped operations. Reject a `pageId` owned by another
   session.
7. **Pass live browser access through the session queue** (`src/runtime/serial-queue.ts`) — read
   operations included.
8. **Allocate and correlate an `operationId`.**
9. **Map concrete failures into stable `BrowserMeshError` codes** (`src/domain/errors.ts`). Raw
   Playwright errors must never reach a client.
10. **Expose it through validated MCP input** in `src/adapters/mcp/contracts.ts` and register it in
    `src/adapters/mcp/server.ts`.
11. **Write an AI-facing description** — see the rules in `CLAUDE.md`; a description is chosen by a
    model, not read by a human.
12. **Add positive and negative tests.**
13. **Add isolation, concurrency, and cleanup coverage** where the operation touches live state.
14. **Run the affected suites, then `npm run verify`.**

## What the compiler and tests will force

These are not optional; skipping one turns into a red suite rather than a silent omission.

- `ToolName` is `keyof typeof outputSchemas` (`contracts.ts:365`). Adding an output schema creates
  the name.
- `toolPresentation` is `Record<ToolName, ToolPresentation>` (`contracts.ts:388`), so TypeScript
  requires a title and annotations for the new tool.
- `tests/unit/tool-profiles.test.ts` asserts every `ToolName` belongs to exactly one profile in
  `src/adapters/mcp/tool-profiles.ts` (`core`, `observability`, or `persistence`). A new tool that
  is in no profile fails here.
- `tests/integration/mcp.test.ts` asserts discovered tool names equal `Object.keys(outputSchemas)`
  exactly, invokes every public tool, and validates its `structuredContent`.
- `tests/unit/architecture.test.ts` rejects Playwright or MCP imports reaching domain, application,
  or runtime.

## Discovery cost

Every published contract is paid for in context by every client, once per session. ADR 0019 shares
repeated subschemas through `$defs`/`$ref`; ADR 0020 rejects publishing four near-identical
contracts where one parameterised tool does the job, and rejects results that restate their own
arguments.

Before adding a tool, check whether an existing one takes another value of an existing parameter.
`browser_observe` is the worked example: one contract with a `source` discriminator replaced four
byte-identical result schemas.

## Do not

- Introduce current-page or current-session state.
- Return Playwright objects from anything above the adapter.
- Call Playwright from `src/adapters/mcp/`.
- Bypass runtime services from the MCP adapter.
- Read `process.env` outside `src/infrastructure/config.ts`.

## Reference

`docs/development.md` — "Adding a browser operation", "Session queue rules", "MCP development".
