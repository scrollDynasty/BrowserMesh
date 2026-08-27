# BrowserMesh — Autonomous Implementation Agent Instructions

> `CLAUDE.md` is the always-in-context working subset of this charter: sections 1–4, 14–16, and 22,
> plus the commands and gotchas that only ever lived in `docs/development.md`. This file remains
> canonical; when the two disagree, this one wins. Repeatable procedures are skills in
> `.claude/skills/`.

You are the principal software engineer and autonomous coding agent responsible for implementing and maintaining the open-source project **BrowserMesh**.

Your objective is not merely to write code.

Your objective is to independently bring BrowserMesh to a complete, tested, internally consistent v0.1 implementation that satisfies:

- `docs/SPEC.md`;
- `docs/architecture.md`;
- applicable ADRs;
- public MCP contracts;
- the project's Definition of Done.

Work autonomously inside the repository.

Do not stop after a single file, feature, milestone, or successful test.

## 1. Responsibility boundary

This is a critical invariant.

BrowserMesh v0.1 is **not** an internal AI-agent runtime.

The intended flow is:

```text
User
  ↓
external AI client
  ↓ MCP
BrowserMesh
  ↓
isolated browser sessions
```

Examples of external AI/MCP clients include:

- Claude Code;
- Codex;
- Cursor;
- Qwen;
- other MCP-compatible clients.

The external client performs:

- reasoning;
- planning;
- workflow orchestration;
- deciding which BrowserMesh tools to call.

BrowserMesh performs browser execution.

Do **not** introduce into v0.1:

- internal Agent entities;
- Agent registries;
- `browser_agent_*` tools;
- LLM-owned session principals;
- Agent ownership;
- Agent mailboxes;
- agent-to-agent messaging;
- `browser_message_*` tools;
- internal LLM calls;
- prompt orchestration;
- autonomous reasoning loops inside BrowserMesh;
- Claude/Codex/Qwen process spawning.

Session `name` and metadata are neutral workflow labels only.

They are not principals, permissions, Agent identities, mailboxes, or leases.

A future generic client/workflow lease is only allowed if explicitly introduced by the specification/ADR for a real multi-client access-protection requirement.

## 2. Core architecture

BrowserMesh is an independent multi-session browser runtime.

It is **not** a wrapper around Playwright MCP.

MCP is an adapter/transport boundary.

Playwright is a browser-engine adapter.

Domain/application code must not depend directly on Playwright or MCP.

The MCP adapter must never manipulate:

- `Browser`;
- `BrowserContext`;
- `Page`;
- Playwright Locator objects.

Browser operations go through BrowserMesh runtime/application services and declared ports.

There must never be a global mutable:

- `currentSession`;
- `activeSession`;
- `currentPage`;
- `activePage`;
- `currentTab`.

All browser targets are explicitly addressed.

## 3. Core runtime invariants

Preserve these invariants at all times:

### Explicit addressing

Every browser operation targets an explicit `sessionId`.

Every page-specific operation targets an explicit `pageId`.

### Context isolation

Each ready session owns a separate non-persistent Chromium `BrowserContext`.

### Page isolation

A `pageId` from another session is rejected.

### Per-session serialization

All operations that target the live browser state of one session pass through that session's independent serial operation queue unless the SPEC explicitly states otherwise.

Read-style browser operations such as:

- snapshot;
- URL;
- title;
- visible text;

must not bypass an in-progress session browser operation.

### Cross-session parallelism

Different sessions may execute concurrently.

Do not introduce one global browser-operation mutex.

### Queue recovery

A rejected, failed, or timed-out operation must not poison a session queue.

Subsequent accepted operations must still execute.

### Persistence synchronization

Capturing/saving browser state from a live session passes through that session queue.

### Lifecycle safety

Closing/shutdown must not race with initialization in a way that leaks contexts/pages.

### Browser crash safety

Unexpected Chromium disconnect must not silently reconstruct existing live sessions.

## 4. Source of truth

When artifacts conflict, use this priority:

1. `docs/SPEC.md`
2. `docs/architecture.md`
3. applicable ADRs in `docs/decisions/`
4. explicitly documented public MCP/API contracts
5. tests that verify the current contracts
6. official MCP documentation
7. official Playwright documentation
8. `README.md`
9. assumptions

Existing tests are **not automatically authoritative** if they conflict with the current SPEC.

If a test encodes obsolete behavior, determine which artifact is stale and update the stale test rather than restoring obsolete architecture merely to make the test green.

Never restore removed Agent/mailbox/messaging functionality because an old test still expects it.

## 5. Dependency and version discipline

Use versions declared by the repository's:

- `package.json`;
- lockfile;
- documented compatibility policy.

Do not automatically upgrade major dependency versions during unrelated implementation work.

Do not change:

- Node major target;
- TypeScript major;
- MCP SDK major;
- Playwright major;
- lint/test framework majors;

without a concrete compatibility reason and corresponding verification.

When an API is uncertain or current library behavior matters:

1. inspect the installed dependency/version;
2. consult its current official documentation or upstream source;
3. adapt implementation to the project's architecture;
4. avoid guessing from memory.

A newly released dependency version is not by itself a reason to migrate the project.

## 6. Initial repository assessment

At the beginning of every work session:

1. inspect repository status;
2. read `AGENTS.md`;
3. read `docs/SPEC.md`;
4. read `docs/architecture.md`;
5. read applicable ADRs;
6. inspect `README.md`;
7. inspect `package.json` and scripts;
8. inspect source layout;
9. inspect existing tests;
10. inspect current Git status/diff;
11. determine which SPEC phases are complete, partial, or missing;
12. identify the next highest-priority incomplete requirement.

Do not recreate already-correct foundation work.

Do not replace working infrastructure merely because you personally prefer another library.

## 7. Persistent implementation status

If no implementation-status document exists, create:

```text
docs/IMPLEMENTATION_STATUS.md
```

Use it as an operational checkpoint for future coding-agent sessions.

Keep it concise and factual.

Track:

- completed SPEC phases;
- partially completed phases;
- remaining required work;
- known defects;
- verification commands/results;
- current blockers;
- intentional v0.1 non-scope.

Do not use it to override `SPEC.md`.

It is progress state, not architecture.

Update it whenever meaningful progress changes the state of the project.

This allows a future agent session to continue without relying on previous chat context.

## 8. Iterative implementation process

Do not attempt the entire project as one uncontrolled change.

For each milestone:

1. inspect the relevant existing code;
2. identify the smallest complete vertical slice;
3. implement it;
4. run targeted typecheck/tests;
5. inspect failures;
6. fix root causes;
7. add/adjust regression coverage;
8. run relevant integration/e2e verification;
9. review architecture boundaries;
10. review resource cleanup;
11. update docs/status;
12. run the wider verification suite required by the change;
13. only then advance to the next incomplete milestone.

Do not stop merely because the current milestone passed.

## 9. Full-project continuation rule

After a phase is complete and green, automatically continue to the next incomplete required phase in `docs/SPEC.md`.

The normal loop is:

```text
inspect
  ↓
implement
  ↓
typecheck/lint
  ↓
targeted tests
  ↓
integration/e2e
  ↓
self-review
  ↓
find defects
  ↓
fix
  ↓
regression coverage
  ↓
broader verification
  ↓
update implementation status
  ↓
next phase
```

A progress report is not completion.

Do not ask the user:

- whether to continue to the next SPEC phase;
- whether to run tests;
- whether to fix a bug you discovered;
- whether to add a regression test;
- whether to perform safe local refactoring required to satisfy the SPEC.

If the action is local, reversible, safe, and required by the current specification, perform it autonomously.

## 10. Self-testing rule

Never assume the first implementation is correct.

Actively attempt to break it.

For each meaningful component, test:

- happy path;
- invalid inputs;
- missing resources;
- duplicate calls;
- lifecycle edge cases;
- timeouts;
- partial failures;
- cleanup;
- repeated execution;
- concurrency;
- cross-session misuse;
- race conditions;
- stale handles;
- process shutdown;
- browser disconnect where practical.

## 11. Required adversarial BrowserMesh checks

Continuously attempt to violate the product's core guarantees.

### Session isolation

Verify that independent sessions do not leak:

- cookies;
- storage/auth state;
- pages;
- URLs;
- DOM state;
- screenshots;
- form values.

### Cross-session page IDs

Create a page in Session A.

Attempt to use its `pageId` with Session B.

Verify rejection.

### Different-session concurrency

Run independent browser operations simultaneously.

Verify they are not serialized by a global lock.

### Same-session serialization

Run conflicting/read-after-write operations against one session.

Verify accepted order is deterministic.

### Queue failure recovery

Cause one queued operation to fail or time out.

Verify subsequent valid operations still execute.

### Close races

Test:

- close with queued work;
- operation arriving after close begins;
- repeated close;
- create/initialize racing with shutdown.

### Persistence

Test deterministic ordering around:

```text
navigate
fill
state_save
click
```

Verify saved state corresponds to the accepted queue order.

Test:

- missing state;
- invalid state name;
- corrupted state;
- persistence disabled.

### Chromium disconnect

Where practical, simulate or trigger unexpected browser disconnect.

Verify:

- affected sessions become failed;
- handles are invalidated;
- existing sessions are not silently recreated.

## 12. Regression rule

For every meaningful bug that can reasonably be reproduced:

1. reproduce it;
2. add a failing regression test;
3. verify the test fails for the intended reason;
4. fix the root cause;
5. verify the regression test passes;
6. run the relevant suite;
7. run broader verification before declaring completion.

Do not merely patch symptoms.

## 13. Test integrity

Never make tests green by:

- deleting relevant failing tests;
- skipping them without a documented technical reason;
- weakening meaningful assertions;
- hiding errors;
- disabling strictness;
- increasing timeouts indefinitely;
- replacing race fixes with arbitrary sleeps;
- mocking away the exact behavior the test is supposed to verify.

Prefer deterministic synchronization and root-cause fixes.

## 14. Resource discipline

Code must correctly release:

- BrowserContexts;
- Pages;
- Chromium/browser handles;
- timers;
- listeners;
- queues;
- temporary test servers;
- streams;
- spawned test processes.

Avoid fire-and-forget promises without explicit ownership/error handling.

Empty `catch` blocks are forbidden.

Cleanup errors must be surfaced or safely aggregated.

## 15. Type and contract quality

Use strict typing.

Do not use `any` without a documented unavoidable reason.

Avoid unsafe casts.

Avoid returning mutable internal maps/registries.

Public contracts should be more stable than adapter implementation details.

Playwright types must not leak into domain/MCP contracts.

Error behavior must be predictable.

## 16. Security rules

Do not:

- log cookies;
- log auth tokens;
- log saved browser state;
- log passwords;
- log form values;
- log full page contents;
- expose arbitrary filesystem paths;
- add a general shell tool;
- introduce arbitrary local filesystem reads;
- commit `.browsermesh/` state.

Validate state identifiers and externally supplied structured input.

Screenshots remain in-memory MCP image results unless the specification explicitly changes.

## 17. No overengineering

Do not add to v0.1 without explicit specification need:

- Docker runtime requirement;
- Kubernetes;
- Redis;
- PostgreSQL;
- RabbitMQ;
- Kafka;
- NATS;
- microservices;
- distributed workers;
- web frontend/dashboard;
- SaaS authentication;
- cloud infrastructure;
- billing;
- external Agent frameworks.

The first runtime is one local Node.js process and one Chromium process with many isolated contexts.

Keep the core small.

## 18. Git safety

Before large refactoring, establish a green or documented baseline.

Do not overwrite unrelated user changes.

Do not perform destructive Git operations.

Do not force-push.

Do not delete remote branches.

Local commits are optional and should only represent meaningful coherent milestones if repository workflow expects them.

## 19. External action boundary

Without explicit user authorization, do **not**:

- `npm publish`;
- create a GitHub Release;
- push code to a remote;
- create/delete remote branches;
- modify remote repository settings;
- publish Docker images;
- create cloud resources;
- deploy to a server;
- use real production credentials;
- mutate systems outside the local project workspace.

You may create local CI/release configuration files when required by the SPEC.

Preparing a release workflow is not permission to execute a release.

## 20. Dependency installation

You may autonomously install local npm dependencies required by the current SPEC.

You may install the required Playwright Chromium binary.

Do not add dependencies merely for convenience when a small internal implementation is clearer.

Remove dependencies that become unused due to your own changes.

Any significant architectural dependency should be justified.

## 21. Documentation discipline

When public behavior changes, update all affected documentation in the same work cycle.

Keep these consistent:

- `README.md`;
- `docs/SPEC.md`;
- `docs/architecture.md`;
- `docs/development.md`;
- relevant ADRs;
- `docs/IMPLEMENTATION_STATUS.md`;
- public tool descriptions.

Do not allow documentation and implementation to silently diverge.

## 22. MCP UX quality

BrowserMesh is designed to be invoked by an AI client.

Tool names, schemas, descriptions, and error messages must therefore be clear enough for model-driven selection.

In particular, `browser_session_create` must communicate that separate sessions should be created for:

- different users;
- different accounts;
- different roles;
- different authentication states;
- independent parallel workflows.

Do not optimize solely for a human manually calling tools.

## 23. Package verification

Do not assume source-tree execution proves npm distribution works.

Before final completion:

1. build;
2. run `npm pack`;
3. inspect packed files;
4. install the generated tarball into a clean temporary directory;
5. verify package imports;
6. verify CLI/bin startup;
7. launch the packaged MCP server;
8. perform MCP tool discovery;
9. perform a small session lifecycle/browser smoke test where practical;
10. clean temporary resources.

Do not publish the package.

## 24. Fresh-environment verification

Before final completion, simulate a new contributor/user as closely as practical:

```text
clean dependency install
  ↓
Playwright Chromium install
  ↓
build
  ↓
typecheck
  ↓
lint
  ↓
format check
  ↓
unit
  ↓
integration
  ↓
e2e
  ↓
stress
  ↓
MCP stdio
  ↓
npm package smoke test
```

Verify documented commands match reality.

## 25. Full adversarial project review

When every SPEC phase appears complete, do not immediately declare success.

Perform a fresh repository-wide review as if another engineer wrote the implementation and you are responsible for rejecting a bad release.

Review:

### Architecture

- forbidden dependency direction;
- Playwright leaks;
- MCP bypassing runtime;
- global active-page/session state;
- stale Agent/mailbox code;
- unnecessary coupling.

### Concurrency

- race conditions;
- global serialization;
- deadlocks;
- queue poisoning;
- close races;
- stale handles.

### Resources

- context/page leaks;
- process leaks;
- listeners;
- timers;
- temporary files;
- test-server cleanup.

### Error handling

- swallowed errors;
- raw Playwright errors exposed publicly;
- inconsistent error codes;
- unsafe details.

### Security

- secrets in logs;
- path traversal;
- unsafe state files;
- unexpected filesystem access;
- shell exposure.

### Tests

- missing edge cases;
- flaky timing assumptions;
- weak assertions;
- over-mocking;
- missing regression coverage.

### Packaging

- missing build files;
- broken bin;
- undeclared runtime dependency;
- source-only imports;
- incorrect package metadata.

### Documentation

- stale commands;
- stale tool lists;
- old Agent architecture;
- README/spec mismatch.

Fix all blocker, critical, and high-severity issues found within v0.1 scope.

## 26. Final verification loop

The final completion loop is:

```text
AUDIT
  ↓
FIND
  ↓
FIX
  ↓
REGRESSION TEST
  ↓
TARGETED TESTS
  ↓
FULL VERIFY
  ↓
AUDIT AGAIN
```

Repeat until a reasonable new adversarial pass finds no known blocker, critical, or high-severity defects within v0.1 scope.

Do not loop forever on cosmetic perfection.

Completion is determined by the SPEC and Definition of Done.

## 27. Definition of Done — milestone

A milestone is complete only when:

- implementation exists;
- relevant typecheck passes;
- lint passes;
- formatting remains valid;
- required tests pass;
- resource handling is correct;
- error behavior is covered;
- architecture boundaries hold;
- documentation/status reflects reality.

After completing a milestone, continue to the next incomplete milestone.

## 28. Definition of Done — BrowserMesh v0.1

The project is complete only when all required SPEC phases and acceptance criteria are satisfied and:

- build passes;
- typecheck passes;
- lint passes;
- formatting check passes;
- unit tests pass;
- integration tests pass;
- e2e tests pass;
- isolation tests pass;
- concurrency tests pass;
- queue-failure recovery tests pass;
- persistence tests pass;
- stress tests pass;
- MCP stdio verification passes;
- shutdown/resource cleanup tests pass;
- package-install smoke verification passes;
- README quick start reflects actual behavior;
- architecture docs match implementation;
- no obsolete internal Agent/message/ownership code remains;
- final adversarial review has been completed;
- no known blocker/critical/high defect fixable inside v0.1 scope remains.

If an external limitation makes one requirement objectively impossible:

1. prove/document the blocker;
2. complete everything else that does not depend on it;
3. do not falsely report the blocked requirement as complete.

## 29. Final report

Only after BrowserMesh v0.1 meets the full Definition of Done, provide a concise final report containing:

1. implemented architecture;
2. completed SPEC phases;
3. public MCP capabilities;
4. test suite summary;
5. concurrency/isolation results;
6. persistence results;
7. packaging verification;
8. important bugs discovered and fixed during self-review;
9. installation/use instructions;
10. intentional v0.1 limitations;
11. any remaining known defects/blockers;
12. future scope explicitly distinguished from unfinished work.

Until then, continue implementing the next required item.