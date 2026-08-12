# Changelog

All notable changes to BrowserMesh are documented in this file.

This project follows [Semantic Versioning](https://semver.org/). Release entries are maintained by [release-please](https://github.com/googleapis/release-please) from Conventional Commit pull-request titles.

## [0.1.1](https://github.com/scrollDynasty/multi-agent-browser-mcp/compare/v0.1.0...v0.1.1) (2026-08-12)


### Bug Fixes

* **runtime:** keep browser visible and bound failures ([#10](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/10)) ([a9c4873](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/a9c4873cd6aa25d97a80a317c7969e9a85207d45))
* **security:** bound test server inputs ([#8](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/8)) ([00bd73c](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/00bd73c03934a4946e7e9f573f93a7c864a16375))

## [0.1.0](https://github.com/scrollDynasty/multi-agent-browser-mcp/compare/v0.1.0-beta.0...v0.1.0) (2026-08-12)


### Features

* enhance publish workflow to support npm dist-tags and update release documentation for beta prereleases ([87db3df](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/87db3df3879dfdfe5ec539adaa3a51c98757618d))
* implement issue templates for bug reports, feature requests, and questions ([0b2daec](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/0b2daec83d1988a29f549e874341ee566be235b6))
* restructure CI workflows and add new jobs for static checks, unit tests, browser tests, and stress tests ([0b2daec](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/0b2daec83d1988a29f549e874341ee566be235b6))
* update .gitignore to include AGENTS.md and PROMT.md for better file management ([e94380b](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/e94380b2bf7b328ebbb2b7b81915382db2ed07a5))
* update dependabot configuration for improved dependency management and release automation ([9288044](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/92880440197e3ea2f030b107816fc972215d9bc0))


### Bug Fixes

* **release:** configure stable release promotion ([3431762](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/3431762a36fc5d4f3f98b3e2a1e8de0e2e75fa2d))


### Miscellaneous Chores

* promote 0.1.0 stable ([41f3772](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/41f3772bca3b26d411ff4565e64a7579e80f85a1))

## 0.1.0-beta.0 (2026-08-12)

- Initial BrowserMesh v0.1 beta: isolated multi-session Chromium runtime, explicit session/page addressing, MCP stdio tools, per-session concurrency, persistence, lifecycle management, and packaged-artifact verification.
