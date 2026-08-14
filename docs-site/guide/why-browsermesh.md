# Why BrowserMesh

Most single-browser automation assumes one active page. That assumption becomes fragile when an external client coordinates several users, accounts, roles, or independent tasks.

BrowserMesh replaces ambient state with explicit identity:

| Concern          | BrowserMesh model                                 |
| ---------------- | ------------------------------------------------- |
| Browser identity | one session, one isolated Chromium context        |
| Page identity    | `pageId`, owned by exactly one session            |
| Targeting        | every page call supplies `sessionId` and `pageId` |
| Ordering         | one serial queue per session                      |
| Parallelism      | independent queues for independent sessions       |
| Reasoning        | performed by the external MCP client              |

## Not just another Playwright MCP wrapper

BrowserMesh's domain and runtime do not depend on Playwright or MCP types. The Playwright adapter owns browser-engine handles; the MCP adapter owns transport and schemas. Neither adapter is the product model.

This separation matters because isolation, ownership checks, deadlines, queue recovery, persistence ordering, and error contracts remain BrowserMesh behavior—not accidental behavior inherited from an upstream tool.

## When to create another session

Create a separate session for a different user, account, role, authentication state, or independent parallel workflow. Create another page in the same session only when it should share that session's cookies and storage.
