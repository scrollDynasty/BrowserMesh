# ADR 0004: Filesystem Playwright storage-state persistence

Status: Accepted

Persistence saves supported cookies and localStorage, then creates a new context from that state. Live contexts are never serialized. State names are validated rather than interpreted as paths, files are private and atomically replaced, and the data directory is excluded from Git because state may contain credentials.
