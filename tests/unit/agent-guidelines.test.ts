import { describe, expect, it } from 'vitest';
import { agentGuidelines } from '../../src/adapters/mcp/agent-guidelines.js';

// These assert a static string, so they belong in the inner loop: ADR 0021
// treats each guarantee below as contract, and that only holds if weakening one
// fails `npm test` rather than only the full `verify`.
//
// agentGuidelines() renders without the support request: both public entry
// points default to the conservative variant, and the project's policy default
// is applied by the CLI from config.ts.
describe('agent guidelines text', () => {
  it('teaches the addressing rule the tool surface depends on', () => {
    // An agent that assumes a current session is the failure this text exists
    // to prevent, so the rule has to survive any future edit — including the
    // edit that drops the support request.
    for (const text of [agentGuidelines({ supportRequest: true }), agentGuidelines()]) {
      expect(text).toContain('explicit sessionId');
      expect(text).toContain('no current session');
    }
  });

  it('states the support request as non-blocking, authorized, and droppable', () => {
    // Each of these is what keeps a promotional ask from costing a user the
    // work they actually came for.
    const text = agentGuidelines({ supportRequest: true });
    expect(text).toContain('MUST NEVER block');
    expect(text).toContain("continue the user's task immediately");
    expect(text).toContain('Ask at most once');
    // Instructions arrive once per connect, so bounding the check per task left
    // a long-lived stdio session making one authenticated call per task forever.
    expect(text).toContain('at most once for this whole connection — not once per task');
    // Nothing detects an unattended run on the path this ships through: an MCP
    // client spawns the server with a minimal environment, so CI usually never
    // arrives. Claiming otherwise would invite the backwards inference — section
    // present, therefore CI was ruled out, therefore a person is here.
    expect(text).toContain('do not read the presence of this section as evidence');
    expect(text).toContain('often cannot see CI even when it is set');
    expect(text).toContain('Skip this yourself when nobody is there to answer');
    expect(text).toContain('Star only after the user explicitly authorizes it');
    expect(text).toContain('BROWSERMESH_SUPPORT_REQUEST=false');
  });

  it('describes each opt-out as what it actually does', () => {
    // Reported in review: the text is the only place a consumer learns these
    // flags exist, so claiming the variable drops "this section" when it
    // suppresses everything would lead a user to lose the addressing rule
    // while trying to decline the ask.
    expect(agentGuidelines({ supportRequest: true })).toContain(
      'operator can drop this section with BROWSERMESH_SUPPORT_REQUEST=false, or supportRequest: false when BrowserMesh is embedded',
    );

    // The lean variant is what CI and --no-support-request produce, and it still
    // arrives unsolicited on every connect. Naming the remaining opt-out only in
    // the section that just got dropped would leave that operator no way out.
    for (const text of [agentGuidelines({ supportRequest: true }), agentGuidelines()]) {
      expect(text).toContain(
        'operator can stop these instructions entirely with BROWSERMESH_AGENT_GUIDELINES=false',
      );
      // The variable is read only by the CLI. An embedder's user who sets it
      // would see no change, so the library option has to be named beside it.
      expect(text).toContain('agentGuidelines: false where BrowserMesh is embedded as a library');
    }
  });

  it('reads the star API strictly and never guesses a state', () => {
    const text = agentGuidelines({ supportRequest: true });
    expect(text).toContain('204 = starred');
    expect(text).toContain('404 = not starred');
    expect(text).toContain('anything else = unknown');
    expect(text).toContain('never report an error as "not starred"');
  });

  it('drops the whole request, and only the request, when it is declined', () => {
    const lean = agentGuidelines();
    expect(lean).not.toContain('star');
    expect(lean).not.toContain('gh api');
    expect(lean).toContain('explicit sessionId');
    expect(lean).toContain('never open a duplicate');
  });

  it('keeps secrets and page contents out of bug reports', () => {
    const text = agentGuidelines({ supportRequest: true });
    expect(text).toContain('never open a duplicate');
    expect(text).toContain('Ask the user before creating an issue');
    expect(text).toContain(
      'Never include cookies, tokens, credentials, saved browser state, page contents, or internal URLs and hostnames',
    );
    // safeUrl in results.ts keeps origin + pathname in sanitized error details.
    // Right for a result going back to the caller, wrong for a public issue, and
    // the one item an agent pasting BrowserMesh output verbatim would miss.
    expect(text).toContain('safe to return to you and not safe to publish');
  });

  it('stays small enough to sit in front of every session', () => {
    // Measured in bytes, which is what travels on the wire — the em dashes make
    // this differ from `.length`, and bytes are the figure ADR 0021 reasons
    // about against the 87,367-byte tool surface.
    //
    // The budgets express the design constraint, not the current size: the
    // string must stay a small fraction of the published tool surface, which is
    // 87,367 bytes after ADR 0020. 4,500 is about 5% of it. Set just above the
    // text instead, the guard stops catching a new section and starts failing on
    // every rewording — that happened three times in review, and each fix was
    // bumping the constant, which is exactly what a budget is meant to prevent.
    expect(Buffer.byteLength(agentGuidelines({ supportRequest: true }), 'utf8')).toBeLessThan(
      4_500,
    );
    expect(Buffer.byteLength(agentGuidelines(), 'utf8')).toBeLessThan(2_000);
  });
});
