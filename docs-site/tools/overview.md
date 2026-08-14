# MCP tools

BrowserMesh v0.1 registers 38 MCP tools. Tool discovery is authoritative; clients should not hard-code this list.

All successful calls return object-root `structuredContent` plus JSON compatibility text. Every operation result contains an `operationId`. Page operations also return `sessionId` and `pageId`. Screenshots additionally return an in-memory `image/png` content block.

## Shared page address

Most page operations accept:

| Field       | Type             | Required | Notes                                      |
| ----------- | ---------------- | -------- | ------------------------------------------ |
| `sessionId` | string           | yes      | explicit owning session                    |
| `pageId`    | string           | yes      | page owned by that session                 |
| `timeoutMs` | positive integer | no       | maximum 300,000; runtime default otherwise |

Element actions require exactly one of `locator` or `ref`. See [Locators and targets](../reference/locators).

## Categories

- [Sessions and pages](./sessions-pages): runtime info and lifecycle
- [Navigation and inspection](./navigation-inspection): URLs, snapshots, text, screenshots
- [Interaction and waits](./interaction): typed page actions and deterministic waits
- [Observability and state](./observability-state): bounded events and persisted storage state
- [Complete tool index](../reference/tools): all inputs and outputs in one table

::: warning Explicit identity
Use separate sessions for different users, accounts, roles, authentication states, permission/device profiles, or independent parallel workflows.
:::
