---
name: write-adr
description: Write an architecture decision record for BrowserMesh in docs/decisions/. Use when a change alters a public contract, a runtime invariant, the dependency direction, the published tool surface, or rejects a plausible alternative - and when ADR 0012 requires a design before code is written.
---

# Writing an ADR

ADR 0012 requires a controlled design before code for anything that changes a contract or an
invariant. The ADR is that design, not a retrospective write-up.

## Format

Follow ADR 0019 and 0020. They are the current form; the eighteen earlier files use two older
layouts and are **not** the template. Do not retrofit them.

```markdown
# ADR NNNN — Title in sentence case

Status: accepted

Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```

- Filename: `docs/decisions/NNNN-kebab-case-title.md`, `NNNN` zero-padded, next unused number.
- Em dash after the number, not a colon.
- `Status: accepted` lowercase — also `proposed`, `superseded by ADR NNNN`.
- Sentence case in the title. No trailing period.

## What each section carries

**Context.** The measured problem, not the wish. State numbers where numbers exist: byte sizes,
test counts, timings, the version something was observed against. ADR 0020 opens with
"`tools/list` was 134,839 bytes, 7.3× the official Playwright MCP server" — that is the standard.
Name the constraint that rules options out; for BrowserMesh that is often a SPEC clause.

**Decision.** What is now true, in the present tense. Include what was rejected and why, especially
the option a reader would otherwise propose. If a check lives in one layer rather than another, say
which and why — ADR 0020 explains that an input-schema rejection names the offending field while a
`BrowserMeshError` would surface as an uninformative `INVALID_ARGUMENT`.

**Consequences.** What this costs, what it forecloses, what now has to stay true. A consequence
section that only lists benefits is unfinished.

## Rules

- One decision per ADR. A second decision is a second file.
- An accepted ADR is not edited to reflect a later change of mind. Write a new ADR and set the old
  one to `superseded by ADR NNNN`.
- The ADR outranks `README.md` and the docs site but is outranked by `docs/SPEC.md` and
  `docs/architecture.md` — see the source-of-truth order in `CLAUDE.md`. If the ADR contradicts the
  SPEC, one of them is wrong; resolve it before merging.
- Update `docs/architecture.md` and any affected public tool description in the same change. Docs
  and implementation must not diverge silently.
- `docs/decisions/` is not in `.prettierignore`, so run `npm run format` before committing.
