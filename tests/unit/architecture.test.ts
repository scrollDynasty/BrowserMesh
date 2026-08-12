import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('architecture boundaries', () => {
  it('keeps domain, ports, and runtime independent of concrete adapters', async () => {
    const domain = await sourceText('src/domain');
    const ports = await sourceText('src/application');
    const runtime = await sourceText('src/runtime');

    expect(domain).not.toMatch(
      /from ['"][^'"]*(playwright|@modelcontextprotocol|adapters|node:fs)/u,
    );
    expect(ports).not.toMatch(/from ['"][^'"]*(playwright|@modelcontextprotocol|adapters)/u);
    expect(runtime).not.toMatch(/from ['"][^'"]*(playwright|@modelcontextprotocol|adapters)/u);
  });

  it('keeps Playwright and MCP at adapter boundaries without internal agent APIs', async () => {
    const source = await sourceText('src');
    const mcp = await sourceText('src/adapters/mcp');
    expect(mcp).not.toMatch(/from ['"]playwright['"]/u);
    expect(source).not.toMatch(/browser_agent_|browser_message_|AgentRegistry|AgentMailbox/u);
  });

  it('reads environment configuration only through the centralized config module', async () => {
    const files = await typescriptFiles('src');
    const directReaders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (content.includes('process.env') && !file.endsWith(join('infrastructure', 'config.ts'))) {
        directReaders.push(file);
      }
    }
    expect(directReaders).toEqual([]);
  });
});

async function sourceText(directory: string): Promise<string> {
  return (
    await Promise.all((await typescriptFiles(directory)).map((file) => readFile(file, 'utf8')))
  ).join('\n');
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}
