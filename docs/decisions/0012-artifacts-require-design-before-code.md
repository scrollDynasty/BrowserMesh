# ADR 0012: Require a controlled artifact contract before implementation

Status: Accepted

No HAR, trace, video, download, upload, or other filesystem-backed evidence feature may be
implemented until a follow-up artifact ADR defines and receives review for the exact capability.

That ADR must define logical `artifactId` addressing, runtime-owned private storage, media allow
lists, size/count/total quotas, checksums, creation/expiry, deterministic cleanup, access rules,
redaction, explicit sensitive-artifact enablement, cancellation, crash recovery, and safe MCP
metadata. Callers never choose local paths. Partial files must be atomic or removed, and logs must
not expose artifact contents or private paths.

External `runId` and `scenarioId` remain neutral correlation owned by the orchestration layer. They
do not become BrowserMesh principals, permissions, agents, or leases. Remote transport and internal
agent orchestration are not authorized by this decision.
