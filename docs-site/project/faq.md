# FAQ

## Is BrowserMesh an AI agent framework?

No. The external MCP client reasons and orchestrates. BrowserMesh executes browser operations.

## Is it Playwright MCP with multiple tabs?

No. BrowserMesh has its own engine-neutral runtime model. Playwright and MCP are adapters, and session/page ownership, queues, lifecycle, persistence, and errors are BrowserMesh contracts.

## Why do calls require two IDs?

`sessionId` selects browser identity/context. `pageId` selects a page owned by that identity. Explicit addressing avoids accidental operations on an ambient active page.

## Session or page?

Use a new page when it should share cookies/storage with existing pages. Use a new session for a different user, account, role, auth state, device/permission profile, or independent parallel workflow.

## Can sessions run in parallel?

Yes. Operations are serialized within one session and can run concurrently across sessions.

## Which browser is supported?

Chromium through the repository's pinned Playwright major. Firefox and WebKit parity are outside v0.1.

## Is there a hosted server or HTTP transport?

No. v0.1 is one local Node.js process using MCP stdio.

## Can BrowserMesh upload/download files or save traces?

No. Filesystem-backed artifacts are deferred until a reviewed, quota-controlled artifact contract exists.

## Does it preserve login state?

Optional persistence can save and restore supported Playwright storage state under logical IDs. Protect that state as sensitive data.

## What happens after Chromium crashes?

Affected sessions fail. Restart BrowserMesh and recreate them; live sessions are not silently reconstructed.
