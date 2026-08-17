import { describe, expect, it } from 'vitest';
import { outputSchemas, type ToolName } from '../../src/adapters/mcp/contracts.js';
import {
  selectedTools,
  toolProfileNames,
  toolProfiles,
} from '../../src/adapters/mcp/tool-profiles.js';

describe('tool profiles', () => {
  it('assigns every published tool to exactly one profile', () => {
    // A tool missing from the table would silently disappear from every
    // configuration, including the default one.
    const assigned = toolProfileNames.flatMap((profile) => [...toolProfiles[profile]]);
    const contracted = Object.keys(outputSchemas) as ToolName[];

    expect([...assigned].sort()).toEqual([...contracted].sort());
    expect(new Set(assigned).size, 'a tool listed in two profiles').toBe(assigned.length);
  });

  it('publishes every profile when no selection is made', () => {
    const everything = new Set(Object.keys(outputSchemas));

    for (const absent of ['', '   ', undefined]) {
      expect(selectedTools(absent)).toEqual(everything);
    }
  });

  it('narrows the surface to the requested profiles', () => {
    const selection = selectedTools('core');

    expect(selection.has('browser_navigate')).toBe(true);
    expect(selection.has('browser_observe')).toBe(false);
    expect(selection.has('browser_state_save')).toBe(false);
    expect(selection.size).toBe(toolProfiles.core.length);
  });

  it('combines profiles and tolerates spacing and repetition', () => {
    const selection = selectedTools(' core , persistence ,core');

    expect(selection.size).toBe(toolProfiles.core.length + toolProfiles.persistence.length);
    expect(selection.has('browser_state_remove')).toBe(true);
    expect(selection.has('browser_observe')).toBe(false);
  });

  it('fails configuration on an unknown profile rather than publishing a guess', () => {
    expect(() => selectedTools('core,typo')).toThrow(/Unknown tool profile 'typo'/u);
    // The message has to name the alternatives, or the operator is left
    // guessing at a value that failed startup.
    expect(() => selectedTools('typo')).toThrow(/core, observability, persistence/u);
  });
});
