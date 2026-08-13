# ADR 0017: Runtime-authoritative resource budgets

## Status

Accepted

## Context

MCP schema limits alone do not protect direct runtime consumers. Browser-derived text, screenshots,
and persisted storage state are also untrusted in size. Reading or encoding them without hard
budgets can consume excessive memory or disk, and per-file persistence locking cannot safely enforce
an aggregate quota across different state IDs.

## Decision

BrowserMesh owns centrally configured limits at the runtime/repository boundary:

- session names and metadata have character, UTF-8 byte, entry, and aggregate bounds; control
  characters and the dangerous object keys `__proto__`, `constructor`, and `prototype` are rejected
  before an ID, browser context, or page is allocated;
- visible text is truncated only on Unicode code-point and UTF-8 boundaries and reports original,
  returned, and applied bounds in structured MCP output;
- screenshots use CSS-pixel scale, are measured before capture, and are validated again from the
  returned PNG header. Per-dimension, total-pixel, and encoded-byte limits produce
  `LIMIT_EXCEEDED` without poisoning the session queue;
- saved states have count, per-state byte, and aggregate byte quotas. A repository-wide mutation
  queue makes quota check plus atomic replacement indivisible across state IDs. Loading checks the
  opened file size and performs a bounded read before JSON parsing.

MCP schemas mirror stable input limits for earlier feedback, but runtime and repository validation
remain authoritative. Effective budgets are exposed by `browser_runtime_info`; sensitive content is
not exposed.

## Consequences

Defaults allow normal browser workflows while preventing unbounded response, memory, and disk use.
Operators can lower or raise browser-derived and persistence budgets within validated configuration
ceilings. Replacement failure preserves the previous saved state, and failed captures or writes do
not prevent later operations.

BrowserMesh does not attempt to infer image safety from base64 length alone. It validates the PNG
dimensions produced by the engine after capture even when preflight succeeded, covering page changes
between measurement and capture.
