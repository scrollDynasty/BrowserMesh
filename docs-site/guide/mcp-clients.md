# Configure an MCP client

BrowserMesh is an MCP stdio server. Configure your client to start this process:

```text
npx -y multi-agent-browser-mcp
```

Client configuration keys and file locations differ. Use your client's current MCP-server documentation for the exact location. A common JSON shape is:

```json
{
  "mcpServers": {
    "browsermesh": {
      "command": "npx",
      "args": ["-y", "multi-agent-browser-mcp"],
      "env": {
        "BROWSERMESH_HEADLESS": "true"
      }
    }
  }
}
```

On a source checkout, replace the command and arguments with an absolute path appropriate to your client:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/multi-agent-browser-mcp/dist/cli.js"]
}
```

## Client behavior

After connecting, the client should discover tools over MCP rather than rely on a hard-coded list. Successful calls include structured content; errors use MCP `isError` with bounded JSON text.

For different users, accounts, roles, authentication states, or parallel workflows, instruct the client to create separate BrowserMesh sessions.

## Environment inheritance

The child process must receive the intended [configuration variables](../reference/configuration). Keep secrets out of configuration: BrowserMesh settings contain operational limits, not account credentials.

BrowserMesh is compatible by protocol with MCP clients that can launch stdio servers. This is not a claim of vendor endorsement or bundled integration.
