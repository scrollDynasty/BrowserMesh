# Sessions and pages

## Sessions

A session is BrowserMesh's unit of browser identity and serialization. Each ready session owns one separate, non-persistent Chromium `BrowserContext`.

`browser_session_create` returns both the session view and an initial default page address:

```json
{
  "operationId": "…",
  "session": { "sessionId": "…", "status": "ready", "contextSettings": {} },
  "initialPage": { "sessionId": "…", "pageId": "…" }
}
```

Names and metadata are neutral workflow labels. They do not grant ownership or permissions.

## Pages

A page belongs to exactly one session. Additional pages created by `browser_page_create`, and popups captured by `browser_action_and_wait`, receive managed page IDs in that same session.

Page IDs are not global capabilities. BrowserMesh rejects a page ID supplied with the wrong session.

## Context settings

Session creation can set viewport, device scale, locale, timezone, color scheme, reduced motion, user agent, geolocation, and explicitly origin-scoped geolocation permission. Settings are normalized before browser resources are created and echoed in the session view.

See [Sessions and pages tools](../tools/sessions-pages) for input details.
