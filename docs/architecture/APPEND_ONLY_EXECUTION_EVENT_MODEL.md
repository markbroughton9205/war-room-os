# Append-Only Execution Event Model

This is a design document only. Phase 46O-H does not implement this event model.

## Principle

Execution outcome facts should be recorded as new, immutable, append-only event rows.

Existing approval, packet, ledger, or execution rows should not receive mutable audit/outcome fields for later facts. A later fact should create a later event.

## Candidate Event Types

- `approval_consumed`
- `packet_issue_succeeded`
- `packet_issue_failed`
- `shortcut_execution_reported`
- `receipt_verified`
- `execution_verification_failed`

## Linking Model

Events should link by durable identifiers:

- `approvalId`
- `packetId`
- prior event id where applicable

This creates an ordered execution history without rewriting older facts.

## Future Operator Execution History

This append-only event model is a prerequisite for the future Operator execution-history phase.

That future phase can project these immutable facts into timelines, dashboards, and audit views without making old rows mutable.

## Rollback Events Not Included

`rollback_requested` and `rollback_verified` are not included in this phase.

They are reserved for a future phase after rollback behavior is actually implemented and validated. Phase 46O-H does not predeclare rollback states and does not add rollback machinery.
