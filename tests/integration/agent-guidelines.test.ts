import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { agentGuidelines } from '../../src/adapters/mcp/agent-guidelines.js';
import { createMcpServer, type McpServerOptions } from '../../src/adapters/mcp/server.js';
import { loadConfig } from '../../src/infrastructure/config.js';
import { testRuntime } from '../support/fakes.js';

// What the text says is asserted in tests/unit/agent-guidelines.test.ts. This
// file covers only what needs a connected client: that the string reaches one,
// and that each opt-out changes what it receives.
describe('MCP agent guidelines delivery', () => {
  it('delivers the guidelines to a connecting client, which repository files cannot reach', async () => {
    await withClient({}, async (client) => {
      const instructions = client.getInstructions();
      expect(instructions).toBe(agentGuidelines());
      // createMcpServer is public API, so its own default is the conservative
      // one: an embedder that upgrades BrowserMesh does not start asking its
      // users for GitHub stars. The CLI opts in from configuration.
      expect(instructions).toContain('explicit sessionId');
      expect(instructions).not.toContain('gh api');
    });
  });

  it('sends no instructions at all when the operator opts out entirely', async () => {
    await withClient({ agentGuidelines: false }, async (client) => {
      expect(client.getInstructions()).toBeUndefined();
    });
  });

  it('honours the CI carve-out the shipped text promises', async () => {
    // The string tells the reader "BrowserMesh drops this section under CI".
    // loadConfig deciding that, and createMcpServer sending it, are asserted
    // separately; this covers the seam between them, which is what the claim
    // actually depends on. createMcpServer itself reads no environment.
    const { agentGuidelines: guidelines, supportRequest } = loadConfig({ CI: 'true' });
    await withClient({ agentGuidelines: guidelines, supportRequest }, async (client) => {
      expect(client.getInstructions()).toBe(agentGuidelines());
    });

    const attended = loadConfig({ CI: 'false' });
    await withClient(
      { agentGuidelines: attended.agentGuidelines, supportRequest: attended.supportRequest },
      async (client) => {
        expect(client.getInstructions()).toBe(agentGuidelines({ supportRequest: true }));
      },
    );
  });

  it('keeps the guidance when only the support request is declined', async () => {
    await withClient({ supportRequest: false }, async (client) => {
      const instructions = client.getInstructions();
      expect(instructions).toBe(agentGuidelines());
      expect(instructions).toContain('explicit sessionId');
      expect(instructions).not.toContain('gh api');
    });
  });
});

async function withClient(
  options: McpServerOptions,
  body: (client: Client) => Promise<void>,
): Promise<void> {
  const { runtime } = testRuntime();
  const server = createMcpServer(runtime, options);
  const client = new Client({ name: 'guidelines-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    // Inside the try: a rejecting connect would otherwise skip shutdown and
    // leave the runtime live for the rest of the file, turning one failed
    // assertion into a cascade.
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await body(client);
  } finally {
    // Same nesting as instructionsFromCli: a rejecting client.close() must not
    // skip the runtime shutdown behind it.
    try {
      await client.close();
    } finally {
      try {
        await server.close();
      } finally {
        await runtime.shutdown();
      }
    }
  }
}
