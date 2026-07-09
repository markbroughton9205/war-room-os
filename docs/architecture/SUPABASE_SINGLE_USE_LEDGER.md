# Phase 46M - Supabase-Backed Single-Use Ledger

46M replaces the 46L file-backed development ledger with a Supabase-backed implementation suitable for shared serverless deployment review.

## Scope

46M adds:

- `SupabaseSingleUseLedger`
- `createSupabaseSingleUseLedger`
- table-scoped row mapping for `auto_mode_single_use_ledger`
- atomic conditional consume operations
- duplicate packet, nonce, receipt, rollback packet, and rollback receipt error mapping

46M does not add:

- API routes
- UI wiring
- background jobs
- provider calls
- Apple credentials
- iCloud credentials
- OAuth
- new live actions
- message sending
- deployments

The only live action type remains `mark_apple_reminder_read`.

## Required Table

The production Supabase table must be:

`auto_mode_single_use_ledger`

The table must enforce unique constraints or unique indexes for:

- `packet_id`
- `nonce`
- non-null `receipt_id`
- non-null `rollback_packet_id`
- non-null `rollback_receipt_id`

The adapter maps between the TypeScript ledger shape and the table's snake-case columns.

## Atomic Consume Pattern

The consume path uses one database update as the authoritative claim operation:

`UPDATE auto_mode_single_use_ledger SET status = consumed, consumed_at = now, receipt_id = receipt WHERE packet_id = packetId AND nonce = nonce AND status = issued AND expires_at > now RETURNING *`

Rollback consume uses the same pattern with:

`rollback_packet_id`, `rollback_receipt_id`, `rollback_issued`, and `rollback_consumed`.

This is the single-use boundary. Concurrent attempts must race against the same database row state. Exactly one attempt can move `issued -> consumed`; all later attempts must observe `already_consumed`, `receipt_replay`, `expired`, `nonce_mismatch`, `packet_not_found`, or `ledger_write_conflict`.

## Constraint Error Mapping

Supabase/Postgres error code `23505` is treated as a uniqueness violation.

- duplicate packet insert maps to `duplicate_packet`
- duplicate nonce insert maps to `duplicate_nonce`
- duplicate receipt update maps to `receipt_replay`

Other insert errors map to `write_failed`.

Other consume errors map to `consume_failed`.

## Server-Only Boundary

`createSupabaseSingleUseLedger` uses the existing server-only Supabase admin client. It requires the service-role Supabase secret on the server and must not be imported from client components.

## Live Wiring

`createLiveAppleReminderLedgerReceiptVerifier` (`LiveAppleReminderLedgerReceiptVerifier.ts`) composes `AppleReminderLedgerReceiptVerifier` with `createSupabaseSingleUseLedger()`. This is the live path: `AppleReminderLedgerReceiptVerifier` itself takes its ledger by constructor injection and remains ledger-agnostic, so this factory is additive, not a change to the verifier's default behavior.

This wiring is intentionally isolated in its own file rather than added to `AppleReminderLedgerReceiptVerifier.ts` directly, so that code using the verifier with `InMemoryDurableSingleUseLedger` or `FileBackedSingleUseLedger` (all existing tests and local/dev usage) does not transitively pull in the Supabase admin client or its server-only requirement.

The adapter is wired into the receipt verifier's live path. It is still not wired into UI, live chat, Apple Shortcut execution triggering, or API routes -- nothing calls `createLiveAppleReminderLedgerReceiptVerifier` yet. That remains separate future work.

## Gate 12 Requirement

Claude Code must independently validate Gate 12 against the real Supabase table using clearly prefixed test data and guaranteed cleanup.

The independent Gate 12 stress test must:

- insert a clearly prefixed test ledger entry
- launch concurrent consume attempts against the same packet
- confirm exactly one successful consume
- confirm all other attempts are correct rejections
- verify the table row reflects exactly one consumed receipt
- clean up every test row by prefix
- avoid touching real production ledger entries

Do not reuse this package's validation harness for the authoritative Gate 12 result.

## Changelog

- **2026-07-09** (`a401361`) -- Initial 46M implementation: `SupabaseSingleUseLedger`, atomic conditional consume, constraint error mapping. Independently verified: stale `approval_id` field found and removed from `types.ts`/`entryToRow()`/`rowToEntry()` (code bug, not a missing production column), then Gate 12 verified against the real production table -- 10 runs x 20 concurrent attempts, exactly 1 success per run, cleanup confirmed after every run.
- **2026-07-09** -- Added `createLiveAppleReminderLedgerReceiptVerifier`, wiring the adapter into `AppleReminderLedgerReceiptVerifier` as the live path (see "Live Wiring" above). No route, UI, chat, or Shortcut-execution wiring added.
