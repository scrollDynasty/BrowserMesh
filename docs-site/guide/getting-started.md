# Getting started

This walkthrough installs Chromium, connects BrowserMesh to an MCP client, and describes the first explicitly addressed browser workflow.

## 1. Check Node.js

```bash
node --version
```

Node.js 22 is the minimum supported major version. Node.js 24 is recommended for development.

## 2. Install Chromium

```bash
npx -y browsermesh --install-browser
```

## 3. Configure your client

Set the MCP server command to `npx` and its arguments to `-y`, `browsermesh`. See [MCP client configuration](./mcp-clients).

For unattended use, set `BROWSERMESH_HEADLESS=true`. The runtime default is `false`, so Chromium is visible unless configured otherwise.

## 4. Ask for a workflow

For example:

> Open example.com in a new isolated browser session, inspect the page title, and close the session when finished.

The external client should:

1. call `browser_session_create`;
2. retain `session.sessionId` and `initialPage.pageId`;
3. call `browser_navigate` with both IDs;
4. call `browser_get_title` with both IDs;
5. call `browser_session_close`.

Example call payloads:

```json
{ "name": "docs-example" }
```

```json
{
  "sessionId": "<returned sessionId>",
  "pageId": "<returned pageId>",
  "url": "https://example.com"
}
```

IDs are opaque. Never invent, parse, or reuse a page ID with another session.

## 5. Add a second identity

For buyer/admin or signed-in/signed-out comparisons, call `browser_session_create` again. The new session receives another `BrowserContext`, cookie jar, storage area, page registry, and queue.
