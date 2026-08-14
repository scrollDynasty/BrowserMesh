# Concurrency and lifecycle

## One queue per session

All operations touching live browser state pass through that session's serial queue. Reads do not bypass an in-progress write. The accepted order is deterministic.

Different sessions use different queues and may execute concurrently. BrowserMesh does not use one global browser-operation mutex.

## Deadlines and recovery

`timeoutMs` defaults to `BROWSERMESH_TIMEOUT_MS` and is bounded to 300,000 ms. The deadline starts when the runtime accepts the operation, so time spent waiting in the queue counts. Cancellation propagates through MCP into the queued or active operation.

A rejected, failed, cancelled, or timed-out operation does not poison the queue. Later accepted work can continue.

## Close and shutdown

Session close is idempotent. Once closing begins, new work is rejected; accepted work drains according to lifecycle rules before context cleanup. Process shutdown prevents new work and closes owned resources.

An unexpected Chromium disconnect marks affected sessions failed and invalidates handles. Existing live sessions are never silently reconstructed.
