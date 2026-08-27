---
name: release
description: Cut or diagnose a BrowserMesh release - Release Please PR, protected tag, npm Trusted Publishing over OIDC, and MCP Registry publication. Use when preparing a release, reviewing a Release PR, investigating a failed publish, or asked why a version did not reach npm or the registry.
---

# Releasing BrowserMesh

## TODO — release is currently blocked on a maintainer action

**npm Trusted Publishing is not configured for the `browsermesh` package.** This is not a code
problem and no change in this repository fixes it.

- 0.2.0 could not publish over OIDC and was pushed by hand.
- `publish.yml` will fail the same way on the next version until a trusted publisher naming this
  repository, `publish.yml`, and the `npm` environment is added on npmjs.com.
- Because registry publication runs after `npm publish` in the same job, it has not run either. The
  MCP Registry's latest entry is still **0.1.5 pointing at the old `multi-agent-browser-mcp`
  name**.

Configuring the trusted publisher first lets the next release correct the registry on its own. Do
not work around this by publishing manually again without saying so — see
`docs/IMPLEMENTATION_STATUS.md`.

Also outstanding and maintainer-only: GitHub repository topics are unset.

## The chain

```text
Conventional Commit PR title
  → reviewed PR with green required checks
  → merge to master
  → release-please updates a Release PR
  → maintainer merges the Release PR
  → release-please creates the vX.Y.Z tag and GitHub Release
  → publish workflow verifies source and installed tarball
  → npm Trusted Publishing (OIDC)
  → MCP Registry publication (GitHub OIDC)
```

No ordinary push or feature PR publishes anything. Merging the Release PR is the only maintainer
gesture that starts a release.

## What bumps a version

`release-please-config.json` uses `release-type: node` with `bump-minor-pre-major` and
`bump-patch-for-minor-pre-major`. Pre-1.0, `feat` and `fix` both produce a patch. `chore`, `docs`,
`ci`, `test`, `build`, and `refactor` produce no release — use them for tooling changes that should
not cut a version.

PR titles are validated against `feat fix docs refactor perf test build ci chore revert`, and the
subject must start lowercase.

## Version consistency

Four places carry the version and must agree: `package.json`, both version fields in `server.json`,
and the generated `src/infrastructure/generated/version.ts`. Release Please updates all of them via
`extra-files`. `npm run check:version` fails on drift and runs as `pretypecheck`, so a stale
generated module turns typecheck red before anything is type-checked.

Installed-package verification additionally requires the MCP `serverInfo.version` handshake to
equal the installed manifest and the registry manifest.

## Before proposing a release

```sh
npm run verify
npm run verify:package
```

`verify:package` respects `BROWSERMESH_HEADLESS`; CI runs it headed under Xvfb on Linux and
headless on Windows.

## Verifying a published version

```sh
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
npm view "browsermesh@$PACKAGE_VERSION" version dist-tags --json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.scrollDynasty/browsermesh"
npx -y "browsermesh@$PACKAGE_VERSION"
```

The last command stays running because it is an stdio server. Stop it by closing the client; that
is not a hang.

## A failed publication

Never delete, move, or retag a release to hide a failure, and never `npm unpublish`. npm versions
are immutable.

1. Fix the workflow or package problem through a normal PR.
2. Let release-please prepare a new patch version.
3. Merge the new Release PR and publish the new immutable version.

## Requires explicit maintainer authorisation

Never perform these autonomously: the first npm bootstrap publication, merging a Release PR,
changing dist-tags, deprecating or unpublishing, rotating release credentials, or changing
protected-branch or environment policy.

## Reference

`docs/releasing.md` for the full one-time GitHub and npm setup, including branch rulesets, the
`RELEASE_PLEASE_TOKEN` fine-grained PAT, CodeQL, and Dependabot.
