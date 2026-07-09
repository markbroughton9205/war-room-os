# Phase 46K - Apple Reminders Shortcut Bridge

Phase 46K connects the proven 46J gate shape to one real, low-stakes iPhone target:

`mark_apple_reminder_read`

This is not global Auto Mode. It is not server-side Apple Reminders control. It is not background automation.

## Transport Decision

46K uses a fully self-contained base64url JSON packet in the Apple Shortcut URL:

```text
shortcuts://run-shortcut?name=War%20Room%20Mark%20Reminder%20Read&input=text&text=<base64url-json-payload>
```

The payload shape is:

```ts
type AppleShortcutInputPayload = {
  kind: 'war_room_apple_reminder_action_packet'
  packet: AppleReminderActionPacket
}
```

There is no short-lived server endpoint in 46K. There is no callback endpoint in 46K.

## Single-Use Limitation

The packet encodes `singleUse: true`, a packet id, a nonce, and an expiration time. The receipt verifier rejects mismatched packet ids, approval ids, nonce values, reminder targets, Shortcut names, background execution, and receipts created after expiration.

However, because 46K does not create a server endpoint or durable nonce ledger, it cannot globally prevent packet replay by state alone. It can validate receipts and reject mismatches, but true durable replay prevention requires a later stateful ledger phase.

This limitation is intentional and compliant with 46K's no-endpoint, no-storage, no-background-execution boundary.

## Replay Protection Limitation

46K has no replay protection at any level.

`AppleReminderReceiptVerifier` is fully stateless: it holds no fields and no in-memory consumed-nonce or consumed-approval tracking of any kind. Verification is a pure function of the packet and receipt it is given.

This means a captured valid receipt replays as `verified_clean` indefinitely -- not only across process restarts or redeploys, but even against the exact same verifier instance, called repeatedly, with no reset in between. There is no weaker "single-process" or "process-local" protection to fall back on; this was an earlier, incorrect claim about this limitation and has been corrected here.

46K intentionally introduces no persistence layer, so this is expected, not a defect.

Durable replay protection is deferred to a future phase.

The validation case `negative_replay_after_stateless_verifier_reset` documents this limitation: the same otherwise valid receipt verifies clean when checked again by a separate, fresh verifier instance. That case demonstrates the limitation across instances; it does not by itself prove the same-instance case, but the verifier's statelessness (no fields at all) makes the same-instance and cross-instance behavior identical by construction. This is the expected 46K limitation, not replay protection and not a strong replay-security guarantee.

## Why Apple Reminders First

Apple Reminders is chosen before Google Tasks because this bridge can keep execution local to Mark's iPhone through a manually triggered Shortcut without adding OAuth, Google APIs, Apple private APIs, or server-side device control.

## Boundaries

46K does not:

- store Apple ID credentials
- store iCloud credentials
- ask for Apple credentials
- use private Apple APIs
- mutate Apple Reminders from server code
- create, delete, edit, move, export, or bulk-complete reminders
- use Google Tasks or Google Calendar
- call providers
- call Supabase
- write memory
- mutate repo state
- send notifications or messages
- create API routes
- wire into chat or UI
- enable global real Auto Mode

## Policy

`AppleRemindersBridgePolicy` defaults disabled unless explicit policy input enables:

- `iphoneShortcutBridgeEnabled`
- `appleRemindersBridgeEnabled`
- `allowedLiveActionTypes: ['mark_apple_reminder_read']`

`realAutoModeEnabled` remains hard false.

Server-side Apple credentials, direct server mutation, and background automation remain hard false.

## Approval Reuse

46K uses the same approval doctrine as earlier execution phases:

- exact approved text
- single action
- single target
- single-use nonce
- expiring approval
- no bundled actions
- no implied approval
- no duck-typed approval
- blocked signals win

The phase-specific approval type is `AppleReminderExplicitBridgeApproval`.

## Receipt Verification

The Shortcut receipt must prove:

- packet id matches
- approval id matches
- explicit approval id matches
- nonce matches
- Shortcut name is `War Room Mark Reminder Read`
- device kind is `iphone`
- execution was manual
- background automation was not used
- reminder id matches
- action is `mark_apple_reminder_read`
- target is `apple_reminders`
- one reminder only
- before state was read successfully
- after state was read successfully
- before state was incomplete
- after state is completed
- changed paths claimed are allowed
- changed paths claimed are proven by before/after observation
- receipt was created before packet expiration

The verifier does not trust `receiptStatus: completed` or `mutation.succeeded` alone.

## Rollback

Rollback is also Shortcut-mediated.

War Room can prepare a rollback packet. Mark manually runs a rollback Shortcut. The rollback receipt must include read-after-rollback observation proving the reminder is incomplete/open again.

Rollback self-report alone is insufficient.

## Validation

46K includes:

- positive packet creation
- positive receipt verification
- positive rollback verification
- 30 negative controls
- Gate 9 claim-vs-reality regression
- Gate 10 Apple Shortcut Bridge validation

## Future Roadmap

46L may introduce a different one-action adapter, still gated.

46M may add a review panel for receipts and rollback history.

46L / 46M must introduce durable replay protection before any server-side OAuth, REST execution, or additional live Auto Mode actions.

Acceptable future implementations include a persistent single-use ledger, durable nonce registry, or persistent consumed approval registry. None of these are implemented in 46K.

46N may add an approved action queue with manual release.

46O may consider limited live Auto Mode only after repeated bridge proof.

## Changelog

- **2026-07-08** (`1645940`) -- Initial 46K implementation: packet/receipt/rollback bridge, 10 gates, 31 negative controls, independent validation.
- **2026-07-09** (`89e2b1d`) -- Fix: corrected this doc's Replay Protection Limitation section and the `negative_replay_after_stateless_verifier_reset` description, which still read "process-local only... does not survive process restart." Re-validation (empirical same-instance repeat verification, plus full gate/negative-control re-run) confirmed `AppleReminderReceiptVerifier` is fully stateless with zero replay protection at any level, including repeated calls on the same instance in the same process. No behavior change; documentation accuracy only.
