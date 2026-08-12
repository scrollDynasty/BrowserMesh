# Development

## Baseline

Node.js 24 LTS is the recommended runtime and Node.js 22 is the supported minimum. The project uses TypeScript 6 strict mode because the current `typescript-eslint` peer range does not yet support TypeScript 7. MCP uses `@modelcontextprotocol/sdk` v1 and local `StdioServerTransport`. Playwright controls Chromium and creates one non-persistent context per session.

## Setup and verification

```sh
npm install
npx playwright install chromium
npm run verify
```

`verify` runs typecheck, lint, formatting validation, the complete unit/integration/e2e/stress suite, and the production build. Tests never depend on public websites. Browser tests start an ephemeral loopback HTTP server.

Test groups can be run separately with `npm test`, `npm run test:integration`, `npm run test:e2e`, and `npm run test:stress`.

## Source layout

- `src/domain`: public models and typed errors; no adapters.
- `src/application/ports`: browser, persistence, and event interfaces.
- `src/runtime`: session/page lifecycle, routing, synchronization, limits, persistence orchestration, and shutdown.
- `src/adapters/playwright`: the only layer that imports Playwright.
- `src/adapters/mcp`: schemas and transport-independent MCP server registration.
- `src/adapters/persistence`: safe local state storage.
- `src/infrastructure`: configuration, IDs, and structured logs.
- `tests/unit`: deterministic tests with ports replaced by fakes.
- `tests/integration`: real Chromium and in-memory MCP client/server transport.
- `tests/e2e`: an external-client multi-role scenario using two isolated sessions, with no internal Agent model.
- `tests/stress`: bounded 50-session routing/cleanup test.

## Adding a browser operation

Add the engine-independent locator/result contract first, extend `BrowserEnginePort`, implement it only in the Playwright adapter, route it through `BrowserMeshRuntime` so it receives the session queue and operation ID, then expose it through a validated MCP tool. Include negative, isolation, and cleanup coverage as applicable.

Do not introduce current-page state, return Playwright objects, log values that may contain secrets, or bypass runtime services from MCP.
