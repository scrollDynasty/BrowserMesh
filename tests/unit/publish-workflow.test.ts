import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('npm publish workflow', () => {
  it('runs headed Chromium verification inside a virtual display', async () => {
    const workflow = await readFile('.github/workflows/publish.yml', 'utf8');

    expect(workflow).toContain('run: xvfb-run --auto-servernum npm run verify\n');
    expect(workflow).toContain('run: xvfb-run --auto-servernum npm run verify:package\n');
    expect(workflow).not.toMatch(/^\s*run: npm run verify(?::package)?\s*$/mu);
  });
});
