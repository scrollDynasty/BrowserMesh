/**
 * Command-line parsing for the `browsermesh` executable.
 *
 * Every option maps onto the environment variable that already configures it,
 * and the result is handed to `loadConfig`. Flags and environment therefore
 * cannot drift apart or validate differently: there is one schema, and the
 * command line is just another way to fill it.
 *
 * Kept free of `process` so the whole surface is testable as a pure function.
 */

export type CliCommand =
  | { readonly kind: 'serve'; readonly overrides: Readonly<Record<string, string>> }
  | { readonly kind: 'install-browser' }
  | {
      readonly kind: 'doctor';
      readonly json: boolean;
      readonly overrides: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'usage-error'; readonly message: string };

interface ValueOption {
  readonly variable: string;
  readonly placeholder: string;
  readonly summary: string;
}

interface ToggleOption {
  readonly variable: string;
  readonly value: string;
  readonly summary: string;
}

const VALUE_OPTIONS: Readonly<Record<string, ValueOption>> = {
  '--timeout': {
    variable: 'BROWSERMESH_TIMEOUT_MS',
    placeholder: '<ms>',
    summary: 'Default bounded operation timeout',
  },
  '--data-dir': {
    variable: 'BROWSERMESH_DATA_DIR',
    placeholder: '<path>',
    summary: 'Directory for saved browser state',
  },
  '--log-level': {
    variable: 'BROWSERMESH_LOG_LEVEL',
    placeholder: '<level>',
    summary: 'debug, info, warn, error, or silent',
  },
  '--max-sessions': {
    variable: 'BROWSERMESH_MAX_SESSIONS',
    placeholder: '<count>',
    summary: 'Maximum concurrent sessions',
  },
  '--max-pages': {
    variable: 'BROWSERMESH_MAX_PAGES',
    placeholder: '<count>',
    summary: 'Maximum managed pages per session',
  },
  '--tools': {
    variable: 'BROWSERMESH_TOOLS',
    placeholder: '<profiles>',
    summary: 'Publish only these tool profiles: core, observability, persistence',
  },
};

const TOGGLE_OPTIONS: Readonly<Record<string, ToggleOption>> = {
  '--headless': {
    variable: 'BROWSERMESH_HEADLESS',
    value: 'true',
    summary: 'Run Chromium without a visible window',
  },
  '--headed': {
    variable: 'BROWSERMESH_HEADLESS',
    value: 'false',
    summary: 'Show the Chromium window (default)',
  },
  '--no-persistence': {
    variable: 'BROWSERMESH_PERSISTENCE',
    value: 'false',
    summary: 'Disable saved browser state',
  },
  '--no-schema-refs': {
    variable: 'BROWSERMESH_SCHEMA_REFS',
    value: 'false',
    summary: 'Publish expanded tool schemas for clients that cannot resolve $ref',
  },
  '--no-auto-install': {
    variable: 'BROWSERMESH_AUTO_INSTALL',
    value: 'false',
    summary: 'Do not download Chromium automatically on first use',
  },
};

export function parseArguments(argv: readonly string[]): CliCommand {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  if (argv.includes('--version') || argv.includes('-v')) return { kind: 'version' };

  const overrides: Record<string, string> = {};
  let installBrowser = false;
  let doctor = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--install-browser') {
      installBrowser = true;
      continue;
    }
    if (argument === '--doctor') {
      doctor = true;
      continue;
    }
    if (argument === '--json') {
      json = true;
      continue;
    }

    const [flag, inlineValue] = splitInlineValue(argument);
    const toggle = TOGGLE_OPTIONS[flag];
    if (toggle !== undefined) {
      if (inlineValue !== undefined) return usageError(`${flag} does not take a value`);
      overrides[toggle.variable] = toggle.value;
      continue;
    }

    const option = VALUE_OPTIONS[flag];
    if (option === undefined) return usageError(`Unknown option '${argument}'`);

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      return usageError(`${flag} requires a value`);
    if (inlineValue === undefined) index += 1;
    overrides[option.variable] = value;
  }

  if (installBrowser && doctor)
    return usageError('--install-browser and --doctor cannot be combined');
  // Checked before the install branch returns, so `--install-browser --json`
  // is rejected rather than silently dropping the flag it cannot honour.
  if (json && !doctor) return usageError('--json is only meaningful with --doctor');
  if (installBrowser) return { kind: 'install-browser' };
  if (doctor) return { kind: 'doctor', json, overrides };
  return { kind: 'serve', overrides };
}

/** The invocation forms, without the option list. Shown alongside a usage error. */
export function usageSummary(): string {
  return [
    'Usage:',
    '  browsermesh [options]              Serve the MCP protocol over stdio',
    '  browsermesh --install-browser      Download the Chromium build BrowserMesh uses',
    '  browsermesh --doctor [--json]      Check this installation and exit',
    '  browsermesh --help                 Show this message',
    '  browsermesh --version              Print the installed version',
  ].join('\n');
}

export function usageText(): string {
  const lines = [
    'browsermesh — isolated multi-session browser runtime for MCP clients',
    '',
    usageSummary(),
    '',
    'Options:',
  ];
  for (const [flag, option] of Object.entries(VALUE_OPTIONS)) {
    lines.push(`  ${`${flag} ${option.placeholder}`.padEnd(32)}${option.summary}`);
  }
  for (const [flag, toggle] of Object.entries(TOGGLE_OPTIONS)) {
    lines.push(`  ${flag.padEnd(32)}${toggle.summary}`);
  }
  lines.push(
    '',
    'Every option can also be set through its BROWSERMESH_* environment variable;',
    'the command line takes precedence. See the configuration reference for defaults.',
  );
  return lines.join('\n');
}

function splitInlineValue(argument: string): [string, string | undefined] {
  const separator = argument.indexOf('=');
  if (separator === -1) return [argument, undefined];
  return [argument.slice(0, separator), argument.slice(separator + 1)];
}

function usageError(message: string): CliCommand {
  return { kind: 'usage-error', message };
}
