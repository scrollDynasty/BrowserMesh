# Releasing

Releases are automated but intentionally gated. The documented maintainer flow is:

1. merge conventional changes to `master`;
2. Release Please prepares or updates a release PR when its repository token is configured;
3. merge the release PR;
4. publish the resulting Git tag;
5. the tag workflow reruns verification and package smoke tests;
6. npm publishing uses trusted OIDC and the MCP Registry publisher.

Stable versions use npm dist-tag `latest`; prereleases use `beta`. The tag version must exactly match `package.json` and belong to `master`.

This documentation does not grant permission to publish. See the repository's [release guide](https://github.com/scrollDynasty/multi-agent-browser-mcp/blob/master/docs/releasing.md).
