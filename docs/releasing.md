# BrowserMesh release automation

BrowserMesh follows the same release model as `scrollDynasty/react-native-drum-picker`, adapted for npm, MCP, Playwright Chromium, and the repository's `master` branch.

## Release chain

```text
Conventional Commit PR title
  → reviewed PR with green required checks
  → merge to master
  → release-please updates a Release PR
  → maintainer merges Release PR
  → release-please creates vX.Y.Z tag and GitHub Release
  → publish workflow verifies source and installed tarball
  → npm Trusted Publishing (OIDC)
```

No ordinary push or feature PR publishes to npm.

BrowserMesh is promoting the manually published `0.1.0-beta.0` package to the stable `0.1.0`
release. A one-time `Release-As: 0.1.0` commit selects that exact stable version. Subsequent
versions follow the repository's normal Conventional Commit and pre-1.0 SemVer policy.

The publish workflow sends prerelease versions to the npm `beta` dist-tag and stable versions to
`latest`; the stable promotion therefore becomes the default version installed by npm users.

The initial `bootstrap-sha` records the source boundary of the manually published
`0.1.0-beta.0` package so the first automated changelog does not repeat the entire repository
history. Remove this one-time bootstrap setting in the first normal PR after the first automated
Release PR is merged and tagged.

## One-time GitHub setup

### 1. Default branch and branch protection

Keep `master` as the default branch, or update every workflow/config/document consistently before renaming it.

Create a branch ruleset for `master`:

- require pull requests before merging;
- require at least one approval;
- dismiss stale approvals after new commits;
- require conversation resolution;
- require branches to be up to date or enable merge queue;
- require signed commits if that matches maintainer policy;
- block force pushes and deletions;
- require these stable checks:
  - `all-checks-passed`;
  - `conventional-title`;
  - CodeQL analysis checks.

The aggregate `all-checks-passed` job depends on static, Node 22/24, browser, stress, and package jobs, so the ruleset does not need to change when the internal matrix evolves.

### 2. release-please token

Create a fine-grained personal access token that can access this repository and create/update pull requests, contents, tags, and releases. Store it as the Actions secret `RELEASE_PLEASE_TOKEN`.

Until this secret exists, the `release-please` workflow exits successfully with an informational notice and does not create a Release PR. This keeps normal CI green while the repository is being configured.

A separate token is intentional: GitHub suppresses workflow events caused by the built-in `GITHUB_TOKEN`. The PAT allows CI to run on release PRs and allows the release-created tag to trigger `publish.yml`.

Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** if repository policy requires it.

### 3. npm bootstrap and Trusted Publishing

Trusted Publishing is configured on npm per package. For a brand-new package name, claim it once with a reviewed manual beta publication:

```sh
npm login
npm run verify
npm run verify:package
npm publish --tag beta --access public
```

Never paste npm credentials, OTPs, or tokens into GitHub issues, commits, logs, or chat.

After the package exists on npm:

1. Open the package's npm settings.
2. Add a GitHub Actions Trusted Publisher:
   - organization/user: `scrollDynasty`;
   - repository: `multi-agent-browser-mcp`;
   - workflow: `publish.yml`;
   - environment: `npm`.
3. In GitHub, create the `npm` environment and restrict deployment to protected `v*` tags/maintainers as desired.
4. In npm publishing access, require 2FA and disallow legacy tokens after OIDC succeeds.

The publish workflow has `id-token: write` and intentionally does not configure `NODE_AUTH_TOKEN` or `registry-url`; npm detects the GitHub OIDC environment.

### 4. CodeQL

This repository uses an advanced `.github/workflows/codeql.yml` workflow. In **Settings → Code security**, do not simultaneously enable CodeQL default setup. If default setup is already enabled, disable it before requiring the advanced CodeQL checks.

### 5. Dependabot and security advisories

Enable Dependabot alerts/security updates and private vulnerability reporting. `.github/dependabot.yml` creates grouped npm updates weekly and GitHub Actions updates monthly.

## Normal contributor flow

1. Create a branch from `master`.
2. Open a PR whose title follows Conventional Commits.
3. Review test evidence and architecture/security effects.
4. Merge only after `all-checks-passed`, PR-title validation, and CodeQL are green.

## Normal release flow

1. Review the release-please PR's changelog and version.
2. Confirm its CI is green.
3. Merge the Release PR.
4. Observe the `release-please` workflow create a GitHub Release/tag.
5. Observe `publish` rerun `npm run verify` and `npm run verify:package` before npm publication.
6. Verify registry state:

```sh
npm view multi-agent-browser-mcp version dist-tags --json
npx -y multi-agent-browser-mcp@latest
```

Future prerelease cycles must be introduced deliberately in a reviewed configuration PR. Do not
create a prerelease merely by editing an npm dist-tag.

Use an MCP client for the final real-world smoke; `npx` remains running because it is an stdio server, so stop it by closing the MCP client rather than treating that as a hang.

## Failed publication

Do not delete or move a release tag to conceal a failure.

1. Diagnose and fix the workflow/package problem through a normal PR.
2. Let release-please prepare a new patch version.
3. Merge the new Release PR and publish the new immutable version.

npm versions are immutable and must never be overwritten. Do not use `npm unpublish`, force-push, or retag a release as a routine recovery mechanism.

## Primary documentation

- [release-please action](https://github.com/googleapis/release-please-action)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [GitHub OIDC security guidance](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## Manual actions requiring explicit maintainer intent

- the first npm bootstrap publication;
- merging a Release PR;
- changing npm dist-tags;
- deprecating or unpublishing a version;
- rotating/revoking release credentials;
- changing protected-branch or environment policies.
