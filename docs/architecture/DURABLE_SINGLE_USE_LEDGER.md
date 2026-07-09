# Phase 46L - Durable Single-Use Ledger + Live Feature Prep

46L closes the 46K replay gap before adding any new live power.

This is the first real durable write path in the 46-series, but it is intentionally file-backed only for local development and single-server validation.

## Scope

46L adds:

- durable single-use ledger types
- injected ledger interface
- file-backed implementation
- in-memory test implementation for focused negative controls
- packet, receipt, nonce, rollback packet, and rollback receipt consume checks
- Gate 11 durable replay validation
- disabled future live feature registry

46L does not add a new live action. The only executable live action remains:

`mark_apple_reminder_read`

## Atomic Consume

Receipt verification must consume the ledger before returning `verified_clean`.

The file-backed implementation rewrites the ledger JSON file only when:

- packet id matches
- nonce matches
- status is `issued`
- `expiresAt` is still in the future

The state transition is `issued -> consumed`. A second consume attempt cannot satisfy the same status condition.

Rollback packets use the same pattern: `rollback_issued -> rollback_consumed`.

The write path creates the ledger directory, writes a temporary JSON file, then renames the temp file over the durable ledger file.

Concurrent file access is guarded by an atomic lock directory. Normal lock acquisition uses exclusive directory creation. Stale lock reclamation uses an atomic rename of the lock directory before cleanup, avoiding a separate delete-then-create race.

## Production Durability Warning

This 46L ledger is DEV/SINGLE-SERVER-ONLY in its current form.

The file-backed ledger is not production-safe on Vercel or any serverless deployment model with ephemeral, non-shared filesystem storage. Vercel serverless invocations and cold starts can run on separate instances, and `/tmp` storage is not a durable shared ledger across those invocations. A file-based ledger therefore cannot provide cross-invocation replay protection, cross-instance single-use guarantees, or production-grade durability on that platform.

Supabase-backed persistence in Phase 46M is a REQUIRED prerequisite before this ledger can be used in any real production deployment. It is not an optional enhancement, nice-to-have roadmap item, or later convenience layer. Until 46M replaces the file-backed ledger with a shared durable store, 46L must be treated as a local/dev proof of ledger semantics only.

## Live Feature Registry

Future actions are registered but disabled:

- `mark_apple_reminder_unread`
- `create_apple_reminder_draft_packet`
- `add_apple_note_draft_packet`
- `create_calendar_event_draft_packet`
- `create_text_message_draft_packet`

`create_text_message_draft_packet` is draft-only and `sendsMessage: false`. It must never send iMessage/SMS, contact a recipient, or trigger message delivery.

## Boundaries

46L does not:

- store Apple credentials
- store iCloud credentials
- add OAuth
- use Google Tasks or Google Calendar
- call providers
- write memory
- mutate repo state
- send messages
- deploy
- create API routes
- add UI wiring
- add background jobs
- write Supabase

Supabase remains out of scope for 46L and is deferred to 46M.

## Gate 11

Gate 11 proves:

- first valid packet consume succeeds
- packet replay is rejected
- receipt replay is rejected
- nonce replay is rejected
- fresh verifier replay is rejected
- fresh file-backed ledger instance rejects replay after reading from disk
- concurrent consume allows one success max
- repeated 20-way file-backed consume races produce exactly one success and nineteen rejections
- expired packets fail closed
- rollback packet and receipt replay are rejected
- verifier cannot return `verified_clean` unless ledger consume succeeds

## Future

46M must add Supabase-backed ledger storage before any production use of this single-use ledger.
