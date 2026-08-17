# Complete MCP tool index

The exact tool registry is implemented in [`src/adapters/mcp/server.ts`](https://github.com/scrollDynasty/multi-agent-browser-mcp/blob/master/src/adapters/mcp/server.ts). Inputs below omit no public fields; “page address” means required `sessionId`, required `pageId`, and optional `timeoutMs`.

| Tool                       | Input beyond shared address                                       | Primary structured result                                 |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `browser_runtime_info`     | none                                                              | versions, launch state, limits, counts                    |
| `browser_session_create`   | `name?`, `metadata?`, `stateId?`, `contextSettings?`              | session + initial page                                    |
| `browser_session_list`     | none                                                              | sessions                                                  |
| `browser_session_get`      | `sessionId`                                                       | session                                                   |
| `browser_session_close`    | `sessionId`                                                       | terminal session                                          |
| `browser_page_create`      | `sessionId`                                                       | page                                                      |
| `browser_page_list`        | `sessionId`                                                       | pages                                                     |
| `browser_page_close`       | `sessionId`, `pageId`                                             | `closed: true`                                            |
| `browser_navigate`         | page address, `url`                                               | URL                                                       |
| `browser_back`             | page address                                                      | URL                                                       |
| `browser_forward`          | page address                                                      | URL                                                       |
| `browser_reload`           | page address                                                      | URL                                                       |
| `browser_get_url`          | page address                                                      | URL                                                       |
| `browser_get_title`        | page address                                                      | title                                                     |
| `browser_snapshot`         | page address, snapshot options                                    | snapshot, refs, bounds, omissions, pagination, truncation |
| `browser_visible_text`     | page address, `locator`                                           | text + truncation                                         |
| `browser_observe`          | page address, `source`, `sinceEventId?`, `limit?`, `includeText?` | event page, echoed `source`                               |
| `browser_click`            | page address, exactly one `locator`/`ref`                         | completed                                                 |
| `browser_double_click`     | same                                                              | completed                                                 |
| `browser_hover`            | same                                                              | completed                                                 |
| `browser_focus`            | same                                                              | completed                                                 |
| `browser_check`            | same                                                              | completed                                                 |
| `browser_uncheck`          | same                                                              | completed                                                 |
| `browser_scroll_into_view` | same                                                              | completed                                                 |
| `browser_scroll`           | page address, `deltaX`, `deltaY`                                  | completed                                                 |
| `browser_drag_and_drop`    | page address, `source`, `target`                                  | completed                                                 |
| `browser_fill`             | page address, target, `value`                                     | completed                                                 |
| `browser_press`            | page address, target, `key`                                       | completed                                                 |
| `browser_select_option`    | page address, target, `value`                                     | completed                                                 |
| `browser_screenshot`       | page address, `capture?`                                          | PNG metadata + image content                              |
| `browser_wait`             | page address, `condition`                                         | echoed condition                                          |
| `browser_action_and_wait`  | page address, `action`, `wait`                                    | action, wait, captured event                              |
| `browser_state_save`       | `sessionId`, `stateId`                                            | state metadata                                            |
| `browser_state_list`       | none                                                              | state metadata list                                       |
| `browser_state_remove`     | `stateId`                                                         | `removed: true`                                           |

Every success includes `operationId`; page-operation results also include `sessionId` and `pageId`. See the category pages for constraints and examples, and [Returned data](./results) for shared shapes.
