# Configuration

BrowserMesh reads configuration from environment variables at process start. Invalid values fail validation instead of being silently coerced to unsafe behavior.

| Variable                                   | Default        | Accepted range / values                    |
| ------------------------------------------ | -------------- | ------------------------------------------ |
| `BROWSERMESH_TIMEOUT_MS`                   | `10000`        | integer 1–300,000                          |
| `BROWSERMESH_DATA_DIR`                     | `.browsermesh` | non-empty path; resolved locally           |
| `BROWSERMESH_LOG_LEVEL`                    | `info`         | `debug`, `info`, `warn`, `error`, `silent` |
| `BROWSERMESH_MAX_SESSIONS`                 | `50`           | integer 1–1,000                            |
| `BROWSERMESH_MAX_PAGES`                    | `20`           | integer 1–100, per session                 |
| `BROWSERMESH_PERSISTENCE`                  | `true`         | exact `true` or `false`                    |
| `BROWSERMESH_HEADLESS`                     | `false`        | exact `true` or `false`                    |
| `BROWSERMESH_OBSERVABILITY_EVENTS`         | `200`          | integer 1–1,000, per page                  |
| `BROWSERMESH_OBSERVABILITY_STRING_CHARS`   | `2048`         | integer 128–8,192                          |
| `BROWSERMESH_OBSERVABILITY_PAGE_SIZE`      | `100`          | integer 1–200                              |
| `BROWSERMESH_OBSERVABILITY_RESPONSE_BYTES` | `65536`        | integer 1,024–262,144                      |
| `BROWSERMESH_SCREENSHOT_MAX_DIMENSION`     | `10000`        | integer 256–32,768                         |
| `BROWSERMESH_SCREENSHOT_MAX_PIXELS`        | `40000000`     | integer 65,536–268,435,456                 |
| `BROWSERMESH_SCREENSHOT_MAX_BYTES`         | `16777216`     | integer 1,024–67,108,864                   |
| `BROWSERMESH_VISIBLE_TEXT_MAX_CHARS`       | `20000`        | integer 128–1,000,000                      |
| `BROWSERMESH_VISIBLE_TEXT_MAX_BYTES`       | `65536`        | integer 512–4,194,304                      |
| `BROWSERMESH_MAX_SAVED_STATES`             | `100`          | integer 1–10,000                           |
| `BROWSERMESH_MAX_STATE_BYTES`              | `1048576`      | integer 1,024–67,108,864                   |
| `BROWSERMESH_MAX_STATE_TOTAL_BYTES`        | `16777216`     | integer 1,024–1,073,741,824                |

Defaults for resource budgets are defined in the runtime's [`resource-limits.ts`](https://github.com/scrollDynasty/multi-agent-browser-mcp/blob/master/src/domain/resource-limits.ts); the values above reflect the current v0.1 source.

## Example

```bash
BROWSERMESH_HEADLESS=true \
BROWSERMESH_MAX_SESSIONS=10 \
BROWSERMESH_LOG_LEVEL=warn \
npx -y multi-agent-browser-mcp
```

Logs go to stderr so stdout remains reserved for MCP stdio. Never put cookies, tokens, passwords, or saved-state contents in environment labels or logs.
