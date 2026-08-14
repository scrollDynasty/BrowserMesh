# Changelog

All notable changes to BrowserMesh are documented in this file.

This project follows [Semantic Versioning](https://semver.org/). Release entries are maintained by [release-please](https://github.com/googleapis/release-please) from Conventional Commit pull-request titles.

## [0.1.5](https://github.com/scrollDynasty/multi-agent-browser-mcp/compare/v0.1.4...v0.1.5) (2026-08-14)


### Bug Fixes

* correct GitHub Pages action SHAs ([#44](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/44)) ([7aa42cd](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/7aa42cdf27075449c5115adf57514745a61c0162))

## [0.1.4](https://github.com/scrollDynasty/multi-agent-browser-mcp/compare/v0.1.3...v0.1.4) (2026-08-13)


### Features

* add advanced typed browser actions ([#31](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/31)) ([981f3a6](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/981f3a631d35594e4b845c80c17ca659008d0980))
* add atomic popup and dialog actions ([#32](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/32)) ([5396656](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/539665687e552a2c8c9fe182a038327adb211dae))
* add bounded accessibility snapshots ([#30](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/30)) ([c2a556a](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/c2a556abdf892682e5c7a4583fdf67b80119a01f))
* add bounded console and page error observability ([#25](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/25)) ([21288eb](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/21288eb429a17bf70f310d3a05256f4fcfbe2015))
* add bounded element references ([#33](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/33)) ([3dc98e0](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/3dc98e05d69e89c2b3a50f6d9f455a2c9a893884))
* add bounded network observability ([#27](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/27)) ([11392db](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/11392db0472a68d5d5daa8ed759f48aed914a573))
* add deterministic browser waits ([#22](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/22)) ([8885ecc](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/8885ecca3569dc2d91e38cd3f2fc70106c3df8c7))
* add explicit headless browser configuration ([#20](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/20)) ([1ac9291](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/1ac9291e4ac200b33461ba7244bddcd131c878dd))
* add immutable snapshot tree pagination ([697684b](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/697684b21c6eacb727bf97cbf2bdec5b4dc34141))
* add isolated browser context settings ([#29](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/29)) ([ea01f8c](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/ea01f8c8bc0458075de763e0d198ad5608f3c610))
* add origin-scoped geolocation permissions ([#34](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/34)) ([8038bb7](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/8038bb78513ab13070a8ebc7fff5daaf42f9c3bd))
* add runtime diagnostics and doctor ([#23](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/23)) ([7f75b96](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/7f75b9698a93c33bb665b2ad187aadbfb357e2f4))
* add safe iframe targeting ([fd3b92b](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/fd3b92b987598ecf6b8fca57a5d16edde632d645))
* add typed browser interactions ([#28](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/28)) ([5ba408a](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/5ba408ad3c4ea465d6ab5b0883faef24e4630904))
* complete MCP cancellation semantics ([#26](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/26)) ([4094117](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/4094117b45101501f8160857bf446ad46ad0b910))
* enforce runtime resource budgets ([57e6ed8](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/57e6ed81df122b6900c74a2a1a480d96f80183e0))
* **mcp:** add native structured tool results ([#24](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/24)) ([f787c09](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/f787c098594671394c0c1d0da3784f197ff46fbe))


### Bug Fixes

* enforce absolute deadlines and capture bounds ([#41](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/41)) ([b9e0b07](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/b9e0b07dce7bcb50469eb758722a961ecc300024))
* harden browser lifecycle concurrency ([f19afd3](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/f19afd389d29f778a946afadd1ec808f04b6b8b7))
* harden public browser error diagnostics ([5470967](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/54709670962e1a6ef1ede6230fd1dfb536f28bb0))
* **mcp:** unify runtime version provenance ([#19](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/19)) ([3d25e48](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/3d25e48f376002ec1632a2e3a8cfa1319880893a))
* sanitize fatal CLI diagnostics ([bc113b1](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/bc113b1e591bdb3d039b5c256b63904ee6567a9a))

## [0.1.3](https://github.com/scrollDynasty/multi-agent-browser-mcp/compare/v0.1.2...v0.1.3) (2026-08-13)


### Bug Fixes

* harden Playwright integration and security ([#14](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/14)) ([a060052](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/a06005229d7ef39a7409f524878eab22b49e03c0))
* publish BrowserMesh to official MCP Registry ([#16](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/16)) ([ae4a78d](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/ae4a78d8dae118ef291087c1b253209c9626e76c))

## [0.1.2](https://github.com/scrollDynasty/multi-agent-browser-mcp/compare/v0.1.1...v0.1.2) (2026-08-12)


### Bug Fixes

* **release:** run publish verification under Xvfb ([#11](https://github.com/scrollDynasty/multi-agent-browser-mcp/issues/11)) ([9154b5a](https://github.com/scrollDynasty/multi-agent-browser-mcp/commit/9154b5ac106dad1b37a1d93fa3062b66ae177d9e))

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
