# ADR 0005: MCP stdio as the initial transport

Status: Accepted

The local v0.1 server uses the MCP TypeScript SDK `McpServer` with `StdioServerTransport`. MCP remains an adapter that validates inputs and maps typed runtime results/errors. Structured logs use stderr so stdout is exclusively MCP JSON-RPC. Streamable HTTP is deferred until a remote trust/authentication model exists.
