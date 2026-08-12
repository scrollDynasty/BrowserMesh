# CodeQL setup

BrowserMesh uses the advanced workflow in `.github/workflows/codeql.yml` to analyze JavaScript/TypeScript and GitHub Actions.

GitHub does not permit default setup and an advanced configuration to upload overlapping analyses. Repository administrators must keep CodeQL default setup disabled under **Settings → Code security → CodeQL analysis** before requiring the workflow checks.

If the workflow reports a conflict with default setup, disable default setup and rerun the failed jobs. Do not remove the advanced workflow merely to make the check green.
