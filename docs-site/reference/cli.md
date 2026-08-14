# CLI reference

The installed executable is `browsermesh`.

```text
Usage: browsermesh [--install-browser | --doctor --json]
```

| Command                         | Behavior                                          | Exit status                        |
| ------------------------------- | ------------------------------------------------- | ---------------------------------- |
| `browsermesh`                   | start MCP stdio server                            | until transport closes or shutdown |
| `browsermesh --install-browser` | install Playwright Chromium                       | non-zero on failure                |
| `browsermesh --doctor --json`   | run bounded diagnostics and write one JSON result | `1` when status is failed          |
| any other arguments             | print usage to stderr                             | `2`                                |

Browser startup is lazy: starting the MCP server and discovering tools does not require Chromium to launch immediately.

## Doctor

Doctor validates the Node.js version, BrowserMesh version chain, private data-directory access, Chromium executable availability, and a bounded real browser/context/page smoke test with cleanup.

```bash
npx -y multi-agent-browser-mcp --doctor --json
```

Doctor output is structured and safe for diagnostics. It does not return browser state or credentials. Apply the remediation supplied by a failed check; the most common is:

```bash
npx -y multi-agent-browser-mcp --install-browser
```
