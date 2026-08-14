# Sessions and pages tools

## `browser_runtime_info`

Returns versions, Chromium launch state, effective safe configuration, resource limits, and active/failed session counts. It takes no input and does not launch Chromium.

## `browser_session_create`

Creates an isolated context and deterministic initial page.

| Input             | Type                  | Required |
| ----------------- | --------------------- | -------- |
| `name`            | safe non-empty string | no       |
| `metadata`        | string map            | no       |
| `stateId`         | string, 1–128 chars   | no       |
| `contextSettings` | object                | no       |

Context settings support `viewport {width,height}` (integers 1–10,000), `deviceScaleFactor` (0.1–10), `locale`, `timezoneId`, `colorScheme`, `reducedMotion`, `userAgent`, `geolocation`, and a maximum of 100 explicit geolocation permission origins.

```json
{
  "name": "admin-dark",
  "metadata": { "role": "admin" },
  "contextSettings": {
    "viewport": { "width": 1440, "height": 900 },
    "colorScheme": "dark",
    "geolocation": { "latitude": 41.3111, "longitude": 69.2797 },
    "permissions": [{ "permission": "geolocation", "origin": "https://example.test" }]
  }
}
```

Returns `{ operationId, session, initialPage: { sessionId, pageId } }`.

## Session lookup and close

| Tool                    | Input       | Output                                |
| ----------------------- | ----------- | ------------------------------------- |
| `browser_session_list`  | none        | `{ operationId, sessions }`           |
| `browser_session_get`   | `sessionId` | `{ operationId, sessionId, session }` |
| `browser_session_close` | `sessionId` | terminal session view                 |

Close is idempotent. Closing releases every page and the isolated context.

## Page lifecycle

| Tool                  | Input                 | Output                     |
| --------------------- | --------------------- | -------------------------- |
| `browser_page_create` | `sessionId`           | new managed page           |
| `browser_page_list`   | `sessionId`           | pages in that session only |
| `browser_page_close`  | `sessionId`, `pageId` | `closed: true`             |

Use another page when tabs should share cookies and storage. Use another session when identity must be isolated.
