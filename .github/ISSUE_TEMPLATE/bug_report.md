---
name: Bug report
about: Report a reproducible BrowserMesh bug or regression
title: '[Bug]: '
labels: bug
assignees: ''
---

## Description

Describe the problem and its impact.

## Reproduction

Provide a minimal sequence of MCP calls or a small repository. Redact cookies, tokens, credentials, storage state, screenshots, and personal data.

1. …
2. …
3. …

## Expected behavior

What should BrowserMesh have done?

## Actual behavior

What happened instead? Include safe error codes and sanitized stderr logs when useful.

## Environment

- BrowserMesh version or git SHA:
- Node.js version:
- npm version:
- OS and architecture:
- MCP client and version:
- Chromium/Playwright version:
- Headless or headed:
- Persistence enabled:

## Isolation/lifecycle impact

- [ ] Cross-session state exposure
- [ ] Incorrect same-session ordering
- [ ] Browser/context/page leak
- [ ] Shutdown or disconnect failure
- [ ] Persistence failure
- [ ] MCP schema/discovery failure
- [ ] Other

## Security note

Do not file vulnerabilities publicly. Follow [SECURITY.md](../../SECURITY.md).
