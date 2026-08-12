import { resolve } from 'node:path';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  BROWSERMESH_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(10_000),
  BROWSERMESH_DATA_DIR: z.string().min(1).default('.browsermesh'),
  BROWSERMESH_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  BROWSERMESH_MAX_SESSIONS: z.coerce.number().int().positive().max(1_000).default(50),
  BROWSERMESH_MAX_PAGES: z.coerce.number().int().positive().max(100).default(20),
  BROWSERMESH_PERSISTENCE: booleanString.default(true),
});

export interface BrowserMeshConfig {
  readonly defaultTimeoutMs: number;
  readonly dataDirectory: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  readonly maxSessions: number;
  readonly maxPagesPerSession: number;
  readonly persistenceEnabled: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BrowserMeshConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    defaultTimeoutMs: parsed.BROWSERMESH_TIMEOUT_MS,
    dataDirectory: resolve(parsed.BROWSERMESH_DATA_DIR),
    logLevel: parsed.BROWSERMESH_LOG_LEVEL,
    maxSessions: parsed.BROWSERMESH_MAX_SESSIONS,
    maxPagesPerSession: parsed.BROWSERMESH_MAX_PAGES,
    persistenceEnabled: parsed.BROWSERMESH_PERSISTENCE,
  };
}
