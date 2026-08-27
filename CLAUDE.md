# BrowserMesh

Local isolated multi-session browser runtime, driven by external MCP clients.

`AGENTS.md` is the full charter. This file is the working subset; when the two disagree, `AGENTS.md`
wins.

## Responsibility boundary

```text
User → external AI client → MCP → BrowserMesh → isolated browser sessions
```

The external client (Claude Code, Codex, Cursor, Qwen, …) does the reasoning, planning, and
orchestration. BrowserMesh only executes browser work.

Never add internal Agent entities or registries, `browser_agent_*` / `browser_message_*` tools,
agent mailboxes or messaging, LLM-owned session principals, internal LLM calls, or reasoning loops
inside BrowserMesh. Session `name` and metadata are neutral workflow labels — not principals,
permissions, identities, or leases.

## Architecture invariants

BrowserMesh is an independent runtime, not a wrapper around Playwright MCP. MCP is a transport
adapter; Playwright is a browser-engine adapter. Domain, application, and runtime code import
neither.

- **Explicit addressing.** Every browser operation targets an explicit `sessionId`; every
  page-specific operation an explicit `pageId`. There is never a global `currentSession`,
  `activeSession`, `currentPage`, `activePage`, or `currentTab`.
- **Context isolation.** Each ready session owns its own non-persistent Chromium `BrowserContext`.
- **Page isolation.** A `pageId` from another session is rejected.
- **Per-session serialization.** Everything touching one session's live browser state goes through
  that session's serial queue — including read-style operations (snapshot, URL, title, visible
  text). They must not bypass an in-progress operation.
- **Cross-session parallelism.** Different sessions run concurrently. Never introduce one global
  browser-operation mutex.
- **Queue recovery.** A rejected, failed, or timed-out operation must not poison a session queue;
  subsequent accepted operations still execute.
- **Lifecycle safety.** Close and shutdown must not race initialization into leaked contexts or
  pages. An unexpected Chromium disconnect must not silently rebuild live sessions.

`tests/unit/architecture.test.ts` enforces the import boundaries and the `process.env` rule below.
Do not weaken it to make a change pass.

## Source of truth

On conflict, in order: `docs/SPEC.md` → `docs/architecture.md` → ADRs in `docs/decisions/` →
documented public MCP/API contracts → tests covering current contracts → official MCP docs →
official Playwright docs → `README.md`.

Existing tests are not automatically authoritative. If a test encodes obsolete behaviour, work out
which artifact is stale and update that one — never restore removed Agent, mailbox, or messaging
code because an old test still expects it.

## Commands

| Command                    | Scope                                                    |
| -------------------------- | -------------------------------------------------------- |
| `npm run verify:fast`      | typecheck + lint + unit — the normal inner loop, ~25s    |
| `npm test`                 | **unit only** (`tests/unit`) — 156 tests                 |
| `npm run test:integration` | real Chromium (`tests/integration`) — 72 tests           |
| `npm run test:e2e`         | external-client workflow (`tests/e2e`) — 1 test          |
| `npm run test:stress`      | bounded concurrency (`tests/stress`) — 2 tests           |
| `npm run verify`           | typecheck + lint + format:check + full coverage + build  |
| `npm run verify:package`   | builds, packs, installs the tarball, smoke-tests the CLI |

`npm run verify` is the release gate and takes ~72s: all 231 tests under coverage thresholds
(statements 90 / branches 75 / functions 95 / lines 90) plus a build. Use `verify:fast` while
iterating and `verify` before pushing.

Setup from a clean clone: `npm install`, then `npx playwright install chromium`.

## Environment

`BROWSERMESH_HEADLESS` accepts exactly `true` or `false`; the default is `false` (headed). It is
read only by `src/infrastructure/config.ts`, so it reaches the CLI, the stdio server, and
`verify:package`.

It does **not** reach the in-process browser suites: `tests/support/real-runtime.ts` constructs
`PlaywrightBrowserEngine` with `headless: true` directly, so `test:integration`, `test:e2e`,
`test:stress`, and `test:coverage` always run headless regardless of the variable.

`browser_runtime_info` reports the effective non-sensitive configuration. The full variable list is
in `README.md`.

## Gotchas

- `src/infrastructure/generated/version.ts` is **generated** from `package.json`. A stale value
  fails `check:version`, which runs as `pretypecheck` — so typecheck goes red before it type-checks
  anything. Fix with `npm run generate:version`, never by editing the generated file.
- `process.env` may be read **only** in `src/infrastructure/config.ts`. Everything else takes
  configuration as an argument. Enforced by `tests/unit/architecture.test.ts`.
- `playwright` in `dependencies` is an exact `x.y.z` version, never a `^` range: one BrowserMesh
  release pins one Playwright/Chromium pair. Release-contract tests reject drift.
- `.prettierignore` covers `AGENTS.md`, `PROMT.md`, `docs/SPEC.md`, and `CHANGELOG.md`. Every other
  Markdown and JSON file is format-checked — run `npm run format` after adding one, or
  `format:check` fails in `verify`.
- Development here is on **Windows 11**. The `xvfb-run` wrappers in CI cannot be reproduced locally.
  Local Node is 22; `.nvmrc` pins 24.13.0 and CI covers both.

## Code rules

- **Resources.** Release BrowserContexts, pages, browser handles, timers, listeners, queues,
  temporary servers, streams, and spawned processes. No fire-and-forget promises without explicit
  ownership and error handling. Empty `catch` blocks are forbidden; cleanup errors are surfaced or
  safely aggregated.
- **Types.** Strict typing. No `any` without a documented, unavoidable reason. No unsafe casts. Do
  not return mutable internal maps or registries. Playwright types must never leak into domain or
  MCP contracts. Error behaviour stays predictable.
- **Security.** Never log cookies, auth tokens, saved browser state, passwords, form values, or
  full page contents, and never expose arbitrary filesystem paths. No general shell tool, no
  arbitrary local filesystem reads. Validate state identifiers and externally supplied structured
  input. Screenshots stay in-memory MCP image results. `.browsermesh/` is never committed.
- **stdio.** stdout carries MCP protocol traffic only. Structured logs go to stderr.

## MCP tool descriptions

Tools are chosen by a model, not read by a human. A description must answer: what does this do, when
should the AI reach for it, and which isolation or addressing rule applies.

`browser_session_create` must convey that separate sessions belong to different users, accounts,
roles, authentication states, and independent parallel workflows.

Avoid "Creates a session." Expose the decision boundary instead.

## Recipes

- Adding a browser operation → skill `add-browser-tool`
- Writing an ADR → skill `write-adr`
- Cutting a release → skill `release`
- Reviewing session isolation or log leaks → subagents `isolation-auditor`, `log-leak-reviewer`
- Deeper background → `AGENTS.md`, `docs/development.md`, `docs/architecture.md`
