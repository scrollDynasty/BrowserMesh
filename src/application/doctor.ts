import type {
  BrowserContextHandle,
  BrowserEnginePort,
  BrowserPageHandle,
} from './ports/browser-engine.js';
import type { DataDirectoryProbePort } from './ports/data-directory.js';
import { createOperationControl } from './operation-control.js';

export const DOCTOR_SCHEMA_VERSION = '1' as const;
export const doctorCheckIds = [
  'node-version',
  'version-consistency',
  'data-directory-access',
  'chromium-executable',
  'browser-smoke',
] as const;

export type DoctorCheckId = (typeof doctorCheckIds)[number];
export type DoctorCheckStatus = 'passed' | 'failed';

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorCheckStatus;
  readonly code: string;
  readonly message: string;
  readonly remediation: string | null;
}

export interface DoctorResult {
  readonly schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  readonly status: 'passed' | 'failed';
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorOptions {
  readonly engine: BrowserEnginePort;
  readonly dataDirectory: DataDirectoryProbePort;
  readonly nodeVersion: string;
  readonly minimumNodeMajor: number;
  readonly packageVersion: string;
  readonly runtimeVersion: string;
  readonly operationTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly now?: () => number;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.overallTimeoutMs;
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number.parseInt(options.nodeVersion.split('.')[0] ?? '', 10);
  checks.push(
    Number.isInteger(nodeMajor) && nodeMajor >= options.minimumNodeMajor
      ? passed('node-version', 'NODE_SUPPORTED', `Node ${options.nodeVersion} is supported.`)
      : failed(
          'node-version',
          'NODE_UNSUPPORTED',
          `Node ${options.nodeVersion} is not supported.`,
          `Install Node.js ${String(options.minimumNodeMajor)} or newer.`,
        ),
  );

  checks.push(
    options.packageVersion === options.runtimeVersion
      ? passed(
          'version-consistency',
          'VERSION_CONSISTENT',
          `BrowserMesh version ${options.runtimeVersion} is consistent.`,
        )
      : failed(
          'version-consistency',
          'VERSION_MISMATCH',
          'BrowserMesh package and runtime versions do not match.',
          'Reinstall or rebuild BrowserMesh from one package version.',
        ),
  );

  checks.push(
    await runCheck(
      'data-directory-access',
      deadline,
      now,
      () => options.dataDirectory.probe(),
      ['DATA_DIRECTORY_ACCESSIBLE', 'BrowserMesh data directory is readable and writable.'],
      [
        'DATA_DIRECTORY_UNAVAILABLE',
        'BrowserMesh data directory is not readable and writable.',
        'Choose a writable BROWSERMESH_DATA_DIR and verify its permissions.',
      ],
    ),
  );

  checks.push(
    await runBooleanCheck(
      'chromium-executable',
      deadline,
      now,
      () => options.engine.isExecutableAvailable(),
      ['CHROMIUM_AVAILABLE', 'The Playwright Chromium executable is available.'],
      [
        'CHROMIUM_MISSING',
        'The Playwright Chromium executable is unavailable.',
        'Run: npx -y multi-agent-browser-mcp --install-browser',
      ],
    ),
  );

  checks.push(await runSmokeCheck(options, Math.max(0, deadline - now())));

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    status: checks.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
    checks,
  };
}

async function runSmokeCheck(options: DoctorOptions, remainingMs: number): Promise<DoctorCheck> {
  if (remainingMs <= 0) return timedOut('browser-smoke');
  let context: BrowserContextHandle | undefined;
  let page: BrowserPageHandle | undefined;
  const cleanupErrors: unknown[] = [];
  try {
    await options.engine.start();
    context = await options.engine.createContext({
      control: createOperationControl(Math.min(options.operationTimeoutMs, remainingMs)),
    });
    page = await options.engine.createPage(context);
  } catch (error) {
    return classifySmokeFailure(error);
  } finally {
    if (page !== undefined) {
      try {
        await options.engine.closePage(page);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (context !== undefined) {
      try {
        await options.engine.closeContext(context);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await options.engine.stop();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    return failed(
      'browser-smoke',
      'BROWSER_CLEANUP_FAILED',
      'Chromium smoke cleanup did not complete.',
      'Close stray Chromium processes and run the doctor again.',
    );
  }
  return passed(
    'browser-smoke',
    'BROWSER_SMOKE_PASSED',
    'Chromium launch, context, page, and cleanup smoke passed.',
  );
}

function classifySmokeFailure(error: unknown): DoctorCheck {
  const cause = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    cause.includes('missing dependencies') ||
    cause.includes('missing libraries') ||
    cause.includes('install-deps')
  ) {
    return failed(
      'browser-smoke',
      'BROWSER_DEPENDENCY_MISSING',
      'Chromium could not start because required system libraries are missing.',
      'Run: npx playwright install-deps chromium',
    );
  }
  if (cause.includes('executable') || cause.includes('install-browser')) {
    return failed(
      'browser-smoke',
      'CHROMIUM_MISSING',
      'Chromium could not start because its executable is unavailable.',
      'Run: npx -y multi-agent-browser-mcp --install-browser',
    );
  }
  return failed(
    'browser-smoke',
    'BROWSER_SMOKE_FAILED',
    'Chromium launch, context, or page smoke failed.',
    'Run the doctor again after verifying Chromium can start on this system.',
  );
}

async function runCheck(
  id: DoctorCheckId,
  deadline: number,
  now: () => number,
  action: () => Promise<void>,
  success: readonly [code: string, message: string],
  failure: readonly [code: string, message: string, remediation: string],
): Promise<DoctorCheck> {
  if (now() >= deadline) return timedOut(id);
  try {
    await action();
    return passed(id, ...success);
  } catch {
    return failed(id, ...failure);
  }
}

async function runBooleanCheck(
  id: DoctorCheckId,
  deadline: number,
  now: () => number,
  action: () => Promise<boolean>,
  success: readonly [code: string, message: string],
  failure: readonly [code: string, message: string, remediation: string],
): Promise<DoctorCheck> {
  if (now() >= deadline) return timedOut(id);
  try {
    return (await action()) ? passed(id, ...success) : failed(id, ...failure);
  } catch {
    return failed(id, ...failure);
  }
}

function passed(id: DoctorCheckId, code: string, message: string): DoctorCheck {
  return { id, status: 'passed', code, message, remediation: null };
}

function failed(
  id: DoctorCheckId,
  code: string,
  message: string,
  remediation: string,
): DoctorCheck {
  return { id, status: 'failed', code, message, remediation };
}

function timedOut(id: DoctorCheckId): DoctorCheck {
  return failed(
    id,
    'DIAGNOSTIC_DEADLINE_EXCEEDED',
    'The overall diagnostic deadline was exceeded.',
    'Resolve earlier failed checks or increase BROWSERMESH_TIMEOUT_MS, then run the doctor again.',
  );
}
