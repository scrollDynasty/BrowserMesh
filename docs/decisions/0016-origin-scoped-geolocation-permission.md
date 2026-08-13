# ADR 0016: Origin-scoped geolocation permission

Status: Accepted

BrowserMesh exposes geolocation as an isolated browser-context setting only through an exact,
bounded permission contract. `contextSettings.geolocation` contains finite latitude `-90..90`,
longitude `-180..180`, and optional accuracy `0..100000` metres. A geolocation value may be used
without a grant to test denied/prompt behavior. A permission grant requires a geolocation value.

`contextSettings.permissions` contains at most 100 entries. The only accepted entry is:

```json
{ "permission": "geolocation", "origin": "https://example.test:8443" }
```

An origin must be one explicit absolute `http` or `https` origin. Credentials, paths other than
the URL root, queries, fragments, wildcard hosts, URL patterns, duplicates after canonicalization,
and every permission name other than `geolocation` are rejected before browser resources are
created. Default ports and host casing are canonicalized through the URL origin algorithm.

The Playwright adapter creates the non-persistent context with the geolocation setting, then calls
`grantPermissions(['geolocation'], { origin })` once per validated origin. It never forwards the
BrowserMesh permission descriptor as a browser context option. Cancellation or any grant failure
closes the not-yet-registered context; normal session close, shutdown, and browser disconnect also
destroy the context and its grants. No grant is global and no grant is restored from storage state.

The normalized geolocation and explicit origins are safe effective configuration and appear in
`SessionView`; cookies, storage, credentials, or implicit browser permission state do not. Adding
another permission requires a new reviewed contract and security analysis, not widening a string
field.
