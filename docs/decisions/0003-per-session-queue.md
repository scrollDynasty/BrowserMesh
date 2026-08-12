# ADR 0003: Per-session serial queues

Status: Accepted

Each session owns an independent promise queue. Browser-changing work submitted to one session is deterministic, including lifecycle close; work for different sessions proceeds concurrently. A global mutex was rejected because it would defeat the product's parallel-session guarantee.
