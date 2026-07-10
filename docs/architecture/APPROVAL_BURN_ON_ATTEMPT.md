# Approval Burn-On-Attempt Policy

Phase 46O-H documents the approval lifecycle used by the Apple Reminder live packet route.

## Burn-On-Attempt Rule

Once an `ExplicitExecutionApproval` is consumed, it is never restored to `active`.

If downstream packet creation fails after a successful approval consume, the approval remains permanently consumed.

No refund, restore, or reactivation logic exists or should exist for consumed approvals.

A retry requires all of the following fresh records:

- a fresh `ExplicitExecutionApproval`
- a fresh packet
- fresh ledger/event rows

This prevents replay-style ambiguity where a downstream failure could accidentally make an already-spent approval reusable.

## Expiry Behavior

Approval expiry is lazy.

The database row is not automatically changed to `expired` at the wall-clock expiration moment. Expiry is checked during `consumeIfValid()`. If an approval is still `active` but `expires_at <= now()`, the consume attempt is rejected as `expired` and the row is marked `expired`.

Terminal states remain terminal:

- expired approvals cannot be consumed
- expired approvals cannot become active
- consumed approvals cannot become expired
- revoked approvals cannot become active
- repeated consume attempts on a terminal approval remain terminal

## Rate Limiting

Authenticated-route rate limiting is deferred to a dedicated future protection phase.

Phase 46O-H does not add route middleware or rate limiting. It adds malformed approvalId validation and telemetry categorization only.
