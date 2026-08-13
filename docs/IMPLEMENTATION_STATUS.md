# BrowserMesh v0.1 Implementation Status

Updated: 2026-08-13

BrowserMesh v0.1 and the accepted professional MCP improvement program are implemented. A final
repository-wide adversarial audit is still required before release completion is declared.

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

- Final error-contract hardening `npm run verify`: passed with 24 test files and 147 tests, coverage
  thresholds, strict typecheck, lint, formatting, and production build.
- `BROWSERMESH_HEADLESS=true npm run verify:package`: passed with build/tarball inspection, clean
  temporary installation, public import/bin, MCP version/discovery, real Chromium navigation,
  interaction, and cleanup smoke.
- Targeted classifier/runtime/MCP/real-Chromium verification: 78 tests passed. `git diff --check`
  passed.

The parent integration task must still run the final adversarial audit and its full
fresh-environment matrix before marking release completion.

Known blockers: none.

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
