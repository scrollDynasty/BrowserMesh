import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserMeshRuntime } from '../../runtime/browsermesh-runtime.js';

/**
 * MCP prompts and resources.
 *
 * The product goal in AGENTS.md §22 is that a user can say "test this
 * application as a buyer and an administrator" and the client creates two
 * sessions without being told to. Tool descriptions carry that today, which
 * means paying for the explanation in every contract and hoping it is read.
 * A prompt states the workflow once, in the place the protocol provides for it.
 *
 * These are static templates. BrowserMesh renders text and returns it; it makes
 * no LLM call, keeps no per-client state, and gains no notion of an agent. The
 * responsibility boundary in AGENTS.md §1 is unchanged: the client still
 * reasons and decides which tools to call.
 */

const SESSIONS_RESOURCE = 'browsermesh://sessions';

export function registerPrompts(server: McpServer, runtime: BrowserMeshRuntime): void {
  server.registerPrompt(
    'parallel_roles',
    {
      title: 'Test as several roles at once',
      description:
        'Exercise one workflow as several independent users, accounts, or roles at the same time, each in its own isolated browser session.',
      argsSchema: {
        task: z
          .string()
          .min(1)
          .max(2_000)
          .describe('What to exercise, for example "place an order and confirm it was received"'),
        roles: z
          .string()
          .min(1)
          .max(500)
          .describe('Comma-separated roles, for example "buyer, seller, admin"'),
      },
    },
    ({ task, roles }) => {
      const named = splitRoles(roles);
      const count = String(named.length);
      // A prompt that reads "as 1 independent roles" undermines the instruction
      // it is trying to give, and one role is a legitimate way to invoke this.
      const subject = named.length === 1 ? 'one independent role' : `${count} independent roles`;
      const repetition = named.length === 1 ? 'once' : `${count} times`;
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Task: ${task}`,
                '',
                `Carry it out as ${subject}: ${named.join(', ')}.`,
                '',
                'Use BrowserMesh as follows:',
                `- Call browser_session_create once per role (${repetition}), naming each session after its role. Separate sessions is what keeps their cookies, storage, and authentication apart; reusing one session would let the roles see each other's state.`,
                '- Keep each role on the sessionId and pageId its own creation returned. There is no current or active session, so every call names the pair it addresses.',
                '- Run the roles concurrently. Operations on different sessions execute in parallel; operations within one session run in the order they were accepted.',
                '- Read the page with browser_snapshot before acting, and prefer semantic locators (role, label, test ID) over CSS so the steps survive markup changes.',
                '- Close every session with browser_session_close when its part is finished.',
                '',
                'Report what each role observed, and call out anything that differed between them.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'diagnose_page',
    {
      title: 'Diagnose a failing page',
      description:
        'Load one page in an isolated session and collect console, page-error, and network evidence about what went wrong.',
      argsSchema: {
        // Validated rather than merely described: the value is interpolated
        // into an instruction the client then acts on, and `browser_navigate`
        // accepts absolute HTTP(S) only. Rejecting here says which argument was
        // wrong instead of producing a prompt that cannot be carried out.
        url: z
          .string()
          .min(1)
          .max(2_048)
          .refine(isAbsoluteHttpUrl, 'Must be an absolute http(s) URL')
          .describe('Absolute HTTP(S) URL to investigate'),
        symptom: z.string().max(2_000).optional().describe('What looks wrong, if known'),
      },
    },
    ({ url, symptom }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Investigate ${url}.`,
              ...(symptom === undefined || symptom.length === 0
                ? []
                : [`Reported symptom: ${symptom}`]),
              '',
              'Use BrowserMesh as follows:',
              '- Create one session with browser_session_create so the investigation starts from clean cookies and storage.',
              '- Navigate with browser_navigate, then read the page with browser_snapshot.',
              "- Collect evidence with browser_observe, once per source: 'pageError' for uncaught errors, 'console' for logged messages, 'network' for request and response metadata, and 'requestFailed' for transport-level failures. HTTP error responses such as 500 appear under 'network', not 'requestFailed'.",
              '- Console and page-error results omit text unless includeText=true. Ask for it when the message itself matters; the network sources carry no text and reject the flag.',
              '- Check gap and droppedCount on every result before concluding that something did not happen. A dropped event is not an absent event.',
              '- Close the session when finished.',
              '',
              'Report the evidence you found and what it points at, separating what you observed from what you inferred.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerResource(
    'sessions',
    SESSIONS_RESOURCE,
    {
      title: 'Live BrowserMesh sessions',
      description:
        'The sessions this runtime currently holds, with their status and labels. Read-only.',
      mimeType: 'application/json',
    },
    async () => {
      const listed = await runtime.listSessions();
      return {
        contents: [
          {
            uri: SESSIONS_RESOURCE,
            mimeType: 'application/json',
            text: JSON.stringify({ sessions: listed.value }, null, 2),
          },
        ],
      };
    },
  );
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function splitRoles(roles: string): string[] {
  const named = roles
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  return named.length === 0 ? [roles.trim()] : named;
}
