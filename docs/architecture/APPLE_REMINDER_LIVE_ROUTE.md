# Phase 46N - Apple Reminder Live Route (Commander-Triggered)

46N gives the 46K-46M stack its first real caller: a Commander-triggered route that issues a packet, returns the Shortcut URL, and later verifies the pasted-back receipt against the live Supabase ledger. Nothing in 46K, 46L, or 46M is modified.

This stays manual and Commander-triggered only. It is not live Auto Mode.

## Scope

46N adds:

- `lib/council/apple-reminder-live-route/` (types, handler, validation)
- `POST /api/council/apple-reminder-live`
- `AppleReminderLiveBridgePanel` in the Operator Command Deck
- two commands: `issue_apple_reminder_packet`, `submit_apple_reminder_receipt`

46N does not add:

- a receipt callback endpoint (Shortcut still cannot call War Room directly)
- QR code rendering (deliberately deferred -- see UX Gap below)
- chat-decree parsing (no free-text approval parsing exists or is added)
- Apple/iCloud credentials, OAuth
- Auto Mode of any kind
- new live action types beyond `mark_apple_reminder_read`

## Trigger: UI button, not chat

No existing pipeline parses free-text chat into an `ExplicitExecutionApproval`-shaped object -- `/api/grok/chat` is a raw single-turn passthrough with no approval semantics. Building that parser would be new, non-trivial infrastructure. 46N instead reuses the Operator Command Deck's already-live pattern (`window.confirm` -> `fetch` POST), same rigor, zero new parsing surface.

## Required Environment Flags

```env
WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE=false
WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION=false
```

Both default false. Both must be `true` before the route will construct an approval, create a packet, or touch the ledger. Either missing or false -> `blocked`, zero ledger writes, audit record produced. Matches Phase 46H's route-flag shape exactly (`lib/council/approved-provider-route/handler.ts`).

## Session Auth

Not route-specific. Global middleware (`middleware.ts` -> `lib/supabase/middleware.ts` `updateSession()`) 401s every `/api/*` request without a Supabase session unless explicitly exempted. `/api/council/apple-reminder-live` is not in `PUBLIC_API_PATHS`/`PUBLIC_API_PREFIXES` and must not be added to either list.

## Approval Construction

The route constructs `AppleReminderExplicitBridgeApproval` server-side on `issue_apple_reminder_packet` -- there is no free-text approval parsing. Fixed exact-approved-text constant: `I APPROVE MARKING THIS APPLE REMINDER READ`. Fresh `approvalId`/`nonce` per request (`crypto.randomUUID()`). Passed through the existing, unmodified `AppleReminderActionPacketFactory` from 46K, which enforces every rule it already enforced (bridge-enabled policy, single reminder, exact text match, real Auto Mode hard-false, etc.).

## Two Commands

**`issue_apple_reminder_packet`** (`{ reminderId, confirmed: true }`): flag check -> build approval -> `AppleReminderActionPacketFactory().create(...)` -> on success, `ledger.issuePacket(ledgerEntryFromApplePacket(packet))` against the live Supabase ledger -> `AppleShortcutBridgeUrlBuilder().buildManualUrl(packet)` -> returns `{ packet, shortcutUrl }`. Fails closed before any ledger write if flags/confirmation/reminderId/policy checks fail.

**`submit_apple_reminder_receipt`** (`{ packet, receiptText }`): the client resends the packet it received from the issue step (packets are self-contained and carry no secrets, matching 46K's design -- nothing new is persisted server-side to avoid this). `AppleShortcutReceiptParser().parse(receiptText)` -> `AppleReminderLedgerReceiptVerifier.verifyWithLedger({ packet, receipt, now })` against the live Supabase ledger (via `createLiveAppleReminderLedgerReceiptVerifier()`, wired in the prior session).

Both commands share one dependency-injected handler (`handleAppleReminderLiveCommand`) that takes `ledger`/`receiptVerifier` as required options -- no Supabase import inside the handler itself, so Gate 13 tests run via plain `tsx` with an injected `InMemoryDurableSingleUseLedger`, no `server-only` shim needed. `route.ts` supplies the live Supabase instances.

## UX Gap: `shortcuts://` Needs an iPhone

`shortcuts://run-shortcut?...` is an iOS URL scheme. It does nothing when opened from a desktop browser. The panel shows the URL as copyable text with an explicit instruction to send it to the iPhone (AirDrop/Messages) and open it in Safari there. **QR code rendering was deliberately not implemented in this pass** -- a hand-rolled QR encoder risks silent, hard-to-detect scan failures (wrong error-correction encoding, wrong matrix placement) that would be worse than no QR code at all, giving false confidence. If the copy/AirDrop flow proves too friction-heavy in practice, a QR code via a reviewed library (not hand-rolled) is a reasonable follow-up, not a blocker for this phase.

## Receipt Round-Trip: Manual Paste-Back, Not a Callback Endpoint

`APPLE_REMINDERS_SHORTCUT_BRIDGE.md` states plainly: "There is no short-lived server endpoint in 46K. There is no callback endpoint in 46K." Adding one now would be a real, unreviewed attack-surface expansion (a new necessarily-unauthenticated ingress, since the Shortcut cannot carry a session cookie). 46N keeps the boundary: the Shortcut shows/copies the receipt JSON on-device, the Commander pastes it into the panel, `submit_apple_reminder_receipt` completes the loop. This is real, working verification -- just not automatic. A dedicated receipt-callback endpoint is reasonable future work if the manual flow proves too tedious, not something this phase claims to have already solved.

## Gate 13 Requirement

`lib/council/apple-reminder-live-route/validation.ts` (`runAppleReminderLiveRouteValidation`) covers, against an injected in-memory ledger:

- both flags off -> blocked, zero ledger writes
- route flag only -> blocked
- execution flag only -> blocked
- not confirmed -> blocked
- missing reminderId -> blocked
- unrecognized request shape -> blocked
- valid confirmed issue -> packet + Shortcut URL + issued ledger row
- receipt submit without the original packet -> blocked
- malformed receipt text -> blocked
- valid receipt against the issued packet -> `verified`
- replayed receipt -> rejected

This suite intentionally does not touch the real Supabase table -- it proves the route's own logic (flag gating, approval construction, command routing) using the same `InMemoryDurableSingleUseLedger` already proven in Gate 11. A live-database check against the actual route handler (same protocol as Gate 12) is a separate, explicit step, not folded into this suite, so it never runs by accident.

## Rollback

1. Set `WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION=false` (immediate; route blocks before any ledger write).
2. If needed, also set `WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE=false`.
3. Confirm the route returns `blocked` and zero ledger writes occur.
4. If code rollback is needed, remove only the 46N package/route/UI files -- nothing in 46K/46L/46M is touched or required to change.

## Status

Built and statically validated in this session. Not yet committed. Live-database verification against the real route handler (Gate 12 protocol) intentionally withheld pending review of this implementation before deciding whether to keep it as-is, revise it, or rebuild parts of it.
