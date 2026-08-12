# ADR 0001: Modular monolith with ports and adapters

Status: Accepted

BrowserMesh runs locally in one Node.js process. Domain/application contracts do not import MCP, Playwright, or filesystem implementations. Adapters depend inward on ports and runtime services. This preserves a small MVP while allowing transports, browser engines, and state stores to be replaced later without distributed infrastructure now.
