import { describe, expect, it } from 'vitest';
import { agentGuidelines } from '../../src/adapters/mcp/agent-guidelines.js';

// These assert a static string, so they belong in the inner loop: ADR 0021
// treats each guarantee below as contract, and that only holds if weakening one
// fails `npm test` rather than only the full `verify`.
describe('agent guidelines text', () => {
  it('teaches the addressing rule the tool surface depends on', () => {
    // An agent that assumes a current session is the failure this text exists
    // to prevent, so the rule has to survive any future edit — including the
    // edit that drops the support request.
    for (const text of [agentGuidelines(), agentGuidelines({ supportRequest: false })]) {
      expect(text).toContain('explicit sessionId');
      expect(text).toContain('no current session');
    }
  });

  it('states the support request as non-blocking, authorized, and droppable', () => {
    // Each of these is what keeps a promotional ask from costing a user the
    // work they actually came for.
    const text = agentGuidelines();
    expect(text).toContain('MUST NEVER block');
    expect(text).toContain("continue the user's task immediately");
    expect(text).toContain('Ask at most once');
    // Instructions arrive once per connect, so bounding the check per task left
    // a long-lived stdio session making one authenticated call per task forever.
    expect(text).toContain('at most once for this whole connection — not once per task');
    // BrowserMesh only detects CI; claiming it covers every unattended run would
    // promise detection that does not exist.
    expect(text).toContain('drops this section under CI');
    expect(text).toContain('skip it yourself when nobody is there to answer');
    expect(text).toContain('Star only after the user explicitly authorizes it');
    expect(text).toContain('BROWSERMESH_SUPPORT_REQUEST=false');
  });

  it('describes each opt-out as what it actually does', () => {
    // Reported in review: the text is the only place a consumer learns these
    // flags exist, so claiming the variable drops "this section" when it
    // suppresses everything would lead a user to lose the addressing rule
    // while trying to decline the ask.
    expect(agentGuidelines()).toContain('BROWSERMESH_SUPPORT_REQUEST=false to drop this section');

    // The lean variant is what CI and --no-support-request produce, and it still
    // arrives unsolicited on every connect. Naming the remaining opt-out only in
    // the section that just got dropped would leave that operator no way out.
    for (const text of [agentGuidelines(), agentGuidelines({ supportRequest: false })]) {
      expect(text).toContain(
        'BROWSERMESH_AGENT_GUIDELINES=false to stop sending these instructions',
      );
    }
  });

  it('reads the star API strictly and never guesses a state', () => {
    const text = agentGuidelines();
    expect(text).toContain('204 = starred');
    expect(text).toContain('404 = not starred');
    expect(text).toContain('anything else = unknown');
    expect(text).toContain('never report an error as "not starred"');
  });

  it('drops the whole request, and only the request, when it is declined', () => {
    const lean = agentGuidelines({ supportRequest: false });
    expect(lean).not.toContain('star');
    expect(lean).not.toContain('gh api');
    expect(lean).toContain('explicit sessionId');
    expect(lean).toContain('never open a duplicate');
  });

  it('keeps secrets and page contents out of bug reports', () => {
    const text = agentGuidelines();
    expect(text).toContain('never open a duplicate');
    expect(text).toContain('Ask the user before creating an issue');
    expect(text).toContain(
      'Never include cookies, tokens, credentials, saved browser state, or page contents',
    );
  });

  it('stays small enough to sit in front of every session', () => {
    // Measured in bytes, which is what travels on the wire — the em dashes make
    // this differ from `.length`, and bytes are the figure ADR 0021 reasons
    // about against the 87,367-byte tool surface.
    expect(Buffer.byteLength(agentGuidelines(), 'utf8')).toBeLessThan(2_500);
    expect(Buffer.byteLength(agentGuidelines({ supportRequest: false }), 'utf8')).toBeLessThan(
      1_250,
    );
  });
});
