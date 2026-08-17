# Installation

## Requirements

- Node.js 22 or newer
- npm/npx
- a supported local environment for Playwright Chromium

BrowserMesh is published as `browsermesh`; its executable is `browsermesh`.

## Run with npx

Install the Playwright-managed Chromium binary once:

```bash
npx -y browsermesh --install-browser
```

Start the MCP stdio server:

```bash
npx -y browsermesh
```

Normally your MCP client starts this command; do not type MCP protocol messages into it manually.

## Install globally

```bash
npm install --global browsermesh
browsermesh --install-browser
browsermesh
```

## Build from source

```bash
git clone https://github.com/scrollDynasty/multi-agent-browser-mcp.git
cd browsermesh
npm ci
npm run build
node dist/cli.js --install-browser
node dist/cli.js
```

Run [`--doctor --json`](../reference/cli) if Chromium or the private data directory cannot be used.
