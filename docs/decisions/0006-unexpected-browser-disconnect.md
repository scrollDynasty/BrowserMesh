# ADR 0006: Fail live sessions after an unexpected browser disconnect

Status: Accepted

BrowserMesh observes unexpected Chromium disconnects through the browser-engine port. Every live session backed by the disconnected browser transitions to `failed`, stops accepting work, and drops its invalid context/page handles. Operations against those sessions return `BROWSER_DISCONNECTED`.

The runtime does not silently reconstruct sessions because doing so would falsely imply that in-memory page, authentication, and navigation state survived. A later session creation may start a fresh browser process; only that new session uses it.
