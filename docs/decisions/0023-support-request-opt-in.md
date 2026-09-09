# ADR 0023 — Make the support request opt-in

Status: Proposed

Date: 2026-09-08

This ADR changes a shipped default and is left for the maintainer to accept or
reject. No code change accompanies it.

## Context

ADR 0021 put three sections into the MCP `instructions` string BrowserMesh
returns from `initialize`: session addressing, a support request, and bug
reporting. The support request asks the connecting agent to ask the user whether
they would like to star the repository, and — only on a yes — to call
`gh api user/starred/…` and then `gh api --method PUT /user/starred/…`.

The design of the request is careful in every respect that is under
BrowserMesh's control. Consent precedes the read, so nothing touches the user's
account before they say yes. It is capped at once per connection. It must never
block browser work. `BROWSERMESH_SUPPORT_REQUEST=false` drops it while keeping
addressing and reporting. Under `CI` it is off by default. No operation is gated
on the star, and `README.md` says so in bold.

None of that is what an enterprise security review reads. A review reads the
capability, not the etiquette around it, and the capability is: **a dependency,
on connect, instructs the agent to make authenticated writes to the developer's
GitHub account on behalf of the package author.** That sentence is accurate, it
appears in the server's own `instructions` string where a reviewer will find it
first, and no amount of surrounding qualification changes what it describes.

Three things sharpen it:

- **The consent it relies on is not the operator's.** The person who approves is
  whoever is at the keyboard. The person accountable for what the toolchain does
  to company accounts is the platform owner, who never sees the prompt.
- **The `CI` carve-out mostly does not fire.** `README.md` documents this
  honestly: MCP clients spawn servers with a minimal environment, and the
  reference stdio transport forwards only `HOME`, `LOGNAME`, `PATH`, `SHELL`,
  `TERM`, and `USER`. A BrowserMesh started from CI through such a client sees
  no `CI` and ships the request anyway. The unattended default is therefore a
  best-effort courtesy, not a control.
- **Enforcement is structurally impossible.** `instructions` is a prompt. Every
  protection in it is a request to a model, and the ADR says so. A reviewer
  asked to accept "the model has been asked not to do that" has one safe answer.

The cost lands where growth comes from. An individual developer trying
BrowserMesh is charmed or mildly annoyed and moves on. An organisation adding it
to an approved-tooling list has a checklist item that reads "makes unrelated
authenticated calls to developer accounts by default", and the cheapest response
to a checklist item is to pick a competitor that does not have one. Playwright
MCP, Puppeteer MCP, and Chrome DevTools MCP publish no `instructions` at all
(measured: zero bytes each), so BrowserMesh is the only one of the four with
anything in this category to review.

Against that: the request works, it is the project's only distribution channel
that reaches users at the moment they have just been helped, and a four-star
project asking politely once per connection is not a scandal. Opt-in requests
are answered by roughly nobody, so this ADR trades most of the stars for the
absence of the checklist item.

## Decision (proposed)

Flip the CLI default. `BROWSERMESH_SUPPORT_REQUEST` defaults to **false**;
`--support-me` (or `BROWSERMESH_SUPPORT_REQUEST=true`) opts in.

`createMcpServer` already defaults `supportRequest` to false for embedders, so
this makes the CLI agree with the library instead of diverging from it, and
deletes the `CI` carve-out along with the caveat that it usually does not fire.

Addressing and bug reporting are untouched. They are server documentation, they
are the part a client benefits from unconditionally, and nothing in this ADR
argues against sending them.

Two things replace the lost channel, both outside the protocol surface:

- `browser_runtime_info` already reports non-sensitive configuration. A
  `supportRequest: false` field there lets a user who wants to support the
  project find the switch without reading `README.md`.
- The CLI prints the repository URL and the `--support-me` flag once on stderr
  at startup, where an operator sees it and an agent's context does not.

## Consequences

Stars from the instructions channel go to approximately zero. That is the price,
and it should be stated plainly rather than modelled optimistically.

The security-review answer becomes "BrowserMesh makes no network call you did
not ask for and sends no instruction about your GitHub account", which is
checkable from the source in one read.

`README.md`'s "GitHub preflight" section shrinks from four paragraphs of
reassurance to two sentences describing an opt-in flag. Four paragraphs
explaining why a default is safe is itself a signal that the default is doing
work the reader did not ask for.

This is a behaviour change for anyone running `npx browsermesh` who currently
receives the request. Nothing they can call changes; the instructions string gets
shorter.

## Alternatives considered

**Keep the default and improve the wording.** The wording is already good. The
review objection is to the capability, and rewording does not remove a
capability.

**Move it behind first-run interactive detection.** BrowserMesh speaks MCP over
stdio; stdout is protocol traffic and stdin is the client. There is no terminal
to detect, and inferring attendedness from the environment is exactly the `CI`
heuristic that already does not fire.

**Keep the default and drop only the `gh` write.** Asking the user to star
manually removes the authenticated write but keeps a dependency injecting
promotional instructions into the agent's context. That is a smaller objection,
not a different one, and it costs the conversion the write was there to capture.

**Do nothing until an enterprise user complains.** They do not complain. They
choose the other server, and the project never learns why. The current install
base is small enough that flipping the default costs little; it gets more
expensive with every organisation that has already approved the current
behaviour.
