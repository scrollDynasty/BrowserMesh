import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpServer } from '../../src/adapters/mcp/server.js';
import { testRuntime } from '../support/fakes.js';

describe('MCP prompts and resources', () => {
  it('offers a prompt for the multi-role workflow BrowserMesh exists to serve', async () => {
    await withClient(async (client) => {
      const listed = await client.listPrompts();
      expect(listed.prompts.map(({ name }) => name).sort()).toEqual([
        'compare_page_states',
        'diagnose_page',
        'form_validation',
        'parallel_roles',
      ]);

      const rendered = await client.getPrompt({
        name: 'parallel_roles',
        arguments: { task: 'place an order', roles: 'buyer, admin ,, seller' },
      });

      const text = promptText(rendered);
      // The prompt has to teach the one thing tool descriptions keep repeating:
      // a session per role, and why reusing one would be wrong.
      expect(text).toContain('place an order');
      expect(text).toContain('buyer, admin, seller');
      expect(text).toContain('3 independent roles');
      expect(text).toContain('browser_session_create once per role (3 times)');
      expect(text).toContain('browser_session_close');
      expect(text).toContain('no current or active session');
    });
  });

  it('reads correctly when the workflow has a single role', async () => {
    await withClient(async (client) => {
      const rendered = await client.getPrompt({
        name: 'parallel_roles',
        arguments: { task: 'sign in', roles: 'admin' },
      });

      // One role is a legitimate way to invoke this, and a prompt that says
      // "as 1 independent roles" undermines the instruction it is giving.
      const text = promptText(rendered);
      expect(text).toContain('as one independent role: admin');
      expect(text).toContain('once per role (once)');
      expect(text).not.toContain('1 independent roles');
      expect(text).not.toContain('1 times');
    });
  });

  it('renders the diagnosis prompt against the merged observation contract', async () => {
    await withClient(async (client) => {
      const rendered = await client.getPrompt({
        name: 'diagnose_page',
        arguments: { url: 'https://example.test/checkout', symptom: 'the button does nothing' },
      });

      const text = promptText(rendered);
      expect(text).toContain('https://example.test/checkout');
      expect(text).toContain('the button does nothing');
      expect(text).toContain('browser_observe');
      // Naming every source keeps the prompt honest about what the one tool
      // replaced, and repeats the distinction clients get wrong.
      for (const source of ['console', 'pageError', 'network', 'requestFailed']) {
        expect(text, source).toContain(source);
      }
      expect(text).toContain('gap and droppedCount');
    });
  });

  it('omits an absent optional argument instead of rendering an empty line', async () => {
    await withClient(async (client) => {
      const rendered = await client.getPrompt({
        name: 'diagnose_page',
        arguments: { url: 'https://example.test/' },
      });

      expect(promptText(rendered)).not.toContain('Reported symptom');
    });
  });

  it('renders the two-state comparison prompt as two sessions, not two readings', async () => {
    await withClient(async (client) => {
      const rendered = await client.getPrompt({
        name: 'compare_page_states',
        arguments: {
          url: 'https://example.test/pricing',
          left: 'signed-out visitor',
          right: 'subscriber',
        },
      });

      const text = promptText(rendered);
      expect(text).toContain('https://example.test/pricing');
      expect(text).toContain('signed-out visitor');
      expect(text).toContain('subscriber');
      // The whole point of routing this through BrowserMesh rather than one
      // browser is that the second reading must not inherit the first state.
      expect(text).toContain('browser_session_create twice');
      expect(text).toContain('the same arguments');
      expect(text).toContain('browser_session_close');
    });

    await withClient(async (client) => {
      await expect(
        client.getPrompt({
          name: 'compare_page_states',
          arguments: { url: 'not-a-url', left: 'a', right: 'b' },
        }),
      ).rejects.toThrow();
    });
  });

  it('renders the form-validation prompt without inviting real credentials', async () => {
    await withClient(async (client) => {
      const rendered = await client.getPrompt({
        name: 'form_validation',
        arguments: { url: 'https://example.test/signup', form: 'the newsletter form' },
      });

      const text = promptText(rendered);
      expect(text).toContain('https://example.test/signup');
      expect(text).toContain('the newsletter form');
      expect(text).toContain('browser_action_and_wait');
      expect(text).toContain('browser_observe');
      // A prompt that walks an agent through a login form has to say this, or
      // it becomes an instruction to type the user's real password into a page.
      expect(text).toContain('Never submit real credentials');
    });

    await withClient(async (client) => {
      const rendered = await client.getPrompt({
        name: 'form_validation',
        arguments: { url: 'https://example.test/signup' },
      });

      expect(promptText(rendered)).not.toContain('Form:');
    });
  });

  it('exposes live sessions as a read-only resource', async () => {
    await withClient(async (client) => {
      const listed = await client.listResources();
      expect(listed.resources.map(({ uri }) => uri)).toContain('browsermesh://sessions');

      const before = await readSessions(client);
      expect(before).toEqual([]);

      await client.callTool({
        name: 'browser_session_create',
        arguments: { name: 'buyer', metadata: { role: 'buyer' } },
      });

      const after = await readSessions(client);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        name: 'buyer',
        status: 'ready',
        metadata: { role: 'buyer' },
      });
    });
  });
});

async function withClient(body: (client: Client) => Promise<void>): Promise<void> {
  const { runtime } = testRuntime();
  const server = createMcpServer(runtime);
  const client = new Client({ name: 'prompt-client', version: '1.0.0' });
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

function promptText(rendered: unknown): string {
  return z
    .object({
      messages: z
        .array(z.object({ role: z.string(), content: z.object({ text: z.string() }) }))
        .min(1),
    })
    .parse(rendered)
    .messages.map((message) => message.content.text)
    .join('\n');
}

async function readSessions(
  client: Client,
): Promise<{ name?: string | undefined; status: string; metadata: Record<string, string> }[]> {
  const read = await client.readResource({ uri: 'browsermesh://sessions' });
  const body = z.object({ contents: z.array(z.object({ text: z.string() })).min(1) }).parse(read)
    .contents[0];
  return z
    .object({
      sessions: z.array(
        z.object({
          name: z.string().optional(),
          status: z.string(),
          metadata: z.record(z.string(), z.string()),
        }),
      ),
    })
    .parse(JSON.parse(body?.text ?? '{}')).sessions;
}
