# Development setup

## Prerequisites

- Node.js 22 or 24
- npm
- Playwright-supported Chromium environment

```bash
git clone https://github.com/scrollDynasty/multi-agent-browser-mcp.git browsermesh
cd browsermesh
npm ci
npx playwright install chromium
npm run build
```

On Linux CI, browser dependencies are installed with `npx playwright install --with-deps chromium`.

## Useful commands

```bash
npm run dev          # MCP server from TypeScript
npm run build        # production TypeScript build
npm run typecheck
npm run lint
npm run format:check
npm run docs:dev     # documentation development server
npm run docs:build   # static documentation build
```

The repository is a strict TypeScript ESM package. Domain/application/runtime code must remain independent of MCP and Playwright adapters.

See the repository's [development guide](https://github.com/scrollDynasty/multi-agent-browser-mcp/blob/master/docs/development.md) for test-server and real-runtime details.
