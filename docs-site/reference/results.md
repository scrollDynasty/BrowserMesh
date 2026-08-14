# Returned data structures

## Session view

```ts
interface SessionView {
  sessionId: string;
  name?: string;
  status: 'creating' | 'ready' | 'closing' | 'closed' | 'failed';
  createdAt: string;
  lastActivityAt: string;
  metadata: Record<string, string>;
  restoredFromStateId?: string;
  contextSettings: BrowserContextSettings;
}
```

## Page view

```ts
interface PageView {
  pageId: string;
  sessionId: string;
  createdAt: string;
  url: string;
  isDefault: boolean;
}
```

## Saved state view

Contains only `stateId` and `createdAt`. Storage-state contents are never returned by list/save results.

## Operation correlation

Every accepted operation produces an opaque `operationId`. Use it to correlate safe logs and results; do not derive ordering or identity from its format.

## Snapshot result

Snapshot results include:

- `snapshot` and honest `contentFormat` (`aria-yaml` or `aria-yaml-fragment`);
- `partial` and optional short-lived `refs`;
- `appliedBounds`;
- `omissions` for tree controls/source limits;
- `pagination` with optional `snapshotId`, `nextCursor`, offset, and expiry;
- character/byte `truncation` counts.

## Observation page

Observation list results include `events`, nullable `nextCursor`, `droppedCount`, and `gap`. An overflowed ring buffer can create a gap; consumers must not assume lossless telemetry.

See [`contracts.ts`](https://github.com/scrollDynasty/multi-agent-browser-mcp/blob/master/src/adapters/mcp/contracts.ts) for the executable output schemas.
