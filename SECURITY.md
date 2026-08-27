# Security Policy

## Supported versions

| Version                    | Supported |
| -------------------------- | --------- |
| Latest `0.1.x` release     | Yes       |
| Older prereleases/releases | No        |

Security fixes are applied to the latest supported release line when practical.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub private security advisories](https://github.com/scrollDynasty/BrowserMesh/security/advisories/new). Include impact, affected versions, reproduction steps, and a proposed mitigation when available. Remove credentials, cookies, tokens, passwords, saved browser state, screenshots, and personal data from the report unless maintainers explicitly arrange a secure transfer.

Maintainers will acknowledge reports as soon as practical and coordinate remediation and disclosure. Please allow reasonable time for a fix before public disclosure.

## Security scope

BrowserMesh controls a real local browser and can access whatever the configured browser session can access. Relevant vulnerability classes include:

- cross-session cookie, storage, page, DOM, or screenshot exposure;
- navigation-policy or filesystem-path bypass;
- unsafe MCP input handling or secret-bearing error/log output;
- persistence traversal, corruption, or permission problems;
- browser/context/page lifecycle leaks that cross isolation boundaries;
- package, release, or dependency supply-chain compromise.

Issues in Chromium, Playwright, an MCP client, or a website are normally out of scope unless BrowserMesh introduces or amplifies the vulnerability.

## Safe usage

- Install only the official npm package and verify its version/integrity.
- Treat `.browsermesh/` and saved state as sensitive credentials.
- Keep BrowserMesh local unless you have designed a separate authenticated, authorized, and isolated remote deployment.
- Do not commit npm tokens, GitHub tokens, browser profiles, or saved state.
