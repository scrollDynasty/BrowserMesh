# CLI reference

The installed executable is `browsermesh`.

```text
Usage:
  browsermesh [options]              Serve the MCP protocol over stdio
  browsermesh --install-browser      Download the Chromium build BrowserMesh uses
  browsermesh --doctor [--json]      Check this installation and exit
  browsermesh --help                 Show the full option list
  browsermesh --version              Print the installed version
```

| Command                         | Behavior                                       | Exit status                        |
| ------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `browsermesh`                   | start MCP stdio server                         | until transport closes or shutdown |
| `browsermesh --install-browser` | install Playwright Chromium                    | non-zero on failure                |
| `browsermesh --doctor`          | run bounded diagnostics as readable text       | `1` when status is failed          |
| `browsermesh --doctor --json`   | the same diagnostics as one JSON result        | `1` when status is failed          |
| `browsermesh --help`            | print the full option list to stdout           | `0`                                |
| `browsermesh --version`         | print the installed version to stdout          | `0`                                |
| an unknown or misused option    | print the reason and a usage summary to stderr | `2`                                |

## Options

Every option sets the environment variable that already configures it, and the command line wins
over the environment. A rejected value names the variable it came from and exits with status `2`.

| Option                | Variable                   | Effect                                                              |
| --------------------- | -------------------------- | ------------------------------------------------------------------- |
| `--timeout <ms>`      | `BROWSERMESH_TIMEOUT_MS`   | Default bounded operation timeout                                   |
| `--data-dir <path>`   | `BROWSERMESH_DATA_DIR`     | Directory for saved browser state                                   |
| `--log-level <level>` | `BROWSERMESH_LOG_LEVEL`    | `debug`, `info`, `warn`, `error`, or `silent`                       |
| `--max-sessions <n>`  | `BROWSERMESH_MAX_SESSIONS` | Maximum concurrent sessions                                         |
| `--max-pages <n>`     | `BROWSERMESH_MAX_PAGES`    | Maximum managed pages per session                                   |
| `--tools <profiles>`  | `BROWSERMESH_TOOLS`        | Publish only these profiles: `core`, `observability`, `persistence` |
| `--headless`          | `BROWSERMESH_HEADLESS`     | Run Chromium without a visible window                               |
| `--headed`            | `BROWSERMESH_HEADLESS`     | Show the Chromium window (default)                                  |
| `--no-persistence`    | `BROWSERMESH_PERSISTENCE`  | Disable saved browser state                                         |
| `--no-schema-refs`    | `BROWSERMESH_SCHEMA_REFS`  | Publish expanded schemas for clients that cannot resolve `$ref`     |
| `--no-auto-install`   | `BROWSERMESH_AUTO_INSTALL` | Do not download Chromium automatically on first use                 |

Browser startup is lazy: discovering tools does not require Chromium to launch. The first start of a
fresh installation downloads Chromium before connecting the transport, unless `--no-auto-install`
says otherwise; a failed download still leaves the protocol usable, with the failure reported by
`browser_session_create`.

## Doctor

Doctor validates the Node.js version, BrowserMesh version chain, private data-directory access, Chromium executable availability, and a bounded real browser/context/page smoke test with cleanup.

```bash
npx -y browsermesh --doctor --json
```

Doctor output is structured and safe for diagnostics. It does not return browser state or credentials. Apply the remediation supplied by a failed check; the most common is:

```bash
npx -y browsermesh --install-browser
```
