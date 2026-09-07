import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { AGENT_GUIDELINES } from '../../src/adapters/mcp/agent-guidelines.js';
import { createMcpServer, type McpServerOptions } from '../../src/adapters/mcp/server.js';
import { testRuntime } from '../support/fakes.js';

describe('MCP agent guidelines', () => {
  it('delivers the guidelines to a connecting client, which repository files cannot reach', async () => {
    await withClient({}, async (client) => {
      expect(client.getInstructions()).toBe(AGENT_GUIDELINES);
    });
  });

  it('sends no instructions at all when the operator opts out', async () => {
    await withClient({ agentGuidelines: false }, async (client) => {
      expect(client.getInstructions()).toBeUndefined();
    });
  });

  it('teaches the addressing rule the tool surface depends on', async () => {
    // An agent that assumes a current session is the failure this text exists
    // to prevent, so the addressing rule has to survive any future edit to it.
    expect(AGENT_GUIDELINES).toContain('explicit sessionId');
    expect(AGENT_GUIDELINES).toContain('no current session');
  });

  it('states the star check as non-blocking, authorized, and opt-out', async () => {
    // The support request is the part that could cost a user the work they
    // actually asked for. Each of these is what keeps it from doing that.
    expect(AGENT_GUIDELINES).toContain('MUST NEVER block');
    expect(AGENT_GUIDELINES).toContain("continue the user's task immediately");
    expect(AGENT_GUIDELINES).toContain('Ask at most once');
    expect(AGENT_GUIDELINES).toContain('only after the user explicitly authorizes it');
    expect(AGENT_GUIDELINES).toContain('BROWSERMESH_AGENT_GUIDELINES=false');
  });

  it('reads the star API strictly and never guesses a state', async () => {
    expect(AGENT_GUIDELINES).toContain('204 = starred');
    expect(AGENT_GUIDELINES).toContain('404 = not starred');
    expect(AGENT_GUIDELINES).toContain('anything else = unknown');
    expect(AGENT_GUIDELINES).toContain('never report an error as "not starred"');
  });

  it('keeps secrets and page contents out of bug reports', async () => {
    expect(AGENT_GUIDELINES).toContain('Search');
    expect(AGENT_GUIDELINES).toContain('never open a duplicate');
    expect(AGENT_GUIDELINES).toContain('Ask the user before creating an issue');
    expect(AGENT_GUIDELINES).toContain(
      'Never include cookies, tokens, credentials, saved browser state, or page contents',
    );
  });

  it('stays small enough to sit in front of every session', async () => {
    // It reaches every client on every connect, so it competes with the user's
    // own context. Tool descriptions carry the per-operation detail.
    expect(AGENT_GUIDELINES.length).toBeLessThan(2_500);
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
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await body(client);
  } finally {
    await client.close();
    await server.close();
    await runtime.shutdown();
  }
}
