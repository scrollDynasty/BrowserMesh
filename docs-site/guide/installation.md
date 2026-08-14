# Installation

## Requirements

- Node.js 22 or newer
- npm/npx
- a supported local environment for Playwright Chromium

BrowserMesh is published as `multi-agent-browser-mcp`; its executable is `browsermesh`.

## Run with npx

Install the Playwright-managed Chromium binary once:

```bash
npx -y multi-agent-browser-mcp --install-browser
```

Start the MCP stdio server:

```bash
npx -y multi-agent-browser-mcp
```

Normally your MCP client starts this command; do not type MCP protocol messages into it manually.

## Install globally

```bash
npm install --global multi-agent-browser-mcp
browsermesh --install-browser
browsermesh
```

## Build from source

```bash
git clone https://github.com/scrollDynasty/multi-agent-browser-mcp.git
cd multi-agent-browser-mcp
npm ci
npm run build
node dist/cli.js --install-browser
node dist/cli.js
```

Run [`--doctor --json`](../reference/cli) if Chromium or the private data directory cannot be used.
