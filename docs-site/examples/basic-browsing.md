# Basic browsing

This is the logical MCP call sequence for one browser task. IDs are placeholders for values returned by previous calls.

## Create

Call `browser_session_create`:

```json
{ "name": "research" }
```

Retain `session.sessionId` and `initialPage.pageId`.

## Navigate and inspect

```json
{
  "sessionId": "<sessionId>",
  "pageId": "<pageId>",
  "url": "https://example.com"
}
```

Call `browser_snapshot` with bounded interactive output:

```json
{
  "sessionId": "<sessionId>",
  "pageId": "<pageId>",
  "interactiveOnly": true,
  "includeRefs": true
}
```

Use a semantic locator or a freshly returned ref for the next action. Prefer `browser_action_and_wait` if that action triggers navigation, a response, popup, or dialog.

## Close

```json
{ "sessionId": "<sessionId>" }
```

Closing the session releases all of its pages and browser context.
