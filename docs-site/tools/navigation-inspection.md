# Navigation and inspection tools

## Navigation

`browser_navigate` accepts the shared page address plus an absolute HTTP(S) `url`. `browser_back`, `browser_forward`, and `browser_reload` accept only the shared page address. Each returns the resulting URL.

BrowserMesh does not silently retry navigation. Failures are classified into safe public reasons where possible.

## Page reads

| Tool                   | Additional input   | Returns                                                                |
| ---------------------- | ------------------ | ---------------------------------------------------------------------- |
| `browser_get_url`      | none               | current `url`                                                          |
| `browser_get_title`    | none               | current `title`                                                        |
| `browser_visible_text` | `locator`          | bounded visible `text` and truncation metadata                         |
| `browser_snapshot`     | snapshot controls  | bounded ARIA-oriented content, refs, omissions, pagination, truncation |
| `browser_screenshot`   | optional `capture` | in-memory PNG plus width, height, byte count                           |

## Snapshots

Capture controls include `scope`, `maxDepth`, `includeBoundingBoxes`, `maxChars`, `maxBytes`, `includeRefs`, `maxRefs` (maximum 100), `interactiveOnly`, and `maxChildren` (maximum 1,000). Defaults for booleans are `false`.

If content continues, pass only the returned `cursor` with the page address. Pagination reads an immutable captured serialization; it does not inspect the mutated DOM again. Cursors expire after 30 seconds, are scoped to the page, and become stale on navigation or close.

```json
{
  "sessionId": "…",
  "pageId": "…",
  "interactiveOnly": true,
  "includeRefs": true,
  "maxRefs": 50,
  "maxChildren": 100
}
```

## Screenshots

`capture` may be `{ "kind": "viewport" }`, `{ "kind": "fullPage" }`, or `{ "kind": "element", "locator": … }`. Omitted capture means viewport. BrowserMesh never accepts an output path; the image stays in the MCP response.
