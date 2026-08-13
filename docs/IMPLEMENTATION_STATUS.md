# BrowserMesh v0.1 Implementation Status

Updated: 2026-08-13

The baseline `docs/SPEC.md` phases 0 through 9 and the v0.1 acceptance gate are complete. Section 22
now defines an accepted post-v0.1 professional MCP improvement program; its implementation is
pending and does not retroactively make the baseline incomplete.

## Phase evidence

| Phase                        | Status   | Implementation and verification evidence                                                                                                                                                  |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Foundation               | Complete | Strict TypeScript, ESLint, Prettier, Vitest, centralized validated config, structured stderr logging, documentation, package scripts, architecture boundary tests.                        |
| 1 — Browser engine           | Complete | Engine port and Playwright Chromium adapter implement lazy start/stop, actionable missing-browser errors, password snapshot redaction, context/page cleanup, and disconnect notification. |
| 2 — Multi-session core       | Complete | Explicit session registry/lifecycle, BrowserContext-per-session isolation, deterministic initial page, limits, bounded terminal records, idempotent close, cleanup.                       |
| 3 — Pages                    | Complete | Explicit `pageId`, create/list/close, default marker, per-session limit, cross-session rejection, real-Chromium lifecycle coverage.                                                       |
| 4 — Browser operations       | Complete | HTTP(S) navigation/history/reload, URL/title, deterministic exact role locators, ambiguity errors, redacted snapshots, visible text, interactions, and in-memory PNG screenshots.         |
| 5 — Concurrency              | Complete | Independent serial queue per session, cross-session parallelism, required page-address result types, operation IDs, bounded timeouts, failure recovery, close/shutdown draining.          |
| 6 — MCP                      | Complete | Stdio server, schemas, safe success/error mapping, complete discovery descriptions, exact v0.1 tool-set contract test, real subprocess routing/validation/clean-exit test.                |
| 7 — Persistence              | Complete | Logical `stateId`, safe names, save/list/remove/restore, private application path, atomic replacement, same-state write serialization, failure recovery, no state contents in logs.       |
| 8 — External-client workflow | Complete | A real MCP `Client` coordinates isolated buyer and seller sessions in the deterministic local workflow e2e; BrowserMesh creates no internal agents.                                       |
| 9 — Release readiness        | Complete | Node 22/24 real-browser CI, Windows package smoke, coverage gates, npm tarball install, manifest/public import/bin validation, and packaged MCP browser workflow.                         |

## Contribution and release automation

- Pull requests use templates, Conventional Commit title validation, a stable aggregate branch-protection check, and CodeQL advanced analysis.
- CI separates static, Node 22/24 real-Chromium integration/e2e, deterministic and real-browser
  stress, coverage, dependency review, and Linux/Windows installed-package smoke jobs.
- Dependabot covers npm and pinned GitHub Actions dependencies; vulnerability alerts and automated
  security updates are enabled in the repository.
- Release Please prepares reviewed version/changelog PRs from merged contributor changes.
- A protected `vX.Y.Z` tag runs the complete verification gates, publishes with npm Trusted
  Publishing, and updates the official MCP Registry; both publications use GitHub OIDC, while
  ordinary pushes and feature PRs cannot publish.
- Contributor, conduct, security, and maintainer release/setup documentation is present in the repository root and `docs/releasing.md`.

## Professional MCP improvement program

| Milestone                                              | Status                                                           | Contract |
| ------------------------------------------------------ | ---------------------------------------------------------------- | -------- |
| Version chain, headless config, runtime info, doctor   | Accepted; pending implementation                                 | ADR 0007 |
| Structured MCP output, annotations, cancellation       | Accepted; pending implementation                                 | ADR 0008 |
| Passive waits and atomic action/wait                   | Accepted; pending implementation                                 | ADR 0009 |
| Bounded redacted browser observability                 | Accepted; pending implementation                                 | ADR 0010 |
| Bounded snapshots, context options, typed interactions | Accepted; pending implementation                                 | ADR 0011 |
| Filesystem-backed artifacts                            | Design gate accepted; capability ADR and implementation deferred | ADR 0012 |

Remote HTTP/multi-client security and internal agent orchestration are not part of the accepted
implementation program. The latter remains a separate external layer.

## Acceptance evidence

- Real-Chromium integration covers isolated cookies, localStorage, pages, URLs, password redaction, exact/ambiguous role locators, DOM reads, screenshots, page lifecycle, history, interactions, persistence, ordering, parallelism, timeout recovery, shutdown, disconnect, and cleanup.
- Unit tests cover lifecycle/limits, terminal-record bounds, operation correlation, queue recovery, navigation policy, persistence naming/atomic concurrency, configuration, structured logging, and architecture dependency rules.
- MCP tests cover the exact public tool set, descriptions, schema rejection, safe structured errors, successful calls, explicit routing, subprocess stdio negotiation, and exit.
- The deterministic 50-session stress test verifies runtime routing and cleanup, while a separate
  eight-context real-Chromium stress test verifies bounded adapter isolation and resource release.
- `scripts/verify-package.ts` tests the generated npm tarball rather than source-tree execution and
  performs stdio MCP navigation, DOM inspection, and interaction through the installed executable.

## Responsibility boundary

BrowserMesh v0.1 contains no internal AI Agent entities, registries, ownership abstraction, mailboxes, messaging, handoff protocol, or LLM orchestration. Session names and string metadata are neutral workflow labels only.

The runtime boundary remains:

```text
User → external AI client → MCP → BrowserMesh → isolated browser sessions
```

## Verification

Baseline audit before accepting the improvement plan:

- The v0.1 source/package verification remained green.
- `npm run format:check` reported only the new untracked
  `docs/PROFESSIONAL_MCP_IMPROVEMENT_PLAN.md`; this was documentation handoff formatting, not a
  product defect. Other baseline checks were green.
- The audit environment's configured `0.1.2` executable was stale local installation state, not a
  BrowserMesh project defect or blocker.

Last completed v0.1 release verification:

- `npm ci`: passed with 0 reported vulnerabilities.
- `npm run verify`: passed after the clean install.
  - TypeScript typecheck: passed.
  - ESLint: passed.
  - Prettier check: passed.
  - Vitest: 16 test files and 61 tests passed.
  - V8 coverage thresholds: statements 90%, branches 75%, functions 95%, lines 90%.
  - Production build: passed.
- `npm run verify:package`: passed after the clean install, including installed tarball MCP/Chromium smoke.
- Release configuration JSON and all repository YAML files parsed successfully.
- Official `mcp-publisher` v1.8.1 validation of `server.json`: passed.
- `git diff --check`: passed.

Known blockers: none.

## Intentional v0.1 non-scope

- Remote HTTP and hosted cloud infrastructure.
- Distributed workers, databases, brokers, Docker/Kubernetes runtime requirements.
- Dashboard, downloads, arbitrary shell/filesystem access, Firefox/WebKit parity.
- Live-session crash reconstruction after Chromium disconnect.
