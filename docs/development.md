# BrowserMesh Development

## Baseline

BrowserMesh v0.1 is a local TypeScript/Node.js modular monolith.

The project targets:

- Node.js 24 as the recommended major runtime;
- Node.js 22 as the minimum supported major runtime;
- the TypeScript/tooling versions pinned by `package.json` and the lockfile;
- the MCP SDK version pinned by the repository;
- the Playwright version pinned by the repository;
- Chromium as the v0.1 browser engine.

Do not automatically migrate major dependency versions during unrelated implementation work.

A major tooling/runtime migration should be handled as an explicit compatibility task with full verification.

### Generated server version

`src/infrastructure/generated/version.ts` is generated from `package.json`; production code must
not locate or read package metadata at runtime. Run `npm run generate:version` after intentionally
changing the package version. `npm run check:version` fails when the committed generated value is
stale, and it runs automatically before typechecking. Build and pack lifecycles regenerate the
module so clean source builds and installed artifacts contain the same immutable version.

Release Please updates the generated module together with `package.json` and both version fields in
`server.json`. Contract tests verify that chain and MCP handshake tests assert the exact
`serverInfo.version` in source, stdio, and installed-tarball execution.

MCP contract changes must update the centralized output schema and title/annotation matrix together
with the handler. Integration tests invoke every public tool successfully, validate its
`structuredContent`, and compare exact discovery metadata. Package verification also requires every
installed tool to retain an object-root output schema and title.

Playwright creates one non-persistent Chromium `BrowserContext` per BrowserMesh session.

MCP v0.1 uses local stdio transport.

## Responsibility boundary

Development must preserve:

```text
User
  ↓
external AI client
  ↓ MCP
BrowserMesh
  ↓
isolated browser sessions
```

BrowserMesh does not contain internal AI Agents, LLM orchestration, mailboxes, or messaging.

Buyer/seller/admin concepts in tests are session labels and external workflow roles only.

## Setup

From the repository root:

```sh
npm install
npx playwright install chromium
npm run verify
```

Browser mode is explicit in automation. Use `BROWSERMESH_HEADLESS=true` when no display is
available. Use `BROWSERMESH_HEADLESS=false` under Xvfb when verifying the default headed product
behavior. The default is `false`, and only the exact strings `true` and `false` are valid. Browser
startup remains lazy until the first session is created.

Use the repository lockfile.

Do not delete/regenerate it casually as part of unrelated work.

## Verification

The project should expose commands for:

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

`npm run verify` is the canonical local full-project verification entry point. It runs the complete
suite with V8 coverage and enforces the repository's statement, branch, function, and line
thresholds.

It should run all required non-destructive checks needed for v0.1 release confidence, including:

- typecheck;
- lint;
- formatting validation;
- unit tests;
- integration tests;
- e2e tests;
- stress tests;
- production build.

Packaging verification may be a dedicated command if running it on every normal verify would be unnecessarily expensive.

If separate, document and run it before release readiness.

## Deterministic browser tests

Browser tests must not depend on public websites.

Tests start a deterministic ephemeral loopback HTTP server.

The local test application should support scenarios for:

- cookies;
- browser storage/auth state;
- forms;
- buttons;
- navigation;
- multiple logical roles;
- deterministic server-side state changes.

Do not use Google, GitHub, or another public site as an acceptance dependency.

## Source layout

Expected conceptual layout:

```text
src/
├── domain/
├── application/
│   └── ports/
├── runtime/
├── adapters/
│   ├── playwright/
│   ├── mcp/
│   └── persistence/
└── infrastructure/

tests/
├── unit/
├── integration/
├── e2e/
└── stress/

docs/
├── SPEC.md
├── architecture.md
├── development.md
├── IMPLEMENTATION_STATUS.md
└── decisions/
```

Exact subdirectory naming may evolve through ADRs, but dependency direction must remain consistent.

### `src/domain`

Contains:

- engine-independent public models;
- locators;
- typed errors;
- stable value types.

No Playwright/MCP adapters.

### `src/application/ports`

Contains interfaces for:

- browser engine;
- persistence;
- event/observability sink;
- other engine-independent contracts where justified.

### `src/runtime`

Contains:

- session/page lifecycle;
- registries;
- explicit routing;
- synchronization;
- limits;
- operation IDs;
- persistence orchestration;
- shutdown.

### `src/adapters/playwright`

This is the only area allowed to resolve BrowserMesh engine handles into concrete Playwright:

- `Browser`;
- `BrowserContext`;
- `Page`;
- locators.

### `src/adapters/mcp`

Contains:

- MCP schemas;
- tool registration;
- tool descriptions;
- MCP result/error mapping;
- stdio bootstrap.

It calls runtime/application services.

It does not call Playwright directly.

### `src/adapters/persistence`

Contains safe local state storage.

External callers provide logical state IDs rather than filesystem paths.

### `src/infrastructure`

Contains:

- configuration;
- ID generation;
- structured logs;
- shared technical helpers.

## Adding a browser operation

When adding a browser capability:

1. define the engine-independent input/result contract;
2. extend `BrowserEnginePort` only if engine capability is required;
3. implement the concrete behavior inside the Playwright adapter;
4. route the operation through `BrowserMeshRuntime`;
5. ensure it targets an explicit `sessionId`;
6. ensure page operations target explicit `pageId`;
7. ensure live session/browser access passes through the session queue;
8. allocate/correlate an `operationId`;
9. map concrete errors into stable BrowserMesh errors;
10. expose the behavior through validated MCP input;
11. write a useful AI-facing MCP tool description;
12. add positive and negative tests;
13. add isolation/concurrency/cleanup coverage where applicable;
14. run affected suites and then broader verification.

Do not introduce current-page state.

Do not return Playwright objects.

Do not bypass runtime services from MCP.

## Session queue rules

Every live session has one serial browser-operation queue.

Browser-backed operations within one session execute in accepted order.

This includes read-style operations.

For example:

```text
navigate
  ↓
snapshot
  ↓
click
  ↓
get_url
```

is deterministic.

Different sessions use independent queues and may execute concurrently.

A queue implementation must recover after an operation rejects or times out.

The following sequence must be possible:

```text
operation A → success
operation B → failure
operation C → success
```

A failure in B must not leave C permanently blocked.

## Session creation

Session creation creates:

1. a session identity;
2. a dedicated BrowserContext;
3. one deterministic initial page;
4. a page identity.

The public creation result returns the initial `pageId`.

Do not require the MCP caller to invoke `browser_page_list` before its first navigation.

## Session close

Closing follows:

```text
ready
  ↓
closing
  ↓
stop accepting new session browser work
  ↓
drain accepted work
  ↓
close pages/context
  ↓
remove live handles
  ↓
closed
```

Repeated close of a known closing/closed session is safe.

Unknown random IDs still return `SESSION_NOT_FOUND`.

Close/shutdown must be tested against concurrent session initialization.

## Chromium disconnect

Unexpected browser disconnect is not equivalent to graceful shutdown.

When Chromium unexpectedly disconnects:

- affected sessions become failed;
- live handles are invalidated;
- existing sessions are not silently reconstructed.

Future newly created sessions may use a restarted Chromium process if runtime recovery is safe.

## Persistence

Saved browser state is sensitive.

Default private data is stored beneath:

```text
.browsermesh/
```

Persistence rules:

- external callers provide logical `stateId` values;
- caller-controlled paths are rejected;
- traversal is rejected;
- writes use safe temporary-file/atomic-replacement semantics where supported;
- storage contents are not logged;
- `.browsermesh/` remains Git-ignored.

`browser_state_save` against a live session passes through that session queue.

`browser_session_create` may optionally receive `stateId` to initialize a new isolated context from saved state.

There is no separate `browser_session_create.fromState` MCP tool.

## MCP development

MCP is designed for model-driven tool use.

A tool description must answer:

- what does this tool do?
- when should the AI use it?
- what isolation/addressing rule matters?

For `browser_session_create`, descriptions must explain that separate sessions are appropriate for:

- different users;
- different accounts;
- different roles;
- different authentication states;
- independent parallel browser workflows.

Avoid vague descriptions such as:

> Creates a session.

Prefer descriptions that expose the decision boundary to the external model.

## MCP stdio logging

stdout is reserved for MCP protocol traffic.

Do not write human/debug logs to stdout.

Structured logs go to stderr.

Never log:

- cookies;
- tokens;
- storage state;
- passwords;
- form values;
- page contents;
- screenshots.

## Testing groups

### Unit

Use fakes/ports when Chromium is unnecessary.

Cover:

- lifecycle;
- registry behavior;
- queue ordering;
- failed-operation queue recovery;
- limits;
- validation;
- error mapping;
- state naming;
- configuration.

### Integration

Use real Chromium.

Cover:

- BrowserContext isolation;
- page isolation;
- storage isolation;
- concurrency;
- actions;
- screenshots;
- persistence;
- lifecycle races;
- cleanup.

### MCP integration

Use an actual MCP client/server test path where possible.

Cover:

- stdio startup;
- tool discovery;
- schemas;
- descriptions;
- successful calls;
- invalid calls;
- structured errors;
- clean exit.

An in-memory transport may supplement stdio tests but must not replace real stdio-process verification.

### E2E

Use the deterministic local test application.

A representative workflow may use:

```text
buyer session
seller session
admin session
```

These are labels only.

There is no internal Agent model.

### Stress

Stress tests are bounded.

Scale session counts progressively when appropriate:

```text
1
2
5
10
25
50
```

Do not blindly allocate beyond local/CI resource safety.

Stress tests focus on:

- routing correctness;
- isolation;
- queue independence;
- cleanup;
- obvious handle/listener leaks.

## Required lifecycle regressions

Keep regression coverage for:

- cross-session page ID misuse;
- failed operation followed by successful operation;
- timed-out operation followed by successful operation;
- close while operations are queued;
- operation after close begins;
- repeated close;
- shutdown during initialization;
- shutdown with queued operations;
- persistence capture during surrounding browser actions;
- unexpected Chromium disconnect where practical.

## Package verification

Source-tree execution is insufficient for release readiness.

Before calling v0.1 complete:

```sh
npm run build
npm run verify:package
```

The package verifier creates an npm tarball and installs it in a clean temporary environment.

Verify:

- package contains required build output;
- package does not depend on missing source-only files;
- runtime dependencies are declared;
- CLI/bin is executable/usable;
- MCP server starts from packaged output;
- MCP tool discovery works;
- a small browser/session smoke flow works where practical.

Do not publish the package as part of verification.

## CI

Continuous integration should run on relevant pushes and pull requests.

CI should verify the same core guarantees as local development and should not depend on external websites.

At minimum CI should cover:

- dependency install;
- Chromium installation/setup as required;
- typecheck;
- lint;
- formatting;
- unit tests;
- integration tests;
- e2e tests;
- build.

Stress/package verification may use separate jobs if runtime cost requires it.

CI must not automatically deploy BrowserMesh to a server.

The local open-source product runs on the user's machine.

## Release boundary

Preparing release automation is allowed.

Actually performing external release actions requires explicit authorization.

Normal CI and ordinary feature PRs must not:

- `npm publish`;
- create GitHub Releases;
- push tags;
- publish Docker images;
- deploy servers.

The configured release automation is gated by an explicit maintainer action: merging the
Release Please PR. That merge may create the version tag and GitHub Release, and the protected
tag then triggers npm publication through Trusted Publishing. See
[`docs/releasing.md`](releasing.md) for setup and recovery procedures.

The expected future distribution model is:

```text
GitHub repository
        ↓
CI
        ↓
npm package
        ↓
user launches locally
        ↓
BrowserMesh
        ↓
local Chromium
```

## Implementation status

`docs/IMPLEMENTATION_STATUS.md` is the persistent checkpoint used by autonomous coding sessions.

Update it after meaningful progress.

It should contain:

- completed phases;
- incomplete phases;
- known defects;
- latest verification state;
- blockers;
- next required work.

It must never override `docs/SPEC.md`.

## Full local verification before completion

Before claiming BrowserMesh v0.1 is complete:

1. perform a clean dependency install where practical;
2. install required Chromium;
3. build;
4. typecheck;
5. lint;
6. verify formatting;
7. run unit tests;
8. run integration tests;
9. run e2e tests;
10. run bounded stress tests;
11. verify stdio MCP process behavior;
12. verify isolation/concurrency regressions;
13. verify persistence;
14. verify graceful shutdown;
15. verify unexpected browser-disconnect handling where practical;
16. run package tarball installation smoke test;
17. verify README commands;
18. perform an adversarial repository review;
19. fix discovered blocker/critical/high defects;
20. rerun the complete affected verification suite.

Do not call the project complete merely because `npm run build` succeeds.

`npm run verify:package` selects headless mode by default for a portable local smoke test. Set
`BROWSERMESH_HEADLESS=false` and run it under Xvfb to exercise the headed package path explicitly.
