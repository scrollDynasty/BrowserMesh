# ADR 0009: Serialize deterministic waits and atomic action-and-wait operations

Status: Accepted

`browser_wait` is one passive, typed condition executed through the addressed session queue. It
requires `sessionId`, `pageId`, a bounded `timeoutMs`, and exactly one condition: URL exact/safe glob,
load state, locator state, or text presence/absence. Caller regular expressions and arbitrary
JavaScript are forbidden. Success returns the normalized satisfied condition and correlation data;
deadline expiry returns `OPERATION_TIMEOUT` and queue recovery is mandatory.

A passive wait must only observe state that can change independently of later work in the same
queue. Event-driven flows use `browser_action_and_wait`: within one queued operation the adapter
registers one typed navigation/response/popup/dialog waiter, performs one typed click/press action, and
waits under one shared deadline. It cleans up the waiter on every outcome. Parallel calls and queue
bypass are forbidden solutions to the action/wait deadlock.

A popup event transfers one opaque engine page handle to the runtime, which atomically enforces the
session page limit, assigns a managed non-default `pageId`, and closes the popup on overflow or
registration failure. Dialogs are handled in this same composite because their blocking event
lifetime makes later inspection unsafe: the caller supplies the expected type and accept/dismiss
decision, the adapter safely dismisses unexpected dialogs, and only bounded metadata is returned.

Wait matching and captured metadata are bounded and secret-safe. Cancellation follows ADR 0008.
Tests cover timeout recovery, accepted ordering, cancellation, cleanup, and cross-session
parallelism with real Chromium.
