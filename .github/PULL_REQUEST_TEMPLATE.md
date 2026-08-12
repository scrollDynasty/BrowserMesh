## Summary

What does this PR change and why?

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / maintenance
- [ ] Tests only
- [ ] CI / release automation

## BrowserMesh boundary

- [ ] Browser operations remain explicitly addressed by `sessionId` and `pageId`
- [ ] Domain/runtime code remains independent of Playwright and MCP adapters
- [ ] Isolation, per-session queueing, cleanup, and safe error contracts remain intact
- [ ] This change does not add internal AI Agent, mailbox, messaging, or orchestration concepts

## Checklist

- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] I ran `npm run verify`
- [ ] I ran `npm run verify:package` when package/runtime behavior changed
- [ ] I added or updated tests for behavior changes
- [ ] I updated README/docs for public API or architecture changes
- [ ] I committed `package-lock.json` when dependency metadata changed
- [ ] I did not add secrets, browser state, screenshots, or machine-specific paths
- [ ] I considered browser/context/page resource cleanup and race conditions
- [ ] The PR title follows Conventional Commits, for example `fix: recover queue after timeout`

## Testing evidence

List commands and important manual scenarios that passed.

## Related issues

Fixes #
