# Contributing to BrowserMesh

Thank you for helping improve BrowserMesh. Read the [Code of Conduct](./CODE_OF_CONDUCT.md) and [Security Policy](./SECURITY.md) before participating.

## Quick start

1. Fork the repository and create a branch from `master`.
2. Install the Node.js version in [`.nvmrc`](./.nvmrc).
3. Install dependencies and Chromium.
4. Make the smallest coherent change with tests and documentation.
5. Run the required local checks.
6. Open a pull request targeting `master` and complete the PR template.

For substantial public API or architecture changes, open an issue first.

## Requirements

- Node.js 24 for development; Node.js 22 remains the minimum supported major and is tested in CI.
- npm with the committed `package-lock.json`.
- Playwright Chromium for integration, e2e, and package smoke tests.

```sh
npm ci
npx playwright install chromium
npm run build
```

## Repository layout

| Path                        | Responsibility                                                    |
| --------------------------- | ----------------------------------------------------------------- |
| `src/domain/`               | Engine-independent public concepts and errors                     |
| `src/application/ports/`    | Browser, persistence, and observability contracts                 |
| `src/runtime/`              | Session/page registries, lifecycle, queues, limits, orchestration |
| `src/adapters/playwright/`  | The only layer that resolves Playwright objects                   |
| `src/adapters/mcp/`         | MCP validation and result/error mapping                           |
| `src/adapters/persistence/` | Controlled filesystem storage-state persistence                   |
| `tests/unit/`               | Deterministic tests using ports/fakes                             |
| `tests/integration/`        | Real Chromium and MCP stdio integration                           |
| `tests/e2e/`                | External MCP-client multi-session workflows                       |
| `tests/stress/`             | Bounded concurrency and cleanup checks                            |
| `docs/`                     | Specification, architecture, development rules, and ADRs          |

## Architecture rules

- Every browser operation explicitly addresses a `sessionId`; page operations also address a `pageId`.
- There is no global current session/page.
- Each session owns an isolated `BrowserContext` and independent serial queue.
- Different sessions may execute concurrently.
- Domain and runtime code do not import Playwright or MCP implementations.
- MCP handlers do not manipulate Playwright objects directly.
- Browser contexts/pages and disconnect listeners must be released deterministically.
- Saved state uses logical `stateId` values, never caller-controlled paths.
- Logs and public errors must not expose secrets or raw browser state.
- BrowserMesh does not contain internal AI agents, registries, ownership, mailboxes, messaging, or LLM orchestration.

Read [docs/SPEC.md](./docs/SPEC.md), [docs/architecture.md](./docs/architecture.md), and [docs/development.md](./docs/development.md) before changing runtime behavior.

## Development workflow

Use focused branches:

- `feat/...` — new capability;
- `fix/...` — bug fix;
- `docs/...` — documentation;
- `test/...` — test coverage;
- `refactor/...` — behavior-preserving refactor;
- `chore/...` or `ci/...` — maintenance and automation.

Do not commit directly to `master`. Open a pull request and wait for required checks and review.

## Checks before opening a PR

Minimum for every change:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

For browser/runtime/MCP changes:

```sh
npm run test:integration
npm run test:e2e
npm run test:stress
npm run test:coverage
npm run verify:package
```

The complete local gate is:

```sh
npm run verify
npm run verify:package
```

If dependencies change, commit the updated `package-lock.json`. CI runs `npm ci` and rejects lockfile drift.

## What runs on pull requests

Every PR to `master` runs:

| Check                | Coverage                                                        |
| -------------------- | --------------------------------------------------------------- |
| `static-checks`      | Typecheck, ESLint, Prettier                                     |
| `unit-and-build`     | Unit tests/build on Node.js 22 and 24                           |
| `browser-tests`      | Real Chromium integration/e2e on Node.js 22 and 24              |
| `stress`             | Deterministic 50-session plus bounded real-Chromium stress      |
| `coverage`           | Complete suite with enforced V8 coverage thresholds             |
| `dependency-review`  | Reject newly introduced vulnerable dependencies                 |
| `package-smoke`      | Linux/Windows tarball install and packaged MCP browser workflow |
| `CodeQL`             | Extended JavaScript/TypeScript and Actions security analysis    |
| `conventional-title` | Conventional Commit PR-title contract                           |
| `all-checks-passed`  | Stable aggregate branch-protection gate                         |

Tests in the standard directories are discovered automatically; ordinary test additions do not require workflow edits.

## Pull request expectations

- Keep one coherent concern per PR.
- Add regression tests for bug fixes and behavioral tests for features.
- Update public documentation and ADRs when contracts or architecture change.
- Explain isolation, ordering, shutdown, disconnect, persistence, and resource-lifecycle effects.
- Never include secrets, auth state, browser profiles, screenshots with private data, or machine-specific paths.
- Use a Conventional Commit PR title because release-please derives versioning and changelog entries from merged PR titles.

Examples:

- `feat: add a semantic locator strategy` → minor release;
- `fix: drain accepted work before session close` → patch release;
- `feat!: change the session creation result` → major release;
- `docs: clarify MCP client configuration` → patch release under the current pre-1.0 policy.

## Release flow

Contributors do not publish packages or create release tags.

1. Normal PRs merge into `master` after review and green checks.
2. release-please maintains a Release PR containing the version and changelog.
3. A maintainer reviews and merges the Release PR when ready.
4. release-please creates the `vX.Y.Z` tag and GitHub Release.
5. The tag triggers a separate workflow that reruns all gates and publishes to npm through Trusted Publishing (OIDC).

See [docs/releasing.md](./docs/releasing.md) for one-time maintainer setup and recovery procedures.
