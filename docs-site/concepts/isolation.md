# Isolation and explicit addressing

```text
BrowserMesh
├── Session buyer  → BrowserContext A → pages A1, A2
├── Session seller → BrowserContext B → page B1
└── Session admin  → BrowserContext C → page C1
```

Separate contexts isolate cookies, supported web storage, pages, URLs, DOM state, and permission grants. Restoring a saved state creates a new context; it does not merge two live sessions.

Every browser operation targets a `sessionId`. Every page-specific operation also targets a `pageId`. BrowserMesh has no global mutable current session, current page, or active tab.

## Ownership checks

The runtime validates the page inside the addressed session. Using `pageId` from Session A with Session B returns `PAGE_NOT_FOUND`, even when that page exists elsewhere.

Short-lived element references and snapshot cursors are also scoped to one session and page. Cross-page, expired, evicted, or lifecycle-invalid handles return a single stale error and reveal no other page's registry.
