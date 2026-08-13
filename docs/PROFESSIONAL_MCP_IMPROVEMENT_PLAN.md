# BrowserMesh Professional MCP Improvement Plan

Status: accepted post-v0.1 improvement roadmap; implementation in progress

Prepared: 2026-08-13

Audience: maintainer or coding agent improving BrowserMesh

## 1. Purpose

This document records confirmed findings from a local black-box and source audit of BrowserMesh,
then defines the accepted, technically safe improvement program for making the MCP runtime more
reliable and more useful for professional multi-role E2E/QA work.

Acceptance of the program is not permission to implement every item as one uncontrolled change.
Follow `AGENTS.md` and the contracts in `docs/SPEC.md` and the accepted ADRs. Deliver each milestone
as a small vertical slice with regression coverage.

### 1.1 Accepted and deferred scope

The accepted implementation scope is the ordered milestones in section 13 through bounded context
options and interactions. The artifact milestone is accepted as **design before code**: its storage,
quota, retention, and redaction ADR must be reviewed before an artifact implementation PR starts.

The following remain deferred and are not completion requirements for this program:

- internal agents or orchestration, which remain a separate product/layer;
- remote Streamable HTTP, authentication, multi-client leases, and hosted operation;
- arbitrary JavaScript evaluation, unrestricted filesystem access, and arbitrary paths;
- HAR/body/trace/video/download capture until the artifact ADR and explicit capability contracts
  are accepted;
- live-session reconstruction after browser disconnect.

An implementation PR must not silently expand one milestone into a deferred item.

## 2. Non-negotiable responsibility boundary

BrowserMesh is a browser-execution runtime:

```text
User -> external AI/MCP client -> BrowserMesh -> isolated browser sessions
```

Do not add internal LLM reasoning, agent processes, agent registries, prompt orchestration,
mailboxes, or agent-to-agent messaging to BrowserMesh v0.1. Those belong to a separate external
orchestration layer described in section 12.

BrowserMesh should expose deterministic, observable, bounded browser capabilities. The external
client decides which actor does what and coordinates workflows.

This boundary is not a claim that agent communication, shared runtimes, crash recovery, downloads,
or remote transport are technically impossible. They are implementable, but some are outside the
approved v0.1 product contract and others require additional security/ownership/persistence design
before they can be offered without weakening current guarantees. “Separate layer” and “future
milestone” mean sequencing and responsibility, not impossibility.

## 3. Audit baseline

### 3.1 Confirmed working behavior

A direct MCP client successfully started the locally installed BrowserMesh runtime, discovered 23
tools, created an isolated Chromium session, received explicit `sessionId` and initial `pageId`, and
closed the session. Structured correlation logs were written to stderr. No base session-lifecycle
or isolation defect was demonstrated by this diagnostic run.

The discovered tool set was:

- session create/list/get/close;
- page create/list/close;
- navigate/back/forward/reload;
- URL/title/snapshot/visible text;
- click/fill/press/select option;
- screenshot;
- state save/list/remove.

The repository already has good foundations: explicit addressing, one `BrowserContext` per session,
per-session queues, cross-session parallelism, bounded timeouts, safe state identifiers, structured
errors, password snapshot redaction, graceful cleanup, packaged-artifact smoke tests, real Chromium
integration tests, and stress coverage.

### 3.2 Confirmed local installation drift

The audit environment had a configured executable at package version `0.1.2` while the repository
was at `0.1.3`. This observation is stale local installation state, not a project defect, release
blocker, or implementation milestone. Operators should select an exact BrowserMesh package version,
then run that installed package's documented Playwright browser-install command so the resolved
Playwright package installs a compatible Chromium binary.

### 3.3 Confirmed server-version defect

`src/adapters/mcp/server.ts` constructs `McpServer` with a hard-coded `version: '0.1.0'` while the
package is `0.1.3`. MCP initialization therefore cannot reliably identify the running artifact.

Required fix:

- produce one build-time version value from package metadata;
- use it for MCP `serverInfo.version`;
- keep package, MCP Registry manifest, release metadata, and runtime version in one verified chain;
- add source-tree and packed-tarball tests asserting the exact expected version;
- do not read arbitrary project files at runtime just to discover the version.

Acceptance:

```text
installed package version == serverInfo.version == server.json version
```

### 3.4 Confirmed local no-op and accepted headless configuration

The local MCP configuration sets `BROWSERMESH_HEADLESS=true`, but `loadConfig()` does not declare
that variable and `createRuntime()` constructs `new PlaywrightBrowserEngine()` without passing a
headless value. The current public v0.1 contract intentionally launches headed Chromium, so this is
not evidence that `master` violates its documented contract. It is a local integration
misconfiguration: an unsupported environment variable was assumed to exist.

Immediate local fix: remove the unsupported variable instead of relying on it.

Headless operation is accepted as a new public configuration while the default remains `false` to
preserve the existing headed contract. Implement it as follows:

- add a centrally validated `BROWSERMESH_HEADLESS` boolean;
- include `headless` in `BrowserMeshConfig`;
- pass the value through `createRuntime()` to the Playwright adapter;
- document the actual default;
- test `true`, `false`, invalid values, and propagation to the adapter;
- ensure CI/package verification deliberately selects headed-under-Xvfb or headless rather than
  depending on an accidental display environment.

Unknown environment variables may remain ignored, but a documented/supported variable must never
be a no-op. A future `--doctor` should report effective headed/headless behavior so unsupported
operator assumptions are visible.

### 3.5 MCP-client discovery observation

The same runtime worked through a direct MCP client, but BrowserMesh tools were not present in the
already-running Codex task after configuration. Treat this as client lifecycle/configuration state
until reproduced against a newly started MCP client.

Improve installation documentation with a deterministic post-install check:

1. print exact package version;
2. initialize MCP and print `serverInfo`;
3. list tools;
4. create and close a diagnostic session;
5. explain that some MCP clients require a full restart after server configuration changes.

Do not classify client-side stale discovery as a BrowserMesh defect without a fresh-client
reproduction.

## 4. P0: runtime diagnostics and operability

Add a bounded, read-only `browser_runtime_info` tool. It should return safe structured data:

```json
{
  "serverVersion": "0.1.3",
  "nodeVersion": "24.x",
  "playwrightVersion": "1.x",
  "browserProduct": "chromium",
  "browserVersion": null,
  "browserLaunchState": "not_started|ready|failed",
  "headless": true,
  "persistenceEnabled": true,
  "defaultTimeoutMs": 10000,
  "maxSessions": 50,
  "maxPagesPerSession": 20,
  "activeSessions": 0,
  "failedSessions": 0
}
```

`browserVersion` is `string | null`: it is `null` before a browser is ready and after a failed
launch that produced no trustworthy version. It is the safe product version reported by the live
browser, not an inferred Playwright download revision. `playwrightVersion` is the resolved package
version. Do not return absolute private paths, cookies, storage state, tokens, environment dumps,
launch arguments containing secrets, or full error stacks.

Add a separate `--doctor --json` CLI command for installation diagnosis. It validates:

- Node version;
- package/runtime version consistency;
- Chromium executable availability;
- browser launch prerequisites, including missing Linux libraries when the bounded smoke reports
  them through a safe classified failure;
- data-directory create/read/write permissions without exposing its contents;
- an actual bounded launch/create-context/create-page/close smoke;
- actionable remediation and a non-zero exit code on failure.

The MCP server must retain lazy browser startup so tool discovery remains available when Chromium is
missing.

## 5. P0: deterministic waits

Professional agents should never depend on arbitrary sleeps. Add one composable `browser_wait`
operation routed through the owning session queue.

Initial passive conditions:

- URL equals/matches;
- load state (`domcontentloaded`, `load`);
- locator visible/hidden;
- locator attached/detached;
- locator enabled/disabled;
- text present/absent;
- an already-running navigation/request condition where no later queued action is required.

Contract requirements:

- explicit `sessionId` and `pageId`;
- bounded `timeoutMs`;
- deterministic condition schema, not arbitrary JavaScript;
- `OPERATION_TIMEOUT` on unmet condition;
- queue remains usable after timeout;
- result includes the satisfied condition and operation correlation IDs;
- no global network-idle assumption as a universal readiness signal.
- URL/request matchers are bounded exact values or safe globs by default; do not accept unbounded
  caller regular expressions that can introduce pathological matching cost.

Important queue rule: a standalone wait that occupies a session's serial queue cannot wait for a
later click/press submitted to the same queue; the later action would never start. Event-driven
flows therefore need an atomic composite such as `browser_action_and_wait` (or a narrowly typed
`click_and_wait_for_response`/`click_and_wait_for_popup`). Inside that single queued operation the
adapter must register the response/popup/navigation waiter first, perform the typed action second,
and await both under one shared deadline. Do not solve this with parallel calls that bypass the
session queue.

Add real-browser tests for success, timeout, queue recovery, same-session ordering, and
cross-session parallelism.

## 6. P0: console, page-error, and network observability

The current tool set cannot independently prove frontend exceptions, failed HTTP requests,
unexpected retries, or duplicate mutations. Add bounded per-page/per-session collectors.

Accepted read tools:

- `browser_console_list`;
- `browser_page_errors_list`;
- `browser_network_list`;
- `browser_failed_requests_list`;
- optional clear/checkpoint operation using an event cursor rather than destructive global clear.

Each event should include only safe metadata:

```json
{
  "eventId": "monotonic/cursor-safe id",
  "timestamp": "UTC ISO-8601",
  "sessionId": "...",
  "pageId": "...",
  "kind": "console|page_error|request|response|request_failed",
  "level": "error",
  "method": "POST",
  "url": "redacted URL",
  "resourceType": "fetch",
  "status": 500,
  "durationMs": 123,
  "failure": "bounded safe message"
}
```

Security and resource requirements:

- bounded ring buffers with configurable hard maximums;
- pagination/cursor and `sinceEventId`;
- remove credentials and fragments from URLs;
- redact sensitive query keys;
- never expose `Authorization`, `Cookie`, `Set-Cookie`, client secrets, request bodies, response
  bodies, or browser storage by default;
- console text and page-error messages are caller-requested page evidence, not stderr logs, but may
  still contain application secrets: bound them, never serialize console argument objects by
  default, apply documented redaction, and offer a metadata-only mode;
- bound every string and total response size;
- detach listeners when pages/contexts close and after browser disconnect;
- events must never cross session/page ownership boundaries;
- dropped-event count must be visible so absence of evidence is not misreported as complete capture.

Body capture, HAR, and tracing should be separate opt-in future work with an ADR and stricter
redaction/storage policy.

## 7. P0: native structured MCP results

Most tools currently return JSON serialized inside a text content block. Improve machine
reliability with MCP-native typed output:

- define `outputSchema` for every tool;
- return `structuredContent` matching it;
- retain a concise text block for clients that display only text;
- keep image content for screenshots plus structured correlation metadata;
- use stable error codes and a bounded safe error object;
- never require an agent to parse nested JSON text to obtain IDs.

Use a common envelope only where it adds value. Avoid deeply nested `value.value` shapes. A session
creation response should expose `operationId`, `session`, and `initialPage` directly.

Add contract tests that validate every successful tool result against its output schema and ensure
error results cannot accidentally contain non-serializable causes or sensitive values.

Add accurate MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, and
`openWorldHint`) and human-readable titles. Treat annotations only as client UX/risk hints, never as
authorization. Examples:

- URL/title/snapshot/list tools are read-only;
- repeated close of a known session is idempotent under the current contract;
- saved-state removal is destructive and not generally idempotent because a second call returns
  `SAVED_STATE_NOT_FOUND`;
- navigation and page interaction operate on open-world page content;
- annotations must be verified by contract tests so behavior changes cannot silently make them
  false.

Long-running waits, diagnostics, and artifact operations should honor MCP request cancellation.
Cancellation must detach event listeners/timers, stop useful work promptly where Playwright permits,
and leave the per-session queue usable. For an MCP request cancelled through the protocol, the
client observes its SDK's cancellation/`AbortError`; the server must not promise delivery of a
second tool result after cancellation. Use progress
notifications only for genuinely multi-step operations with meaningful monotonic progress (for
example `doctor` or a large artifact export), not for ordinary clicks or waits with no honest total.

## 8. P1: agent-efficient snapshots and element references

The current full-body ARIA string is useful but can be large and forces repeated locator discovery.
Add bounded snapshot controls:

- `interactiveOnly`;
- `maxDepth`;
- `maxChildren`;
- `maxChars` with explicit truncation metadata;
- scope by semantic locator;
- optional bounding boxes;
- optional pagination/cursor for large trees.

Introduce short-lived element references only after defining their lifecycle carefully:

```text
snapshot -> @e1, @e2 ... -> click/fill using ref
```

Requirements for refs:

- scoped to exactly one `sessionId + pageId`;
- rejected cross-session and cross-page;
- invalidated on navigation/page close;
- detected as stale after relevant DOM replacement;
- bounded registry with cleanup;
- semantic locators remain supported and preferred for durable tests;
- stale refs return a dedicated, recoverable error such as `STALE_ELEMENT_REFERENCE`.

Do not expose raw Playwright `Locator` or `ElementHandle` objects.

Implementation checkpoint: the first bounded-snapshot slice implements semantic scope,
`maxDepth`, optional bounding boxes, and explicit snapshot-content `maxChars`/`maxBytes` partial metadata using the
documented Playwright 1.62 API. ADR 0013 completes short-lived adapter-generated refs with explicit
session/page scope, 30-second TTL, per-page quota/replacement, lifecycle and DOM-staleness checks,
and typed-action support. `interactiveOnly`, `maxChildren`, and pagination remain deferred until
their engine-neutral transform or cursor contract is complete.

## 9. P1: browser-context and interaction coverage

Extend `browser_session_create` with validated optional context settings:

- viewport width/height;
- device scale factor;
- locale;
- timezone ID;
- color scheme;
- reduced motion;
- user agent;
- geolocation plus explicit permissions policy.

Return the effective normalized context settings in the session view without secrets. Add isolation
tests showing that different sessions can use different settings concurrently.

Add high-value interactions as separate typed operations or a small coherent action family:

- hover and focus;
- check/uncheck;
- double click;
- scroll and scroll into view;
- drag and drop;
- dialog inspect/accept/dismiss;
- popup/new-page wait;
- iframe-scoped semantic targeting;
- full-page and element screenshots.

File upload/download must not introduce arbitrary filesystem access. If implemented, use a
controlled artifact repository and logical IDs. Preserve the existing prohibition on caller-chosen
arbitrary output paths.

Avoid arbitrary page JavaScript evaluation in the default profile. If a future diagnostics profile
adds evaluation, require an explicit opt-in capability and document that it can bypass normal data
minimization guarantees.

## 10. P1: evidence and artifacts

For professional QA, every material action should be correlatable with evidence. The external
gateway/evidence ledger should normally own `runId` and `scenarioId`; BrowserMesh only needs to
return stable operation/session/page correlation. BrowserMesh does not need to persist orchestration
identities in its runtime registry:

```json
{
  "runId": "external workflow id",
  "scenarioId": "external scenario id",
  "operationId": "BrowserMesh id",
  "sessionId": "...",
  "pageId": "...",
  "startedAt": "UTC timestamp",
  "durationMs": 123,
  "urlBefore": "safe/redacted",
  "urlAfter": "safe/redacted",
  "result": "success|error",
  "errorCode": null
}
```

`runId` and `scenarioId` are external neutral correlation metadata, not BrowserMesh agent identities
or ownership. They must not grant permissions. If they cross MCP at all, use a deliberately bounded
correlation field or supported request metadata rather than duplicating them in every public tool
schema without need.

Large screenshots, traces, HAR files, videos, and downloads require a controlled artifact model:

- logical `artifactId`;
- private runtime-owned directory;
- content type, byte size, checksum, created/expiry timestamps;
- quotas and lifecycle cleanup;
- no arbitrary paths;
- redaction policy;
- explicit enablement for sensitive artifacts.

This is an architectural addition and requires an ADR before implementation.

## 11. P2: resilience and multi-client evolution

The v0.1 design intentionally uses one Node process, one Chromium process, and MCP stdio. A Chromium
crash therefore invalidates every live session. Do not silently reconstruct old sessions because
that would falsely imply preservation of live page state.

Useful improvements that preserve correctness:

- runtime health state and disconnect reason;
- bounded restart for **new** sessions only;
- clear failed-session views and remediation;
- optional restore of a new session from an explicitly saved state;
- shutdown diagnostics for leaked pages/listeners/timers;
- metrics for active/failed sessions, queue depth, operation latency, timeouts, and dropped events.

If multiple independent MCP clients must share one runtime, design this as a future transport and
authorization milestone, not as session metadata:

- Streamable HTTP transport;
- authenticated client identity;
- generic session lease/ownership independent of LLM/agent concepts;
- lease token/version, heartbeat, TTL, explicit handoff, and audit;
- per-client quotas and rate limits;
- protection against one client listing or operating another client's sessions/states;
- persistent append-only audit suitable for a multi-client server.

A future HTTP server should bind to loopback by default, validate `Origin` where applicable, apply
the current MCP authorization guidance, and defend against DNS-rebinding/cross-origin access. Do not
assume that moving the existing stdio adapter behind an HTTP listener is sufficient multi-client
security.

Do not expose a shared remote runtime before these controls exist.

## 12. External multi-agent orchestration (separate project/layer)

Professional agent communication must be implemented outside BrowserMesh:

```text
Coordinator <-> worker/observer agents
       |                |
       +-------> task board / mailbox / leases
                         |
                         v
               Browser gateway/coordinator
                (single MCP client owner)
                         |
                         v
                     BrowserMesh
               /          |          \
      Director session  Employee session  Reviewer session
                         |
                         v
               append-only evidence ledger
```

The arrows above are ownership boundaries, not internal BrowserMesh agents. In the recommended
v0.1 topology, worker agents do **not** independently connect to and compete over one BrowserMesh
stdio process. They submit typed browser work to the browser gateway/coordinator. That single MCP
client owns the connection, maps each business actor to a distinct BrowserMesh session, executes
the requested operation, and returns the correlated result/evidence.

An alternative safe v0.1 topology is one BrowserMesh process per worker agent. This provides strong
process isolation, but sessions cannot be shared and cross-agent coordination still belongs to the
external task board/evidence ledger. A directly shared runtime becomes appropriate only after the
multi-client transport, authentication, session leases, quotas, and audit controls from section 11
exist.

The orchestration layer should provide:

- typed work items and scenario DAGs;
- actor/role assignment;
- single-writer leases for mutable business objects;
- read-only observer roles for DB/log/network checks;
- typed messages: `CLAIM`, `CHECKPOINT`, `OBSERVATION`, `FINDING`, `BLOCKER`, `HANDOFF`, `DONE`;
- heartbeat and lease expiry;
- idempotency keys for every mutation command;
- barrier checkpoints between dependent roles;
- append-only evidence ledger;
- credential vault references rather than secrets in messages;
- deterministic cleanup even after agent failure;
- final report generation from evidence rather than one model's memory.

Suggested checkpoint payload:

```json
{
  "type": "CHECKPOINT",
  "runId": "run-...",
  "scenarioId": "task-review-cycle",
  "actor": "executor",
  "objectRef": "logical-test-object",
  "stateBefore": "in_progress",
  "stateAfter": "waiting_review",
  "operationId": "operation-...",
  "evidenceIds": ["artifact-..."],
  "nextActor": "reviewer"
}
```

BrowserMesh session `name`/metadata may carry neutral correlation labels, but must not become the
mailbox, source of authorization, or shared task database.

## 13. Delivery sequence

Implement in independently reviewable milestones:

1. Fix runtime version reporting and tests.
2. Implement and verify `BROWSERMESH_HEADLESS`.
3. Add `browser_runtime_info` and CLI `--doctor --json`.
4. Convert one representative tool to output schema/structured content, settle the pattern, then
   migrate the remaining tools.
5. Add deterministic wait conditions.
6. Add bounded console/page-error collectors.
7. Add bounded network metadata collectors and redaction.
8. Add bounded snapshots; introduce refs only with complete stale-ref semantics.
9. Add context options and high-value interactions.
10. Review and accept the artifact storage ADR before adding any
    HAR/trace/upload/download implementation; implementation remains a separate, explicitly scoped
    milestone.
11. Keep multi-agent coordination as a separate orchestration project.

Do not combine observability, artifacts, remote transport, leases, and orchestration in one release.

## 14. Required verification for every milestone

Follow the repository regression rule: reproduce, add a failing test, fix root cause, run targeted
tests, then full verification.

Minimum matrix:

- strict TypeScript/typecheck;
- lint and format check;
- unit contract/error/redaction/bounds tests;
- real Chromium integration against deterministic loopback servers;
- MCP in-process contract tests;
- MCP stdio subprocess tests;
- cross-session isolation and page-ID rejection;
- same-session ordering and queue recovery;
- different-session parallelism;
- close/shutdown/disconnect resource cleanup;
- stress tests for buffers, sessions, pages, and listeners;
- coverage thresholds;
- `npm pack` inspection;
- clean tarball installation;
- exact packaged `serverInfo.version` verification;
- packaged MCP discovery plus browser lifecycle smoke on Node 22 and 24;
- Windows package smoke and Linux real-browser CI.

Additional observability tests:

- console/network events cannot cross sessions;
- sensitive headers/query values/bodies never appear;
- event strings and responses are bounded;
- overflow reports dropped count;
- cursor pagination is stable;
- listeners are removed after page/context close;
- failed/timed-out waits do not poison queues;
- structured output validates against the advertised schema;
- tool annotations match actual read-only/destructive/idempotent/open-world behavior;
- cancelled waits/diagnostics release listeners and do not poison queues;
- screenshots and artifacts obey quotas and cleanup.

## 15. Definition of done for the improvement program

The program is complete only when:

- installed artifact and MCP runtime report the same exact version;
- headless/headed mode is explicit, validated, documented, and tested;
- a fresh user can run deterministic diagnostics without reading source code;
- agents can wait for UI/network state without sleeps;
- console, page errors, and failed HTTP metadata are safely observable;
- tool results use validated structured MCP output;
- large snapshots and event streams are bounded and paginated;
- session isolation remains intact under all new capabilities;
- no new secret, arbitrary filesystem, or raw Playwright exposure is introduced;
- all listeners, buffers, contexts, pages, processes, and artifacts are cleaned up;
- packed-package and fresh-environment verification pass;
- public docs, SPEC, architecture, ADRs, tool descriptions, and implementation status agree;
- external orchestration is clearly documented as separate from BrowserMesh runtime behavior.

## 16. Local operator follow-up

After the applicable source milestones are released:

1. install an exact stable package version rather than relying on a stale local installation;
2. run that installed version's documented Playwright browser-install command;
3. update the MCP command to the exact installed artifact;
4. restart the MCP client completely;
5. verify `serverInfo.version`, tool discovery, runtime info, diagnostic session create/close;
6. run multi-session isolation, cross-session page rejection, timeout recovery, and cleanup smoke;
7. do not save authentication state unless persistence is actually required;
8. remove test states and close every session after verification.

## 17. Standards references

Implementation decisions should be checked against the exact dependency versions in this
repository and current primary documentation:

- [MCP tools: structured content, output schemas, and annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP transports: stdio and Streamable HTTP](https://modelcontextprotocol.io/specification/draft/basic/transports)
- [Playwright BrowserContext isolation and events](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright test isolation](https://playwright.dev/docs/browser-contexts)
- [Playwright locator guidance](https://playwright.dev/docs/locators)
- [Playwright auto-waiting/actionability](https://playwright.dev/docs/actionability)
- [Playwright ARIA snapshots](https://playwright.dev/docs/aria-snapshots)

Do not copy an API from a newer Playwright/MCP draft without confirming compatibility with the
versions pinned in `package.json` and the protocol versions supported by the MCP SDK.

## 18. Severity summary

| ID              | Priority   | Finding                                                                                     | Classification                          |
| --------------- | ---------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| BM-VERSION-001  | P0         | MCP `serverInfo.version` is hard-coded to `0.1.0`                                           | Source defect                           |
| BM-CONFIG-001   | P1         | Local config assumes unsupported `BROWSERMESH_HEADLESS`; explicit headless mode is accepted | Integration gap / accepted feature      |
| BM-INSTALL-001  | Local only | Audit environment used a stale configured package                                           | Environment drift, not a project defect |
| BM-UX-001       | P0         | Results are JSON text rather than fully typed structured MCP output                         | MCP UX gap                              |
| BM-QA-OBS-001   | P0         | No console/page-error/network failure observation                                           | Capability gap                          |
| BM-WAIT-001     | P0         | No explicit deterministic wait primitive                                                    | Capability gap                          |
| BM-CANCEL-001   | P1         | Long operations have no verified end-to-end MCP cancellation contract                       | Resilience gap                          |
| BM-ANNOT-001    | P1         | Tools do not advertise/test complete MCP risk annotations                                   | MCP UX/risk gap                         |
| BM-SNAPSHOT-001 | P1         | Snapshot output lacks bounds/pagination/refs                                                | Efficiency gap                          |
| BM-CONTEXT-001  | P1         | Session context cannot configure viewport/locale/timezone/accessibility                     | Coverage gap                            |
| BM-ARTIFACT-001 | P1         | No controlled evidence/artifact lifecycle                                                   | QA evidence gap                         |
| BM-ORCH-001     | Separate   | No agent task board/mailbox/leases                                                          | Intentional external responsibility     |

Do not report `BM-ORCH-001` as a BrowserMesh v0.1 bug. It is a separate product/layer.
