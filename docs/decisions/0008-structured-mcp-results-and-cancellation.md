# ADR 0008: Use structured MCP results, truthful annotations, and cancellation

Status: Accepted

Every BrowserMesh tool will advertise an `outputSchema` and return matching `structuredContent`.
Successful JSON tools also return a concise compatibility text block; screenshots retain image
content and add structured metadata. IDs are direct fields, not JSON nested inside text. Safe errors
remain `isError: true` with stable `code`, bounded `message`, optional safe `details`, and correlation
metadata; raw causes and non-serializable values never cross MCP.

Every tool has a title and tested MCP annotations. Hints describe actual behavior only:
`readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` are client guidance, not
authorization. A behavior change must update its annotation contract in the same PR.

Long waits, doctor work, and future artifact operations accept MCP request cancellation. The adapter
maps cancellation into the application operation signal; ports receive an engine-independent
cancellation abstraction. Cancellation clears listeners/timers, attempts prompt supported engine
abort, and does not poison the session queue. MCP protocol cancellation is observed by the client as
cancellation/`AbortError`; a second tool result is not guaranteed. If an engine action cannot be
aborted, its queue slot remains occupied until the real action settles so later same-session work
cannot overtake it. A stable `OPERATION_CANCELLED` application error is reserved for cancellable
internal/pre-execution paths where a result can still be delivered. Progress is used only for
genuinely multi-step work with honest monotonic progress.
