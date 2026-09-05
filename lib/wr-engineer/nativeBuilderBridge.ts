/**
 * WR-Engineer <-> Native Builder proposal bridge.
 *
 * INCOMPATIBILITY FOUND (reported per mission brief, before writing any new bridge logic): there is
 * no existing, non-test-fixture, exported function anywhere in lib/native-builder that accepts an
 * already-fully-formed NativeRepairProposal/StructuredPatch from an external caller and attaches it
 * to a repair as `selectedProposal`. `planRepair()` always generates the proposal itself
 * (deterministic template, local model, or a live hosted-model text-completion parsed by
 * `repairPlanner.ts`'s private `tryParseModelProposal`) — every path independently reads the
 * CURRENT file content and computes `expectedOriginalHash`/verifies `matchText` occurs exactly
 * once itself; nothing lets a caller hand in pre-computed values and skip that. That check is the
 * anti-stale-file protection `patchApplier.ts` relies on, and it is deliberately not something an
 * external proposal (however well-formed) can bypass.
 *
 * SAFE REUSE CHOSEN: rather than hand-writing a repair record that trusts WR-Engineer's own
 * hash/matchText claims (the unsafe shortcut), this bridge:
 *   1. Reuses `reportIssue()` (real, exported, existing) to create the issue + initial
 *      'detected'/'collecting_evidence' repair — zero new issue-tracking logic.
 *   2. Independently RE-VERIFIES every planned change against LIVE repository content (fresh
 *      `readRepoFile()` calls) — recomputing `expectedOriginalHash` and re-checking `matchText`
 *      appears exactly once, exactly like `tryParseModelProposal` does, but for a caller-supplied
 *      proposal instead of parsed model text. WR-Engineer's own claimed hash is NEVER trusted.
 *   3. Runs the result through `validatePatchPolicy()` (real, exported, existing) — a proposal that
 *      fails structural policy is rejected, never persisted as ready-to-apply.
 *   4. Only once both checks pass, advances the repair through the exact same
 *      NATIVE_REPAIR_TRANSITIONS graph native-builder itself enforces (self-checked here against
 *      that same exported table) to 'awaiting_local_execution_approval' — NEVER further. Applying,
 *      validating, verifying, resolving, and rolling back remain 100% native-builder's own,
 *      unmodified `approveAndApply` / `commanderResolve` / `rollbackNow`, reached only through the
 *      existing, already-gated `/api/native-builder/repairs/{id}/approve` route (and siblings).
 *
 * `sourceKind: 'hosted_model'` is reused (not extended with a new union member) deliberately: adding
 * a new `NativeProposalSourceKind` literal would be a shared-type change to lib/native-builder/types.ts
 * with no visibility into every exhaustive switch elsewhere in the codebase that might depend on
 * that union being closed — exactly the kind of unrelated blast radius this phase avoids. `'hosted_model'`
 * is the closest honest fit (an external, sophisticated proposer, not a local template or model);
 * `proposerId: 'wr-engineer'` carries the specific, honest attribution instead.
 */
import { createHash } from 'node:crypto'
import { issueFromCommanderReport } from '@/lib/native-builder/issueIngest'
import { reportIssue } from '@/lib/native-builder/runtime'
import { listRepairsForIssue, saveRepair } from '@/lib/native-builder/storage'
import { readRepoFile } from '@/lib/native-builder/repositoryInspector'
import { validatePatchPolicy } from '@/lib/native-builder/patchPolicy'
import {
  NATIVE_REPAIR_TRANSITIONS,
  type NativeIssueRecord,
  type NativeRepairProposal,
  type NativeRepairRecord,
  type NativeRepairState,
  type StructuredPatch,
} from '@/lib/native-builder/types'
import type { WrEngineerEditProposal } from './codeEditProposals'
import { logWrEngineerAudit } from './audit'
import { engineeringMemory } from './memory/store'
import type { EngineeringMemoryStore } from './memory/types'

export type BridgeRejectionReason =
  | { file: string; reason: 'match_text_not_found' }
  | { file: string; reason: 'match_text_not_unique'; occurrences: number }
  | { file: string; reason: 'file_already_exists_for_create' }
  | { file: string; reason: 'file_missing_for_delete' }
  | { file: string; reason: 'delete_requires_commander_confirmation' }
  | { file: string; reason: 'read_failed'; detail: string }
  | { reason: 'policy_violation'; violations: unknown }

export type BridgeOutcome =
  | { accepted: true; issue: NativeIssueRecord; repair: NativeRepairRecord }
  | { accepted: false; issue: NativeIssueRecord; rejections: BridgeRejectionReason[] }

export type BridgeIssueMeta = {
  title: string
  description: string
  subsystem: string
  severity?: 'low' | 'medium' | 'high'
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Re-derives every hash/matchText claim from LIVE content — this is the load-bearing safety step;
 * see this file's header. Never trusts `patch.expectedOriginalHash` as supplied by the caller. */
async function reverifyPatch(patch: StructuredPatch): Promise<{ patch: StructuredPatch; rejection?: BridgeRejectionReason }> {
  if (patch.operation === 'create_file') {
    const existing = await readRepoFile(patch.file)
    if (existing.ok) return { patch, rejection: { file: patch.file, reason: 'file_already_exists_for_create' } }
    return { patch }
  }

  if (patch.operation === 'delete_file') {
    if (!patch.commanderConfirmed) {
      return { patch, rejection: { file: patch.file, reason: 'delete_requires_commander_confirmation' } }
    }
    const existing = await readRepoFile(patch.file)
    if (!existing.ok) return { patch, rejection: { file: patch.file, reason: 'file_missing_for_delete' } }
    return { patch }
  }

  // replace_range / insert_after / insert_before — all require matchText found exactly once.
  const current = await readRepoFile(patch.file)
  if (!current.ok) return { patch, rejection: { file: patch.file, reason: 'read_failed', detail: current.error } }
  const matchText = patch.matchText ?? ''
  if (!matchText || !current.content.includes(matchText)) {
    return { patch, rejection: { file: patch.file, reason: 'match_text_not_found' } }
  }
  const occurrences = current.content.split(matchText).length - 1
  if (occurrences !== 1) {
    return { patch, rejection: { file: patch.file, reason: 'match_text_not_unique', occurrences } }
  }

  return { patch: { ...patch, expectedOriginalHash: sha256(current.content) } }
}

function checkedTransition(repair: NativeRepairRecord, next: NativeRepairState, note: string): NativeRepairRecord {
  const allowed = NATIVE_REPAIR_TRANSITIONS[repair.state]
  if (!allowed.includes(next)) {
    throw new Error(`WR-Engineer bridge: illegal native-builder transition ${repair.state} -> ${next}`)
  }
  const at = new Date().toISOString()
  return { ...repair, state: next, history: [...repair.history, { state: next, at, note }], updatedAt: at }
}

/**
 * The one entry point: hands a WrEngineerEditProposal to Native Builder's existing repair
 * lifecycle, terminating at 'awaiting_local_execution_approval' — never past it. Returns a clear
 * rejection (never a partially-persisted, half-verified record) if any planned change fails
 * re-verification or structural policy.
 */
export async function bridgeProposalToNativeBuilder(
  proposal: WrEngineerEditProposal,
  issueMeta: BridgeIssueMeta,
  memory: EngineeringMemoryStore = engineeringMemory,
): Promise<BridgeOutcome> {
  const { issue, repair: freshRepair } = await reportIssue(issueFromCommanderReport(issueMeta))

  let repair = freshRepair
  if (!repair) {
    const existingRepairs = await listRepairsForIssue(issue.id)
    repair = existingRepairs.find(r => r.state !== 'resolved' && r.state !== 'cancelled') ?? null
  }
  if (!repair) {
    throw new Error(`WR-Engineer bridge: reportIssue produced no actionable repair for issue ${issue.id}`)
  }

  const rejections: BridgeRejectionReason[] = []
  const verifiedPatches: StructuredPatch[] = []
  for (const change of proposal.plannedChanges) {
    const { patch, rejection } = await reverifyPatch(change.patch)
    if (rejection) rejections.push(rejection)
    else verifiedPatches.push(patch)
  }

  if (rejections.length > 0) {
    await logWrEngineerAudit('native-builder bridge: proposal rejected at re-verification', {
      issueId: issue.id, repairId: repair.id, rejections,
    })
    return { accepted: false, issue, rejections }
  }

  const finalProposal: NativeRepairProposal = {
    issueId: issue.id,
    sourceKind: 'hosted_model',
    proposerId: 'wr-engineer',
    diagnosis: proposal.diagnosis,
    confidence: proposal.confidence,
    relevantFiles: proposal.relevantFiles,
    plannedChanges: proposal.plannedChanges.map((c, i) => ({ ...c, patch: verifiedPatches[i] })),
    validations: [],
    risks: proposal.risks,
    rollbackPlan: proposal.rollbackPlan,
    generatedAt: new Date().toISOString(),
  }

  const policyResult = validatePatchPolicy(finalProposal)
  if (!policyResult.ok) {
    rejections.push({ reason: 'policy_violation', violations: policyResult.violations })
    await logWrEngineerAudit('native-builder bridge: proposal rejected by patch policy', {
      issueId: issue.id, repairId: repair.id, violations: policyResult.violations,
    })
    return { accepted: false, issue, rejections }
  }

  let advanced = repair
  advanced = checkedTransition(advanced, 'inspecting_repository', `WR-Engineer bridge (proposal ${proposal.id}): repository re-inspected for re-verification.`)
  advanced = checkedTransition(advanced, 'planning', `WR-Engineer bridge (proposal ${proposal.id}): externally-authored proposal accepted after independent hash/matchText re-verification.`)
  advanced = {
    ...advanced,
    proposals: [...advanced.proposals, finalProposal],
    selectedProposal: finalProposal,
    policyResult,
  }
  advanced = checkedTransition(advanced, 'awaiting_local_execution_approval', `WR-Engineer bridge (proposal ${proposal.id}): ready for Commander approval via the existing native-builder /approve path.`)

  await saveRepair(advanced)
  await logWrEngineerAudit('native-builder bridge: proposal attached, repair awaiting Commander approval', {
    issueId: issue.id, repairId: advanced.id, proposalId: proposal.id,
  })
  await memory.record({
    category: 'DECISION',
    summary: `WR-Engineer proposal ${proposal.id} bridged into native-builder repair ${advanced.id}`,
    detail: `issue=${issue.id} repair=${advanced.id} files=${finalProposal.relevantFiles.join(', ')}. Apply/validate/rollback remain native-builder's own gated pipeline — this bridge only attaches the proposal.`,
    epistemicStatus: 'OBSERVED',
    relatedRefs: [issue.id, advanced.id, proposal.id],
    tags: ['native-builder-bridge'],
  })

  return { accepted: true, issue, repair: advanced }
}

/** Explicit, load-bearing negative — mirrors codeEditProposals.ts's WR_ENGINEER_CANNOT_WRITE_FILES.
 * This bridge never calls approveAndApply/commanderResolve/rollbackNow; those remain reachable only
 * through native-builder's own existing, already-gated API routes. */
export const WR_ENGINEER_BRIDGE_NEVER_APPLIES = true as const
