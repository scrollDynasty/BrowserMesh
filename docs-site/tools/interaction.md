# Interaction and waits

## Element actions

Each tool accepts the shared page address and exactly one `locator` or short-lived `ref` unless noted.

| Tool                       | Additional input           | Effect              |
| -------------------------- | -------------------------- | ------------------- |
| `browser_click`            | target                     | click               |
| `browser_double_click`     | target                     | double-click        |
| `browser_hover`            | target                     | hover               |
| `browser_focus`            | target                     | focus               |
| `browser_check`            | target                     | ensure checked      |
| `browser_uncheck`          | target                     | ensure unchecked    |
| `browser_scroll_into_view` | target                     | reveal target       |
| `browser_fill`             | target, `value`            | replace field value |
| `browser_press`            | target, `key` (1–64 chars) | press a key         |
| `browser_select_option`    | target, `value`            | select one option   |

`browser_scroll` instead accepts integer `deltaX` and `deltaY`, each from -1,000,000 to 1,000,000. `browser_drag_and_drop` accepts `source` and `target` locators; refs are not accepted for drag/drop.

## `browser_wait`

Wait for one passive condition:

- URL: exact or safe glob matcher;
- load: `domcontentloaded` or `load`;
- locator: `visible`, `hidden`, `attached`, `detached`, `enabled`, or `disabled`;
- case-sensitive top-document text: `present` or `absent`.

```json
{
  "sessionId": "…",
  "pageId": "…",
  "condition": {
    "kind": "locator",
    "locator": { "strategy": "role", "value": "heading", "name": "Complete" },
    "state": "visible"
  }
}
```

Do not enqueue a wait and its triggering action separately in the same session; the wait occupies that queue.

## `browser_action_and_wait`

This composite registers the waiter first, then performs a click or key press under one deadline. It supports navigation, response, popup, and dialog events.

```json
{
  "sessionId": "…",
  "pageId": "…",
  "action": {
    "kind": "click",
    "target": { "strategy": "role", "value": "button", "name": "Submit" }
  },
  "wait": { "kind": "navigation", "loadState": "domcontentloaded" }
}
```

Popup pages receive a new same-session page ID. Dialog waits require the expected `dialogType` and `accept`/`dismiss` decision because blocking dialogs cannot safely be inspected later.
