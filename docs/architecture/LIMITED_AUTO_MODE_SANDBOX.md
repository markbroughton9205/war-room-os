# Phase 46J - Limited Auto Mode Policy + Reversible Action Sandbox

Phase 46J creates the first limited autonomy boundary in the Council architecture without connecting it to live orchestration, real storage, providers, routes, UI, reminders, or external tools.

This phase is fake-sandbox-only. It proves policy shape, reversibility, kill-switch behavior, and claim-vs-reality verification before Phase 46K connects one real low-stakes adapter.

## Scope

Created module:

- `lib/council/auto-mode-sandbox/types.ts`
- `lib/council/auto-mode-sandbox/AutoModeEligibilityClassifier.ts`
- `lib/council/auto-mode-sandbox/AutoModeKillSwitch.ts`
- `lib/council/auto-mode-sandbox/FakeAutoActionSandbox.ts`
- `lib/council/auto-mode-sandbox/AutoModeRollbackManager.ts`
- `lib/council/auto-mode-sandbox/ClaimRealityVerifier.ts`
- `lib/council/auto-mode-sandbox/AutoModeSandboxExecutor.ts`
- `lib/council/auto-mode-sandbox/behaviorValidation.ts`
- `lib/council/auto-mode-sandbox/index.ts`

No live code imports this module.

## Structured Classifier Input

The classifier accepts structured action requests only:

```ts
type ActionRequest = {
  actionType: 'mark_reminder_read' | 'tag_memory' | 'summarize_text' | 'format_text' | string
  targetType: string
  targetId: string | null
  parameters: Record<string, unknown>
  bundledActions: ActionRequest[]
}
```

Raw commander text is not accepted as classifier input.

## Limited Allowlist

The only single-action auto-eligible requests in Phase 46J are:

- `mark_reminder_read`
- `tag_memory`
- `summarize_text`
- `format_text`

Each action must pass exact target, targetId, and parameter checks.

## Bundling Rule

If `bundledActions` is non-empty, every bundled action is checked independently. If any bundled action is not independently eligible, the entire request is rejected.

Even when all bundled actions are independently eligible, Phase 46J defaults the bundle to not auto-eligible. This avoids hidden scope expansion. Future phases may introduce explicit bundle policy, but 46J does not.

Duplicate bundled actions are rejected to prevent double-application.

## Sandbox Design

`FakeAutoActionSandbox` contains only in-memory fake records:

- reminders
- memory tag records
- generated artifacts
- audit events

It creates checkpoints before applying eligible actions. Applied actions are reversible through checkpoint restore.

There are no provider calls, network calls, database calls, filesystem writes, route handlers, UI changes, or live reminders integration in this phase.

## Rollback Mechanics

Every applied action gets:

- checkpoint
- rollback plan
- action audit event
- claim-vs-reality report

Rollback restores the fake sandbox records to the checkpoint snapshot and appends a rollback audit event.

No real data is changed.

## Kill Switch

`AutoModeKillSwitch` blocks otherwise eligible actions when engaged.

The kill switch must remain a hard boundary for future adapters. If it is engaged, no checkpoint or action application should occur.

## Gate 9 - Claim-Vs-Reality Verification

`ClaimRealityVerifier` compares execution claims against fake sandbox state:

- claimed `sandboxChanged`
- observed sandbox state change
- claimed applied action count
- observed applied audit count

If the execution result claims no change but the store changed, Gate 9 fails. This is intentionally modeled after the Phase 46I partial-write bug that independent verification caught.

Claude Code should validate Gate 9 with a fresh spy that does not reuse this module's own behavior validation harness.

## Required Classifier Cases

The behavior validation includes 20 classifier cases:

- 4 clean positives
- 4 clean negatives
- 8 near misses
- 4 bundling cases

## Nine Gates

The validation harness includes:

1. structured classifier cases
2. structured input only
3. no partial bundle application
4. kill switch blocks
5. reversible apply
6. rollback restores state
7. unsafe actions blocked
8. fake sandbox only
9. claim-vs-reality mismatch detection

## Phase 46K Readiness

Phase 46K can replace `FakeAutoActionSandbox` behind one adapter boundary for a single low-stakes real target: `mark_reminder_read`.

The 46J interfaces are intentionally shaped so that a real adapter can be introduced without changing classifier policy or claim-vs-reality validation.
