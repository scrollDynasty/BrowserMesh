# Locators and element targets

BrowserMesh exposes engine-neutral semantic/CSS locators. Playwright locator objects never cross the adapter boundary.

## Locator strategies

| Strategy      | Fields                                                      |
| ------------- | ----------------------------------------------------------- |
| `role`        | `value`, optional `name`, optional `exact` (default `true`) |
| `text`        | `value`                                                     |
| `label`       | `value`                                                     |
| `placeholder` | `value`                                                     |
| `testId`      | `value`                                                     |
| `css`         | `value`                                                     |

Supported roles are `button`, `link`, `textbox`, `checkbox`, `radio`, `combobox`, `heading`, `listitem`, `option`, and `tab`.

```json
{ "strategy": "role", "value": "button", "name": "Save", "exact": true }
```

Prefer role, label, and test ID over CSS. Zero matches wait until the operation deadline; multiple matches return `LOCATOR_AMBIGUOUS`.

## Iframe scope

A locator may add `frame`. `{ "kind": "main" }` explicitly selects the top document. An iframe scope contains an outer-to-inner chain of one to five locator selectors:

```json
{
  "strategy": "role",
  "value": "button",
  "name": "Save",
  "frame": {
    "kind": "iframe",
    "chain": [
      { "strategy": "testId", "value": "editor-frame" },
      { "strategy": "testId", "value": "toolbar-frame" }
    ]
  }
}
```

Frame selectors cannot contain their own `frame`. Each step must resolve uniquely.

## Short-lived refs

Set `includeRefs: true` on `browser_snapshot` to receive opaque `@e…` references. A ref is page-scoped, expires after 30 seconds, and becomes stale after navigation, relevant DOM replacement, page close, session close, disconnect, or shutdown.

For supported actions, supply either `locator` or `ref`, never both:

```json
{ "ref": "@e0123456789abcdef0123456789abcdef" }
```

Refs are immediate action conveniences, not durable test identity.
