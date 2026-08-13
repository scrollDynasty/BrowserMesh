# ADR 0010: Collect bounded, redacted browser observability

Status: Accepted

The Playwright adapter captures console, page-error, request, response, and request-failed metadata
into per-page bounded ring buffers owned by the runtime. Reads require explicit `sessionId` and
`pageId`; cursor pagination uses opaque monotonically ordered event IDs and reports `nextCursor` and
`droppedCount`. A checkpoint is a non-destructive cursor. Events never cross page/session ownership.

Configuration sets hard upper bounds for events per page, string length, page size, and total
serialized response bytes. Overflow evicts oldest events and increments `droppedCount`. URLs lose
credentials/fragments and redact sensitive query values. Headers, bodies, cookies, storage, console
object serialization, and raw stacks are excluded. Console/error text is bounded and redacted, with
metadata-only reads available.

Listeners attach once per page and detach on page/context close, failed creation, disconnect, and
shutdown. Observability reads follow normal session serialization so they do not race teardown.
Body capture, HAR, tracing, and telemetry export are separate future contracts.
