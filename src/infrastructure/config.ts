import { resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_RESOURCE_LIMITS, type ResourceLimits } from '../domain/resource-limits.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  BROWSERMESH_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(10_000),
  BROWSERMESH_DATA_DIR: z.string().min(1).default('.browsermesh'),
  BROWSERMESH_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  BROWSERMESH_MAX_SESSIONS: z.coerce.number().int().positive().max(1_000).default(50),
  BROWSERMESH_MAX_PAGES: z.coerce.number().int().positive().max(100).default(20),
  BROWSERMESH_PERSISTENCE: booleanString.default(true),
  BROWSERMESH_HEADLESS: booleanString.default(false),
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
  readonly observability: {
    readonly maxEventsPerPage: number;
    readonly maxStringLength: number;
    readonly maxPageSize: number;
    readonly maxResponseBytes: number;
  };
  readonly resources: ResourceLimits;
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
    headless: parsed.BROWSERMESH_HEADLESS,
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
