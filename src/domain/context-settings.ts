import { BrowserMeshError } from './errors.js';

export interface ViewportSettings {
  readonly width: number;
  readonly height: number;
}

export type ColorScheme = 'light' | 'dark' | 'no-preference';
export type ReducedMotion = 'reduce' | 'no-preference';

export interface GeolocationSettingsInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy?: number | undefined;
}

export interface GeolocationSettings {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy?: number;
}

export interface BrowserPermissionGrant {
  /** BrowserMesh intentionally exposes no open-ended browser permission name. */
  readonly permission: 'geolocation';
  /** Canonical absolute HTTP(S) origin, never a URL pattern. */
  readonly origin: string;
}

export interface BrowserPermissionGrantInput {
  /** Runtime validation remains authoritative for non-MCP callers. */
  readonly permission: string;
  readonly origin: string;
}

/** Engine-independent, caller-supplied browser-context settings. */
export interface BrowserContextSettingsInput {
  readonly viewport?: ViewportSettings | undefined;
  readonly deviceScaleFactor?: number | undefined;
  readonly locale?: string | undefined;
  readonly timezoneId?: string | undefined;
  readonly colorScheme?: ColorScheme | undefined;
  readonly reducedMotion?: ReducedMotion | undefined;
  readonly userAgent?: string | undefined;
  readonly geolocation?: GeolocationSettingsInput | undefined;
  readonly permissions?: readonly BrowserPermissionGrantInput[] | undefined;
}

/** Immutable settings BrowserMesh applies to one isolated browser context. */
export interface BrowserContextSettings {
  readonly viewport?: ViewportSettings;
  readonly deviceScaleFactor?: number;
  readonly locale?: string;
  readonly timezoneId?: string;
  readonly colorScheme?: ColorScheme;
  readonly reducedMotion?: ReducedMotion;
  readonly userAgent?: string;
  readonly geolocation?: GeolocationSettings;
  readonly permissions?: readonly BrowserPermissionGrant[];
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value, (character) => character.codePointAt(0) ?? 0).some(
    (codePoint) => codePoint <= 31 || (codePoint >= 127 && codePoint <= 159),
  );
}

function invalid(field: string, requirement: string): never {
  throw new BrowserMeshError('INVALID_ARGUMENT', `Invalid contextSettings.${field}`, {
    details: { field: `contextSettings.${field}`, requirement },
  });
}

function boundedInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(field, `must be an integer from ${String(minimum)} through ${String(maximum)}`);
  }
  return value;
}

function safeText(value: string, field: string, maximum: number): string {
  if (value.length === 0 || value.length > maximum || hasControlCharacters(value)) {
    invalid(field, `must contain 1-${String(maximum)} characters and no control characters`);
  }
  return value;
}

function normalizeLocale(value: string): string {
  safeText(value, 'locale', 64);
  try {
    const canonical = Intl.getCanonicalLocales(value);
    if (canonical.length !== 1) invalid('locale', 'must be one valid Unicode locale identifier');
    return canonical[0] as string;
  } catch {
    return invalid('locale', 'must be one valid Unicode locale identifier');
  }
}

function normalizeTimezone(value: string): string {
  safeText(value, 'timezoneId', 128);
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return invalid('timezoneId', 'must be a valid IANA time-zone identifier');
  }
}

function boundedFinite(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(field, `must be a finite number from ${String(minimum)} through ${String(maximum)}`);
  }
  return value;
}

function normalizePermissionOrigin(value: string, index: number): string {
  safeText(value, `permissions.${String(index)}.origin`, 2_000);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid(
      `permissions.${String(index)}.origin`,
      'must be an absolute HTTP(S) origin without credentials, path, query, or fragment',
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    invalid(
      `permissions.${String(index)}.origin`,
      'must be an absolute HTTP(S) origin without credentials, path, query, or fragment',
    );
  }
  return url.origin;
}

export function normalizeContextSettings(
  input: BrowserContextSettingsInput | undefined,
): BrowserContextSettings {
  if (input === undefined) return Object.freeze({});
  const viewport =
    input.viewport === undefined
      ? undefined
      : Object.freeze({
          width: boundedInteger(input.viewport.width, 'viewport.width', 1, 10_000),
          height: boundedInteger(input.viewport.height, 'viewport.height', 1, 10_000),
        });
  const deviceScaleFactor = input.deviceScaleFactor;
  if (
    deviceScaleFactor !== undefined &&
    (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 0.1 || deviceScaleFactor > 10)
  ) {
    invalid('deviceScaleFactor', 'must be a finite number from 0.1 through 10');
  }
  if (
    input.colorScheme !== undefined &&
    !(['light', 'dark', 'no-preference'] as const).includes(input.colorScheme)
  ) {
    invalid('colorScheme', 'must be light, dark, or no-preference');
  }
  if (
    input.reducedMotion !== undefined &&
    !(['reduce', 'no-preference'] as const).includes(input.reducedMotion)
  ) {
    invalid('reducedMotion', 'must be reduce or no-preference');
  }
  const geolocation =
    input.geolocation === undefined
      ? undefined
      : Object.freeze({
          latitude: boundedFinite(input.geolocation.latitude, 'geolocation.latitude', -90, 90),
          longitude: boundedFinite(input.geolocation.longitude, 'geolocation.longitude', -180, 180),
          ...(input.geolocation.accuracy === undefined
            ? {}
            : {
                accuracy: boundedFinite(
                  input.geolocation.accuracy,
                  'geolocation.accuracy',
                  0,
                  100_000,
                ),
              }),
        });
  if (input.permissions !== undefined && input.permissions.length > 100) {
    invalid('permissions', 'must contain at most 100 origin-scoped grants');
  }
  if ((input.permissions?.length ?? 0) > 0 && geolocation === undefined) {
    invalid('permissions', 'geolocation grants require contextSettings.geolocation');
  }
  const permissions = input.permissions?.map((grant, index) => {
    if (grant.permission !== 'geolocation') {
      invalid(
        `permissions.${String(index)}.permission`,
        'must be geolocation; no other browser permission is supported',
      );
    }
    return Object.freeze({
      permission: 'geolocation' as const,
      origin: normalizePermissionOrigin(grant.origin, index),
    });
  });
  if (permissions !== undefined) {
    const origins = permissions.map(({ origin }) => origin);
    if (new Set(origins).size !== origins.length) {
      invalid('permissions', 'must not contain duplicate geolocation origins');
    }
  }
  return Object.freeze({
    ...(viewport === undefined ? {} : { viewport }),
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
    ...(input.locale === undefined ? {} : { locale: normalizeLocale(input.locale) }),
    ...(input.timezoneId === undefined ? {} : { timezoneId: normalizeTimezone(input.timezoneId) }),
    ...(input.colorScheme === undefined ? {} : { colorScheme: input.colorScheme }),
    ...(input.reducedMotion === undefined ? {} : { reducedMotion: input.reducedMotion }),
    ...(input.userAgent === undefined
      ? {}
      : { userAgent: safeText(input.userAgent, 'userAgent', 512) }),
    ...(geolocation === undefined ? {} : { geolocation }),
    ...(permissions === undefined ? {} : { permissions: Object.freeze(permissions) }),
  });
}

export function copyContextSettings(settings: BrowserContextSettings): BrowserContextSettings {
  return {
    ...settings,
    ...(settings.viewport === undefined ? {} : { viewport: { ...settings.viewport } }),
    ...(settings.geolocation === undefined ? {} : { geolocation: { ...settings.geolocation } }),
    ...(settings.permissions === undefined
      ? {}
      : { permissions: settings.permissions.map((permission) => ({ ...permission })) }),
  };
}
