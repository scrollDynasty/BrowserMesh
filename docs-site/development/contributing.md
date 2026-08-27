# Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](https://github.com/scrollDynasty/BrowserMesh/blob/master/CONTRIBUTING.md) and the repository's `AGENTS.md` before changing runtime behavior.

## Core review checklist

- every browser target stays explicit;
- a page cannot be used through another session;
- browser operations remain serialized per session, not globally;
- failed work does not poison a queue;
- resources and listeners are cleaned up on every lifecycle path;
- Playwright/MCP types stay at adapter boundaries;
- public errors remain stable, bounded, and secret-safe;
- tests and public documentation change with public behavior;
- no internal AI agent, mailbox, messaging, or reasoning runtime is introduced.

Use Conventional Commit style for PR titles, add regression coverage for defects, and run `npm run verify`. Run `npm run verify:package` when package/runtime behavior changes and `npm run docs:build` when documentation changes.
