/**
 * WR-Engineer code-edit proposal interface.
 *
 * Deliberate architectural stance, not a gap: lib/native-builder is the ONE subsystem in this repo
 * allowed to actually write a file to disk (see lib/native-builder/types.ts's header — every other
 * repair-adjacent system here, e.g. lib/operator/selfRepair, lib/red-team-coder/repairPlanner,
 * lib/council-repair/model.ts, is deliberately advisory-only with `canExecute: false`). WR-Engineer
 * Phase 1 follows that same repo-wide convention: it PROPOSES structured, reviewable edits in
 * exactly native-builder's own StructuredPatch/NativeRepairProposal shape, and STOPS there. It
 * never imports lib/native-builder/patchApplier.ts (the sole module that calls writeFile) and never
 * gains a second filesystem-write path.
 *
 * This is intentional, not a placeholder to "finish later": a proposal produced here is directly
 * consumable by lib/native-builder's existing planning/apply pipeline (or by a human review) precisely
 * because it never diverges from that pipeline's own patch shape. What Phase 2+ can add is a bridge
 * that hands a WrEngineerEditProposal to native-builder's own gated apply path — never a parallel
 * writer.
 *
 * Covers mission brief item 2 (code editing: proposed file changes, controlled write/edit
 * interface) as "controlled" = advisory-only, structurally validated, never self-executing.
 */
import { randomUUID } from 'node:crypto'
import { validatePatchPolicy } from '@/lib/native-builder/patchPolicy'
import type {
  NativePlannedChange,
  NativeProposalConfidence,
  NativeRepairProposal,
  PatchPolicyResult,
  StructuredPatch,
} from '@/lib/native-builder/types'
import type { EpistemicStatus } from './types'

export type WrEngineerEditProposal = {
  id: string
  missionId: string
  diagnosis: string
  confidence: NativeProposalConfidence
  relevantFiles: string[]
  plannedChanges: NativePlannedChange[]
  risks: string[]
  rollbackPlan: string
  generatedAt: string
  /** Always OBSERVED-or-lower on generation — a freshly authored proposal has not been validated
   * or applied yet, so it must never be labeled OBSERVED as if it were a proven fix. */
  epistemicStatus: EpistemicStatus
  /** Structural policy check (path denylist, file-type denylist, max files/lines, malformed patch
   * shape) — the same check lib/native-builder itself runs before ever applying anything. Running
   * it here is advisory: it tells the proposer (and the Commander reviewing the proposal) whether
   * this would even be eligible for native-builder's apply path, without applying anything. */
  policyPreview: PatchPolicyResult
}

export type ProposeEditInput = {
  missionId: string
  diagnosis: string
  confidence: NativeProposalConfidence
  changes: Array<{ file: string; reason: string; patch: StructuredPatch }>
  risks: string[]
  rollbackPlan: string
}

/** Builds an advisory edit proposal and structurally validates it via native-builder's own
 * (read-only, synchronous) patchPolicy check — never writes anything, never calls patchApplier. */
export function proposeEdit(input: ProposeEditInput): WrEngineerEditProposal {
  const plannedChanges: NativePlannedChange[] = input.changes.map(c => ({
    file: c.file,
    reason: c.reason,
    operation: c.patch.operation,
    patch: c.patch,
  }))

  // validatePatchPolicy expects a NativeRepairProposal shape; issueId/proposerId/generatedAt/
  // validations/sourceKind are populated with honest, self-describing values — this proposal was
  // never attached to a native-builder issue and is not itself a native-builder proposal record,
  // it only borrows the same shape for the shared validator.
  const previewSubject: NativeRepairProposal = {
    issueId: input.missionId,
    sourceKind: 'hosted_model',
    proposerId: 'wr-engineer',
    diagnosis: input.diagnosis,
    confidence: input.confidence,
    relevantFiles: input.changes.map(c => c.file),
    plannedChanges,
    validations: [],
    risks: input.risks,
    rollbackPlan: input.rollbackPlan,
    generatedAt: new Date().toISOString(),
  }

  const policyPreview = validatePatchPolicy(previewSubject)

  return {
    id: randomUUID(),
    missionId: input.missionId,
    diagnosis: input.diagnosis,
    confidence: input.confidence,
    relevantFiles: previewSubject.relevantFiles,
    plannedChanges,
    risks: input.risks,
    rollbackPlan: input.rollbackPlan,
    generatedAt: previewSubject.generatedAt,
    epistemicStatus: 'NOT_VERIFIED',
    policyPreview,
  }
}

/** Explicit, load-bearing negative: this module has no apply/write function. A caller that wants a
 * proposal actually applied must go through lib/native-builder's own gated pipeline (or
 * lib/mission-runtime's MissionExecutionStrategy.approve()) — never through lib/wr-engineer. */
export const WR_ENGINEER_CANNOT_WRITE_FILES = true as const
