# ADR 0003: Per-session serial queues

Status: Accepted

Each session owns an independent promise queue. All operations that touch its live browser state, including read-style inspection, persistence capture, and lifecycle close, are deterministic. Work for different sessions proceeds concurrently. A rejected or timed-out operation does not poison later accepted work. A global mutex was rejected because it would defeat the product's parallel-session guarantee.
