# Security and privacy

BrowserMesh runs locally and communicates over stdio in v0.1. Local execution is not a substitute for host security: the process can browse as the configured user and persisted browser state is sensitive.

## Built-in boundaries

- no general shell or arbitrary JavaScript tool;
- no arbitrary local filesystem read/write or caller-chosen artifact paths;
- screenshot bytes remain in the MCP response;
- logical state IDs map into a private runtime-owned directory;
- URLs and error context are bounded and redacted;
- cookies, tokens, saved state, passwords, form values, response bodies, request headers, and full page contents are not logged;
- geolocation grants are limited to explicit HTTP(S) origins and only the `geolocation` permission;
- browser-derived text, images, events, and state files have runtime-enforced budgets.

## Operator responsibilities

- trust the MCP client that can invoke BrowserMesh;
- protect the machine account and `BROWSERMESH_DATA_DIR`;
- do not commit `.browsermesh/`;
- use separate sessions for identities that must not share state;
- remove saved state when no longer needed;
- review pages and actions before using BrowserMesh with sensitive or destructive workflows.

## Intentional limits

v0.1 has no remote HTTP transport, multi-client authorization, leases, hosted service, HAR/trace/video, upload/download, or artifact store. Unexpected browser disconnect does not reconstruct live sessions.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/scrollDynasty/multi-agent-browser-mcp/security/advisories/new). Do not include credentials, cookies, tokens, or state files.
