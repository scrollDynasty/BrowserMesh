import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_RESOURCE_LIMITS, type ResourceLimits } from '../domain/resource-limits.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Rejected configuration, reported as one readable line naming the variable.
 *
 * Distinct from `BrowserMeshError` because configuration fails before a runtime
 * exists: there is no operation to correlate and no MCP boundary to cross, only
 * a person or a client launcher reading stderr.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Where saved browser state lives when nothing overrides it.
 *
 * Resolving a relative default against the working directory was wrong for the
 * way BrowserMesh is actually started: an MCP client spawns it, and the
 * directory it happens to spawn from varies by client and by launch. Saved
 * authentication state then scattered across unrelated folders and
 * `browser_state_list` came back empty for no visible reason. A per-user
 * location is stable across launches; pass `--data-dir .browsermesh` for the
 * previous project-scoped behaviour.
 */
export function defaultDataDirectory(home: string = homedir()): string {
  return join(home, '.browsermesh');
}

const environmentSchema = z.object({
  BROWSERMESH_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(10_000),
  BROWSERMESH_DATA_DIR: z.string().min(1).optional(),
  BROWSERMESH_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  BROWSERMESH_MAX_SESSIONS: z.coerce.number().int().positive().max(1_000).default(50),
  BROWSERMESH_MAX_PAGES: z.coerce.number().int().positive().max(100).default(20),
  BROWSERMESH_PERSISTENCE: booleanString.default(true),
  BROWSERMESH_HEADLESS: booleanString.default(false),
  BROWSERMESH_SCHEMA_REFS: booleanString.default(true),
  BROWSERMESH_AUTO_INSTALL: booleanString.default(true),
  BROWSERMESH_TOOLS: z.string().default(''),
  BROWSERMESH_OBSERVABILITY_EVENTS: z.coerce.number().int().positive().max(1_000).default(200),
  BROWSERMESH_OBSERVABILITY_STRING_CHARS: z.coerce
    .number()
    .int()
    .min(128)
    .max(8_192)
    .default(2_048),
  BROWSERMESH_OBSERVABILITY_PAGE_SIZE: z.coerce.number().int().positive().max(200).default(100),
  BROWSERMESH_OBSERVABILITY_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(262_144)
    .default(65_536),
  BROWSERMESH_SCREENSHOT_MAX_DIMENSION: z.coerce
    .number()
    .int()
    .min(256)
    .max(32_768)
    .default(DEFAULT_RESOURCE_LIMITS.screenshot.maxDimensionPixels),
  BROWSERMESH_SCREENSHOT_MAX_PIXELS: z.coerce
    .number()
    .int()
    .min(65_536)
    .max(268_435_456)
    .default(DEFAULT_RESOURCE_LIMITS.screenshot.maxPixels),
  BROWSERMESH_SCREENSHOT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(67_108_864)
    .default(DEFAULT_RESOURCE_LIMITS.screenshot.maxBytes),
  BROWSERMESH_VISIBLE_TEXT_MAX_CHARS: z.coerce
    .number()
    .int()
    .min(128)
    .max(1_000_000)
    .default(DEFAULT_RESOURCE_LIMITS.visibleText.maxChars),
  BROWSERMESH_VISIBLE_TEXT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(512)
    .max(4_194_304)
    .default(DEFAULT_RESOURCE_LIMITS.visibleText.maxBytes),
  BROWSERMESH_MAX_SAVED_STATES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(DEFAULT_RESOURCE_LIMITS.persistence.maxStates),
  BROWSERMESH_MAX_STATE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(67_108_864)
    .default(DEFAULT_RESOURCE_LIMITS.persistence.maxStateBytes),
  BROWSERMESH_MAX_STATE_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(1_073_741_824)
    .default(DEFAULT_RESOURCE_LIMITS.persistence.maxTotalBytes),
});

export interface BrowserMeshConfig {
  readonly defaultTimeoutMs: number;
  readonly dataDirectory: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  readonly maxSessions: number;
  readonly maxPagesPerSession: number;
  readonly persistenceEnabled: boolean;
  readonly headless: boolean;
  /**
   * Share repeated subschemas through `$defs`/`$ref` in published tool schemas.
   * Disable only for a client whose validator cannot resolve references.
   */
  readonly schemaReferences: boolean;
  /** Download Chromium on first start when this installation has never had it. */
  readonly autoInstall: boolean;
  /**
   * Comma-separated tool profiles to publish. Empty publishes every profile.
   */
  readonly tools: string;
  readonly observability: {
    readonly maxEventsPerPage: number;
    readonly maxStringLength: number;
    readonly maxPageSize: number;
    readonly maxResponseBytes: number;
  };
  readonly resources: ResourceLimits;
}

/**
 * Resolve configuration from the process environment with command-line
 * overrides layered on top.
 *
 * The merge belongs here rather than in the CLI so that `process.env` is read
 * in exactly one module, which `tests/unit/architecture.test.ts` enforces.
 */
export function loadConfigWithOverrides(
  overrides: Readonly<Record<string, string>>,
): BrowserMeshConfig {
  return loadConfig({ ...process.env, ...overrides });
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BrowserMeshConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) throw new ConfigurationError(describe(result.error));
  const parsed = result.data;
  return {
    defaultTimeoutMs: parsed.BROWSERMESH_TIMEOUT_MS,
    dataDirectory: resolve(parsed.BROWSERMESH_DATA_DIR ?? defaultDataDirectory()),
    logLevel: parsed.BROWSERMESH_LOG_LEVEL,
    maxSessions: parsed.BROWSERMESH_MAX_SESSIONS,
    maxPagesPerSession: parsed.BROWSERMESH_MAX_PAGES,
    persistenceEnabled: parsed.BROWSERMESH_PERSISTENCE,
    headless: parsed.BROWSERMESH_HEADLESS,
    schemaReferences: parsed.BROWSERMESH_SCHEMA_REFS,
    autoInstall: parsed.BROWSERMESH_AUTO_INSTALL,
    tools: parsed.BROWSERMESH_TOOLS,
    observability: {
      maxEventsPerPage: parsed.BROWSERMESH_OBSERVABILITY_EVENTS,
      maxStringLength: parsed.BROWSERMESH_OBSERVABILITY_STRING_CHARS,
      maxPageSize: parsed.BROWSERMESH_OBSERVABILITY_PAGE_SIZE,
      maxResponseBytes: parsed.BROWSERMESH_OBSERVABILITY_RESPONSE_BYTES,
    },
    resources: {
      session: DEFAULT_RESOURCE_LIMITS.session,
      screenshot: {
        maxDimensionPixels: parsed.BROWSERMESH_SCREENSHOT_MAX_DIMENSION,
        maxPixels: parsed.BROWSERMESH_SCREENSHOT_MAX_PIXELS,
        maxBytes: parsed.BROWSERMESH_SCREENSHOT_MAX_BYTES,
      },
      visibleText: {
        maxChars: parsed.BROWSERMESH_VISIBLE_TEXT_MAX_CHARS,
        maxBytes: parsed.BROWSERMESH_VISIBLE_TEXT_MAX_BYTES,
      },
      persistence: {
        maxStates: parsed.BROWSERMESH_MAX_SAVED_STATES,
        maxStateBytes: parsed.BROWSERMESH_MAX_STATE_BYTES,
        maxTotalBytes: parsed.BROWSERMESH_MAX_STATE_TOTAL_BYTES,
      },
    },
  };
}

/**
 * Render rejected variables as one line each: which variable, and what it
 * needed. The offending value is never echoed — configuration carries data
 * directories and, in other deployments, could carry secrets.
 */
function describe(error: z.ZodError): string {
  const problems = error.issues.map((issue) => {
    const variable = issue.path[0];
    const name = typeof variable === 'string' ? variable : 'configuration';
    return `  ${name}: ${issue.message}`;
  });
  return ['BrowserMesh configuration is invalid:', ...problems].join('\n');
}
