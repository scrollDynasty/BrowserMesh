# ADR 0021 — Agent guidelines travel as MCP server instructions

Status: accepted

Date: 2026-09-07

## Context

BrowserMesh wants two things from the agents that drive it: that they address sessions explicitly
rather than assuming a current one, and that a BrowserMesh bug reaches the issue tracker as a
searchable report rather than as a retry. A first attempt wrote both into `AGENTS.md` and
`.github/AGENT_GUIDELINES.md`.

That delivery does not work, and the measurement is unambiguous. `package.json` `files` is
`["dist", "README.md", "CHANGELOG.md", "LICENSE", "NOTICE"]`; `npm pack --dry-run` produces 153
files, of which exactly two are Markdown — `README.md` and `CHANGELOG.md`. Neither agent file is in
the tarball. An MCP client also does not read the source repository of a server it connects to: it
loads `AGENTS.md`/`CLAUDE.md` from the _user's_ working directory. So the audience those files
actually reach is agents working inside this repository, where `.mcp.json` already configures a
`browsermesh` server — contributors, not consumers.

The MCP protocol has a channel for exactly this. `ServerOptions.instructions` is returned in the
`initialize` result and surfaced to the model by the client, which is the one place a server can
speak to a consuming agent before the first tool call.

Two constraints bound what may go through it. It is sent to every client on every connect, so it
competes with the user's own context: `tools/list` is 87,367 bytes after ADR 0020, and instructions
should not be a meaningful fraction of that. And it is published in the package, so anything it asks
for is asked of every installation — which rules out anything that could cost a user the work they
came for.

## Decision

`createMcpServer` passes an `agentGuidelines()` string as `instructions`. It is 2,987 bytes, 3.4% of
the published tool surface, and lives in `src/adapters/mcp/agent-guidelines.ts` as four plain
constants with no runtime inputs.

It carries three things: the explicit-addressing rule and when to open a separate session; a request
to star the open-source repository; and how to report a BrowserMesh bug.

**The support request cannot cost the user anything.** This is the part that justifies the rest of
the design. The text states that the check must never block, delay, or gate browser work; that a
decline, a missing `gh`, an unavailable GitHub, or a failed check all mean _continue the user's task
immediately_; that the question is asked at most once and dropped afterwards; and that the
repository is starred only after the user explicitly authorizes it. Star state is read strictly —
`204` starred, `404` not starred, anything else unknown — and an error is never reported as "not
starred". Substituting another account or token, or working around missing authentication, is
excluded.

**The library default is conservative; the CLI applies the policy.** `createMcpServer` and
`agentGuidelines` are both public API, so both default `supportRequest` to `false`. An embedder that
upgrades BrowserMesh must not begin asking its own users for GitHub stars because a dependency
bumped, and the `CI` carve-out cannot help it: that lives in `loadConfig`, which an embedder building
its own options never calls. `cli.ts` opts in from configuration, so `npx browsermesh` is unchanged.
`McpServerOptions` is re-exported from `src/index.ts` so an embedder can name the option at all.

The two defaults are deliberately asymmetric, and the asymmetry is the decision. `agentGuidelines`
stays `true`, so an existing `createMcpServer(runtime)` caller does begin emitting roughly a kilobyte
of prompt content on upgrade without changing a line — accepted because that content is server
documentation about BrowserMesh's own contracts, and because the explicit-addressing rule is the one
thing no per-tool description can establish. `supportRequest` is not documentation and does not get
the same latitude.

**The two halves switch independently, because they differ in kind.** The addressing and reporting
guidance is server documentation with no side effects. The support request is not: it asks the agent
to spend the user's GitHub credentials on `gh api user/starred/...` and to offer an account-mutating
`PUT`, for work unrelated to the browser task at hand. Coupling them would mean the only way to
decline the ask is to lose the documentation.

So `BROWSERMESH_SUPPORT_REQUEST=false` drops the support section and keeps everything else, leaving
1,116 bytes; `BROWSERMESH_AGENT_GUIDELINES=false` sends no instructions at all. Both default to `true`
in an attended run
— shipping the request enabled is a deliberate choice by the project owner, and it is defensible only
because of the guarantees above. `createMcpServer` takes `supportRequest` and `agentGuidelines`
directly, and `--no-support-request` / `--no-agent-guidelines` match the existing boolean opt-outs in
`cli-arguments.ts`.

**The ordering rule ships with the text.** "Never blocking" is a claim; "never before the user's
first browser operation" is the mechanism that makes it true, and it lived only in `AGENTS.md`, which
this same ADR establishes is never delivered to a consumer. A client acting on `instructions` at
`initialize` could fire a permission-prompted `gh` call ahead of the first `browser_*` call — the
exact delay the text forbids. The bullet is now in the string, alongside a second one: skip the check
entirely if running it would prompt the user, since an interruption costs more than the answer is
worth. That is the closest the text gets to consent for the read, which is otherwise ungated where
the `PUT` is not.

**The check is bounded per connection, not per task.** `instructions` arrives once per `initialize`,
so a bound of "once per task" left a long-lived stdio session issuing one authenticated GitHub call
per task for the life of the connection. Only the _ask_ was ever capped; the _check_ was not.

**Under `CI`, the support request defaults to off.** The text tells the agent to skip the ask in
unattended runs, and that promise is otherwise prose in a prompt with nothing behind it: no test can
assert a model honoured it. `config.ts` is the one place allowed to read the environment, so it makes
the promise a default instead — `supportRequest` is `false` when `CI` is set to anything but `false`
or `0`, and an explicit `BROWSERMESH_SUPPORT_REQUEST` wins either way. The carve-out lives at the configuration layer, so it applies to the
server as consumers run it — via the CLI — while `createMcpServer` itself stays environment-free for
embedders, who pass the booleans they want. `tests/integration/agent-guidelines.test.ts` asserts the
seam between the two, which is what the claim in the shipped text actually rests on. This default is best-effort, not a guarantee, and the difference matters: an MCP client spawns the
server as a child process and commonly passes a minimal environment — the reference stdio transport
forwards only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, and `USER` — so a run under CI that reaches
BrowserMesh through such a client sees no `CI` at all. `tests/integration/stdio.test.ts` has to pin
`CI` explicitly for exactly that reason. Where it matters, `BROWSERMESH_SUPPORT_REQUEST=false` is the
control that does not depend on the client. `CI` is the only unattended signal a stdio server
actually has — there is no interactivity to probe — so the text claims exactly
that and asks the agent to skip the request itself in the headless, batch, and cron runs BrowserMesh
cannot see. This is the case where the ask
has no upside at all: there is nobody to answer it. The addressing and reporting guidance is
unaffected and still ships.

Each flag is named in every variant that ships, and says accurately what it removes. Naming
`BROWSERMESH_AGENT_GUIDELINES` only inside the support section would have hidden it exactly where it
is most needed: the lean variant is what `CI` and `--no-support-request` produce, and it still
arrives unsolicited on every connect. That
matters more than it looks: the instructions are the only place a consumer learns the flags exist, so
a section claiming to drop only itself while actually suppressing everything would cost a user the
addressing rule they wanted to keep.

The addressing rule is in the same string rather than left to tool descriptions because it is the
one thing a tool description cannot establish: each description explains its own tool, and no single
one can say that there is no current session anywhere in the server.

Nothing enforces any of this. The instructions are a request an agent may ignore, and BrowserMesh
publishes the same tools, accepts the same calls, and returns the same results whether the agent
read them or not. A version of this that gated tools on a star check was rejected outright: it would
make a promotional ask into an access-control mechanism, which the runtime has no business doing.

## Consequences

Every client now receives 2,987 bytes it did not before, on every connect, or 1,116 with the support
request declined. The text began at 2,459 and grew through review: naming internal URLs and hostnames
in the redaction list, shipping the ordering rule that makes the non-blocking claim true, telling the
agent to skip a check that would cost a permission prompt, and replacing a CI guarantee the shipping
path cannot keep with an accurate statement of what is detectable. The budget was raised from 2,500
to 3,500 to match, deliberately and once — a ceiling held a few bytes above the text stops guarding
against a new section and starts failing on ordinary wording fixes. That is the recurring cost, it is paid by workflows that never needed the guidance,
and it is why the size is asserted in `tests/unit/agent-guidelines.test.ts` — in bytes, since the em
dashes make `.length` report a different number than what travels on the wire. The ceiling is set to
catch a new section rather than a rephrasing: held a few bytes above the current text it fails on
every wording fix, which is churn, not a guard.

The string also names no tool. `browser_runtime_info` reports the version a bug report needs, but it
is in the `core` profile only, while these instructions ship regardless of `BROWSERMESH_TOOLS` — so
naming it would point a client running `--tools observability` at something it cannot see.

The support request ships enabled by default, and that carries a specific risk worth naming rather
than discovering later. A server whose `instructions` tell an agent to run shell commands against the
user's authenticated GitHub account is structurally similar to the prompt-injection and
tool-poisoning pattern that MCP scanners and client policies flag; the classification does not depend
on intent, and it would apply to the whole package, addressing rule included. Every guarantee that
makes the ask defensible is prose in a prompt: the tests assert the phrases are present, and no test
can assert that a client model obeys them. The default is therefore the only control this project
actually holds over the behaviour, and it is spent deliberately. Defaulting the request to `false`
was considered and rejected by the project owner; `BROWSERMESH_SUPPORT_REQUEST=false` remains the
one-word reversal if that judgement changes.

Publishing a support request from inside a package is a reputational position, not a neutral one. It
is defensible only while every guarantee above holds, so those guarantees are now contract: the
non-blocking wording, the authorization requirement, the single ask, the strict status reading, and
both opt-outs each have a test asserting the exact phrase. Those tests live in `tests/unit/` so that
weakening one fails `npm test` and `verify:fast`, the documented inner loop — a guarantee asserted
only under full `verify` is one an edit can pass through.

The opt-outs are asserted end to end through the real CLI in `tests/integration/stdio.test.ts`, not
only against `createMcpServer` and `loadConfig`. Deleting either wiring line in `cli.ts` otherwise
leaves the suite green while a documented opt-out stops working; both deletions now fail. That costs
three subprocess spawns — one baseline and one per line — and no more: the `CI` carve-out is
`loadConfig` behaviour and is asserted without a subprocess.

`BROWSERMESH_AGENT_GUIDELINES` and `BROWSERMESH_SUPPORT_REQUEST` are new public configuration
variables and join the documented list in `README.md` and the CLI reference.
`browser_runtime_info` reports neither: the tool reports what bounds browser work, and these bound
nothing.

The guidance now has two homes with different jobs. `AGENTS.md` and `.github/AGENT_GUIDELINES.md`
address agents working _in this repository_ and stay long; `AGENT_GUIDELINES` addresses agents
_using_ the server and stays short. They can drift, and the repository files are the ones that must
not claim consumers see them.

## Alternatives considered

**Add `AGENTS.md` to `package.json` `files`.** It puts the file in the tarball and changes nothing:
the agent reads `AGENTS.md` from the user's working directory, never from
`node_modules/browsermesh/`. This alternative is worth naming because it looks like the obvious fix
and is not one.

**Put the guidance in tool descriptions.** They reach the model reliably, but the text would repeat
across 35 contracts after ADR 0020 spent the effort to remove exactly that kind of duplication, and
a tool description that argues for starring a repository is no longer describing its tool.

**An MCP prompt.** `parallel_roles` and `diagnose_page` show the shape, but a prompt is offered and
must be chosen. Guidance that matters before the first tool call cannot wait for a client to pick it
from a menu.

**Say nothing to consumers.** Coherent, and it forecloses the addressing guidance too — the part
with no promotional content, which prevents a real and repeated failure. Rejected for that reason
rather than for the support request.
