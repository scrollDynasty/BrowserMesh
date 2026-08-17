# BrowserMesh v0.1 Implementation Status

Updated: 2026-08-17

## Adoption program (ADR 0019, ADR 0020)

Measured against a competitive review of `@playwright/mcp` and `chrome-devtools-mcp`, the runtime
was sound but expensive and awkward to adopt. Discovery cost 134,839 bytes — 7.3× the official
Playwright MCP server — `--help` exited with status 2, and a first run failed on a missing browser.
The following are complete.

| Change                                                        | Result                                                      | Contract |
| ------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| Share repeated subschemas through `$defs`/`$ref`              | Argument schemas −37.4%, result schemas −12.7%              | ADR 0019 |
| One `browser_observe` replacing four list tools               | Four copies of one contract removed                         | ADR 0020 |
| Results stop restating their requests                         | `browser_action_and_wait` 4,828 → 1,565 bytes               | ADR 0020 |
| One spelling of the composite action target                   | `locator` removed from domain, runtime, engine, and schema  | ADR 0020 |
| Tool profiles via `--tools`                                   | `core` publishes 31 of 35 tools                             | ADR 0020 |
| Real argument parser: `--help`, `--version`, per-option flags | Help and version exit `0`; every variable has an option     | —        |
| Chromium downloaded on first start                            | `--no-auto-install` keeps the previous behaviour            | —        |
| Readable configuration failures                               | Names the variable; no stack, path, or value                | —        |
| Saved state under the home directory                          | No longer scattered by the client's working directory       | —        |
| MCP prompts and a session resource                            | `parallel_roles`, `diagnose_page`, `browsermesh://sessions` | —        |
| npm package renamed to `browsermesh`                          | Matches the name docs and the registry already used         | —        |

`tools/list` is 87,367 bytes across 35 tools, or 79,479 with `--tools=core`: 35.2% and 41.1% below
the starting point. The remaining floor is the semantic locator union that roughly twenty tools
embed, which is the feature rather than waste; ADR 0020 records why collapsing the interaction tools
to reach Playwright MCP's number is rejected.

Verification: 156 unit, 72 integration, 3 e2e, and 3 stress tests pass, with typecheck, lint, and
format clean.

Released as `browsermesh@0.2.0`. Every version of `multi-agent-browser-mcp` is deprecated in favour
of it.

Outstanding, and requiring the maintainer rather than code:

- **npm trusted publishing** is not configured for `browsermesh`. A package that does not yet exist
  has nothing to attach a trusted publisher to, so the 0.2.0 release could not publish over OIDC and
  was pushed by hand; `publish.yml` will fail the same way on 0.2.1 until a trusted publisher naming
  this repository, `publish.yml`, and the `npm` environment is added on npmjs.com.
- **The MCP registry still advertises the old package.** Registry publication runs after
  `npm publish` in the same job, so it did not run either; the registry's latest entry is 0.1.5
  pointing at `multi-agent-browser-mcp`. Configuring trusted publishing first lets the next release
  correct this on its own.
- GitHub repository topics are unset.

BrowserMesh v0.1 and the accepted professional MCP improvement program are implemented. The final
repository-wide adversarial audit and clean-environment release gate are complete, with no known
blocker, critical, or high-severity defect remaining in v0.1 scope.

## Baseline phases

| Phase                        | Status   | Evidence                                                                                                                                              |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Foundation               | Complete | Strict TypeScript, ESLint, Prettier, Vitest, validated config, structured stderr logging, architecture tests, and package scripts.                    |
| 1 — Browser engine           | Complete | Engine port and isolated Chromium adapter with lazy lifecycle, actionable startup failure, password redaction, cleanup, and disconnect notification.  |
| 2 — Multi-session core       | Complete | Explicit lifecycle, one non-persistent context per ready session, deterministic initial page, quotas, idempotent close, and bounded terminal records. |
| 3 — Pages                    | Complete | Explicit `pageId`, create/list/close, default-page marker, quotas, ownership checks, and real-browser lifecycle coverage.                             |
| 4 — Browser operations       | Complete | HTTP(S) navigation/history, reads, semantic locators, snapshots, interactions, and in-memory PNG screenshots.                                         |
| 5 — Concurrency              | Complete | Independent session queues, cross-session parallelism, operation IDs, deadlines, cancellation, failure recovery, and close/shutdown draining.         |
| 6 — MCP                      | Complete | Stdio server, exact schemas, structured results, safe errors, discovery metadata, cancellation, subprocess routing, and clean exit.                   |
| 7 — Persistence              | Complete | Logical state IDs, private storage, atomic save/list/remove/restore, same-state serialization, and safe failure recovery.                             |
| 8 — External-client workflow | Complete | A real MCP client coordinates isolated workflows; BrowserMesh contains no internal agent runtime.                                                     |
| 9 — Release readiness        | Complete | Node 22/24 and Windows CI, coverage gates, tarball install, public import/bin/manifest checks, and packaged browser smoke.                            |

## Professional MCP improvement milestones

| Milestone                                                             | Status                                                                           | Contract                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| Exact version chain, explicit headless mode, runtime info, doctor     | Complete                                                                         | ADR 0007                              |
| Structured MCP output, annotations, request cancellation              | Complete                                                                         | ADR 0008                              |
| Passive waits and waiter-first atomic action/wait                     | Complete                                                                         | ADR 0009                              |
| Bounded console, page-error, network, and failed-request observations | Complete                                                                         | ADR 0010                              |
| Bounded snapshots and typed browser interactions                      | Complete                                                                         | ADR 0011                              |
| Artifact security/design gate                                         | Accepted; implementation intentionally deferred and not a completion requirement | ADR 0012                              |
| Short-lived page-scoped element references                            | Complete                                                                         | ADR 0013                              |
| Engine-neutral nested iframe targeting                                | Complete                                                                         | ADR 0014                              |
| Immutable bounded snapshot-tree pagination                            | Complete                                                                         | ADR 0015                              |
| Origin-scoped geolocation permissions                                 | Complete                                                                         | ADR 0016                              |
| Runtime-authoritative resource budgets                                | Complete                                                                         | ADR 0017                              |
| Absolute deadlines, immutable capture plans, exact engine dependency  | Complete                                                                         | ADR 0018                              |
| Stable public browser-failure classification and redacted context     | Complete; final hardening                                                        | SPEC §13, architecture error contract |

Remote HTTP/multi-client security, filesystem-backed artifacts, and internal agent orchestration are
deferred scope. They are not missing parts of the accepted program.

## Current public contract

- Every tool declared by `outputSchemas` is registered and discovered. The MCP contract test derives
  the exact expected tool set from that registry instead of maintaining a stale numeric count.
- Successful calls return direct `structuredContent` validated by an object-root output schema plus
  compatibility text; screenshots additionally return in-memory image content.
- Every public tool has a human title and reviewed read-only, destructive, idempotent, and
  open-world annotations.
- Application failures return bounded JSON with a stable error code and accepted-operation
  `operationId`. Browser failures additionally expose only the supported `reason` enum
  (`timeout`, `dns`, `connection`, `tls`, `invalid_url`, `locator_ambiguous`,
  `element_not_found`, or `other`) and allowlisted bounded context.
- Public URL context is limited to HTTP(S) origin and path; credentials, query strings, and
  fragments are removed. Locator context is limited to an allowlisted strategy and bounded
  value/name/exact fields. Raw Playwright messages, stacks, causes, tokens, and form values are not
  returned.
- Detail sanitization treats getters and proxies as hostile and protects every allowlisted read
  independently, so one throwing field cannot reveal data or suppress other safe fields.
- Fatal process diagnostics never serialize the rejected/thrown value, stack, message, cause, or
  hostile object. They emit one bounded stable `INTERNAL_ERROR` diagnostic, attempt deterministic
  shutdown, surface cleanup failure safely, and exit non-zero.

## Capability evidence

- Real Chromium tests cover cookie/storage/page/DOM isolation, cross-session page rejection,
  navigation and history, password redaction, exact and ambiguous locators, typed interactions,
  screenshots, persistence ordering, shutdown/disconnect, and cleanup.
- Wait tests cover URL/load/locator/text conditions, waiter-first navigation/response/popup/dialog
  composites, timeouts, cancellation, same-session ordering, cross-session parallelism, cleanup,
  and queue recovery.
- Observation tests cover bounded per-page stores, cursor pagination, overflow accounting,
  redaction, request correlation, ownership isolation, cancellation, and listener cleanup.
- Snapshot tests cover semantic/iframe scope, depth, boxes, Unicode/byte bounds, honest partial
  metadata, `interactiveOnly`, per-node child limits, immutable cursor pagination, cursor TTL/quota,
  and snapshot cleanup.
- Element-reference tests cover page/session ownership, TTL/quota, DOM replacement, navigation,
  page close, popup lifecycle, stale rejection, and queue recovery.
- Context tests cover viewport, scale, locale, timezone, color/reduced-motion, user agent, finite
  geolocation, canonical origin permission grants, concurrent isolation, cancellation cleanup, and
  restored-state separation.
- Typed actions cover hover, focus, check/uncheck, double-click, coordinate scroll,
  scroll-into-view, drag/drop, popup/dialog actions, iframe targeting, and viewport/full-page/element
  screenshots through the owning session queue.
- Resource-budget tests cover bounded session labels/metadata, Unicode and UTF-8-safe visible-text
  truncation, screenshot dimension preflight plus post-capture byte quotas, atomic saved-state
  count/per-state/aggregate quotas, concurrent replacement preservation, bounded corrupt-file
  reads, and queue recovery after rejection. Effective budgets are reported by
  `browser_runtime_info`.
- Error tests cover deterministic classification, a real refused-connection navigation, locator
  timeout/ambiguity/not-found reasons, invalid URL context, hostile getters/proxies, URL redaction,
  operation correlation, and post-failure session usability.

## Operability and distribution evidence

- MCP `serverInfo.version`, generated source, package metadata, `server.json`, source/stdio
  handshakes, and installed-tarball handshake form one exact build-time version chain.
- `browser_runtime_info` is non-launching and reports exact BrowserMesh/Playwright versions, Node,
  nullable live Chromium version, launch state, effective safe configuration, and bounded session
  counts.
- `browsermesh --doctor --json` has a versioned schema, stable checks, safe remediation, non-zero
  failure exits, private data-directory access probing, executable detection, and bounded real
  browser/context/page/cleanup smoke.
- `BROWSERMESH_HEADLESS` is strictly `true|false`, defaults to `false`, and is deliberately selected
  by CI/package verification.
- `scripts/verify-package.ts` builds and inspects an npm tarball, installs it in a clean temporary
  project, verifies public import/bin and MCP discovery/version, then performs a real installed
  navigation, DOM interaction, and shutdown smoke. It never publishes.
- CI includes static checks, Node 22/24 real-browser integration/e2e, deterministic and real stress,
  coverage, CodeQL/dependency review, and Linux/Windows installed-package smoke.

## Verification checkpoint

The records below are dated evidence from the v0.1 release gate, before the adoption program above.
Counts they cite — 38 tools, four observability tools, 161 tests — describe that state, not the
current one.

- ADR 0018 final-audit hardening passes `npm run verify` with 28 test files and 175 tests
  (90.44% statements, 80.75% branches, 95.85% functions, 92.67% lines), including real-Chromium
  regressions for a partially consumed queue deadline, immutable screenshot capture after page
  growth, pre-ARIA source rejection, surfaced element-ref cleanup failure, and exact Playwright
  package/lock consistency. E2E, stress, and `BROWSERMESH_HEADLESS=true npm run verify:package`
  also pass.

- An independent clean detached worktree audit of `origin/master` at `5470967` used Node 22.22.3
  and npm 10.9.8. `npm ci` installed 240 packages with zero reported vulnerabilities. The exact
  `0.1.3` package/lockfile/server/generated version chain and installed/generated Playwright
  `1.62.1` chain matched.
- That clean gate passed `npm run verify` with 26 test files and 161 tests (90.48% statements,
  80.84% branches, 96.15% functions, and 92.81% lines), 50 integration tests, one real e2e test,
  two stress tests, `BROWSERMESH_HEADLESS=true npm run verify:package`, and all five doctor checks.
  The packed artifact contained 125 allowlisted files and no source, tests, docs, or private state.
- MCP inspection found the exact 38-tool registry/discovery set; every tool exposes its reviewed
  title, annotations, and object-root output schema, and README/SPEC document the complete set.
- Final fatal-diagnostic hardening verification passes with 28 test files and 171 tests, including
  direct and subprocess cleanup/exit regressions. Coverage remains above every enforced threshold:
  90.08% statements, 80.61% branches, 95.11% functions, and 92.44% lines.
- Combined final error-contract/resource-budget/lifecycle hardening `npm run verify`: passed with 26
  test files and 161 tests, coverage thresholds, strict typecheck, lint, formatting, and production
  build.
- `BROWSERMESH_HEADLESS=true npm run verify:package`: passed with build/tarball inspection, clean
  temporary installation, public import/bin, MCP version/discovery, real Chromium navigation,
  interaction, and cleanup smoke.
- Targeted classifier/runtime/MCP/real-Chromium verification: 78 tests passed. `git diff --check`
  passed.
- Final lifecycle integration preserves stop-during-start cleanup, operation deadline accounting
  from queue acceptance, stale-ref mapping after engine failures, close/shutdown draining, and
  snapshot-cursor immutability while retaining stable public failure reasons.

Known blockers: none.

## Public documentation website

- A separate VitePress site in `docs-site/` presents the verified v0.1 runtime, all 38 MCP tools,
  installation/client setup, concepts, architecture, examples, configuration, CLI/errors/results,
  troubleshooting, development, security/privacy, FAQ, canonical changelog links, and license.
- Local search, theme switching, responsive navigation, custom accessible home content, the GitHub
  Pages repository base path, and source/edit links are configured.
- The custom theme is split into token, documentation-shell, home, and responsive CSS modules. It
  uses locally bundled Geist and Geist Mono variable fonts with no font CDN call. The home page and
  README use a restrained developer-documentation system with one accent, real configuration
  examples, compact responsive layouts, and no product logo or decorative mock interface.
- `.github/workflows/docs.yml` builds documentation on pull requests and deploys only from `master`
  (or manual dispatch) through GitHub Pages Actions.
- Documentation redesign validation passed `npm run docs:build`, `npm run typecheck`, `npm run lint`,
  and `npm run format:check`; the earlier repository-wide verification and installed-tarball smoke
  remain recorded above.

## Responsibility boundary and intentional non-scope

The runtime boundary remains:

```text
User → external AI client → MCP → BrowserMesh → isolated browser sessions
```

BrowserMesh v0.1 contains no internal AI agent identities, registries, ownership, mailboxes,
messaging, handoff protocol, LLM calls, or reasoning loops. Session names and metadata are neutral
workflow labels only.

Intentional v0.1 non-scope:

- remote HTTP/hosted service and multi-client authorization or leases;
- internal orchestration, distributed workers, databases, brokers, Docker/Kubernetes requirements,
  dashboard, billing, or cloud infrastructure;
- arbitrary shell/filesystem access, controlled artifact storage, uploads/downloads, HAR/trace/video,
  Firefox/WebKit parity, or arbitrary page JavaScript evaluation;
- silent reconstruction of existing live sessions after Chromium disconnect.
