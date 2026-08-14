# Multi-session workflow

Suppose an external client must place an order as a buyer and verify it as an administrator.

```text
external client
├── buyer session → Context A → buyer page
└── admin session → Context B → admin page
```

1. Create `buyer` and `admin` sessions. Keep each returned ID pair together.
2. Navigate and authenticate each session independently.
3. Perform buyer actions in the buyer queue.
4. Inspect admin state in the admin queue. Calls in the two sessions may run concurrently.
5. Use state persistence only when a future new session should restore supported authentication state.
6. Close both sessions even when one workflow fails.

Never put both identities in pages of one session: pages in a session deliberately share cookies and storage.

Conceptual payload map:

```json
{
  "buyer": { "sessionId": "session-a", "pageId": "page-a" },
  "admin": { "sessionId": "session-b", "pageId": "page-b" }
}
```

The labels are maintained by the external orchestrator. BrowserMesh does not create agents, assign ownership, or send messages between sessions.
