# ADR 0007: Unify runtime version, configuration, and diagnostics

Status: Accepted

BrowserMesh will generate one version module from package metadata at build time. MCP
`serverInfo.version`, `browser_runtime_info.serverVersion`, packaged verification, and the MCP
Registry manifest must equal that value. Runtime code must not locate or read `package.json`.

`BROWSERMESH_HEADLESS` becomes a centrally validated boolean with a documented default of `false`
to preserve the baseline headed behavior. Only `true` and `false` are accepted. The effective value
crosses the browser-engine port as launch configuration; direct environment reads outside
configuration are forbidden.

`browser_runtime_info` is a read-only, non-launching MCP tool. It reports bounded safe values:
server, Node, and resolved Playwright package versions; product `chromium`; nullable live
`browserVersion`; launch state; effective headless/persistence/timeouts/limits; and active/failed
session counts. `browserVersion` is `null` unless a live browser reported it. No path, executable,
launch arguments, environment dump, state data, or raw failure is exposed.

`browsermesh --doctor --json` is a finite CLI diagnostic with an overall deadline and non-zero exit
on any failed required check. It checks supported Node, version-chain consistency, data-directory
access without listing contents, Chromium availability, and a launch/context/page/close smoke. A
missing Linux dependency is classified from that real smoke failure; BrowserMesh does not depend on
a private Playwright API to claim a separate exhaustive library preflight. Its
JSON contains a schema version, overall status, bounded per-check status/code/message, and safe
remediation. It owns and closes all resources it creates. MCP discovery and runtime info remain
available without launching Chromium.
