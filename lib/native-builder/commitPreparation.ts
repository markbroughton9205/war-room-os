/**
 * Commit-message preparation + staging plan — DATA ONLY.
 *
 * The `commitCapable: false` invariant (lib/mission-runtime/types.ts) is permanent: no code path
 * here, in native-builder, or in mission-runtime ever runs git add/commit/push. What this module
 * closes is the everyday-use gap where the Commander had to hand-derive a commit message and the
 * exact file list from the diff evidence. The output is a prepared artifact: a conventional-commit
 * style message summarizing the ACTUAL applied proposal + validation evidence, and an ordered
 * staging plan (the exact files, in apply order, with the per-file rationale the proposal itself
 * declared). Reuses the same intent as lib/engineering/engineeringTaskPacket.ts's commitMessage
 * concept, but for the native path and derived from what really happened, not a template string.
 */
import type {
  NativeCommitPreparation,
  NativeIssueRecord,
  NativeRepairRecord,
  NativeStagingPlanEntry,
} from './types'

function inferCommitType(issue: NativeIssueRecord): 'fix' | 'feat' | 'chore' {
  const text = `${issue.title} ${issue.rawEvidenceText}`.toLowerCase()
  if (/\bfix|bug|error|broken|regression|crash|fail/.test(text)) return 'fix'
  if (/\badd|build|implement|create|feature|wire/.test(text)) return 'feat'
  return 'chore'
}

function inferScope(issue: NativeIssueRecord): string {
  const candidate = issue.affectedSubsystem.replace(/\.[^.]+$/, '').split('/').filter(Boolean)
  // e.g. "lib/native-builder/types.ts" -> "native-builder"; fall back to a generic scope.
  return candidate.length >= 2 ? candidate[candidate.length - 1]! : (candidate[0] ?? 'repo')
}

function compactSummary(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean
}

/** Pure derivation — reads only the records, touches nothing on disk and nothing in git. */
export function buildCommitPreparation(issue: NativeIssueRecord, repair: NativeRepairRecord): NativeCommitPreparation | null {
  const proposal = repair.selectedProposal
  if (!proposal || proposal.plannedChanges.length === 0) return null

  const type = inferCommitType(issue)
  const scope = inferScope(issue)
  const summary = compactSummary(issue.title)

  const stagingPlan: NativeStagingPlanEntry[] = proposal.plannedChanges.map(change => ({
    file: change.file,
    operation: change.operation,
    rationale: change.reason,
  }))

  const validationsPassed = repair.validationResults.filter(r => r.ok).map(r => r.operation.id)
  const deletedFiles = stagingPlan.filter(e => e.operation === 'delete_file').map(e => e.file)

  const detailLines = [
    `War Room native repair ${repair.id} for issue ${issue.id}.`,
    `Proposer: ${proposal.proposerId} (${proposal.sourceKind}).`,
    validationsPassed.length ? `Validations passed: ${validationsPassed.join(', ')}.` : 'No validations recorded as passed.',
    repair.verification ? `Verification: ${repair.verification.status}.` : null,
    deletedFiles.length ? `Deletes: ${deletedFiles.join(', ')} (Commander-confirmed).` : null,
    `Prepared by War Room — commitCapable: false; stage and commit manually after review.`,
  ].filter((line): line is string => line !== null)

  const commitMessage = `${type}(${scope}): ${summary}\n\n${detailLines.join('\n')}`

  return {
    commitMessage,
    stagingPlan,
    basis: {
      proposerId: proposal.proposerId,
      sourceKind: proposal.sourceKind,
      validationsPassed,
      diffHash: repair.diffEvidence?.diffHash,
    },
    generatedAt: new Date().toISOString(),
  }
}
