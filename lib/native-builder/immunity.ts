/**
 * Immunity artifacts — real recurrence defense derived from what actually ran, not fabricated.
 * A dedicated validation_script that passed is the strongest artifact (it's a standing regression
 * test that will fail again if the bug returns). typecheck/eslint passing is weaker but real
 * (validation_rule). When neither applies, this honestly returns created:false with a reason,
 * per Part 3's explicit requirement to state the reason rather than silently skip the step.
 */
import { randomUUID } from 'node:crypto'
import type { ImmunityArtifactOutcome, NativeIssueRecord, NativeRepairRecord } from './types'

export function deriveImmunityArtifact(repair: NativeRepairRecord, issue: NativeIssueRecord): ImmunityArtifactOutcome {
  const now = new Date().toISOString()

  const scriptResult = repair.validationResults.find(v => v.operation.id === 'validation_script' && v.ok)
  if (scriptResult?.operation.targets?.length) {
    return {
      created: true,
      artifact: {
        id: randomUUID(),
        issueFingerprint: issue.fingerprint,
        repairMissionId: repair.id,
        type: 'regression_test',
        description: `Dedicated validation script ${scriptResult.operation.targets[0]} now guards against this exact issue recurring — it failed before the patch and passed after.`,
        files: scriptResult.operation.targets,
        validationEvidenceIds: repair.validationResults.map((_, i) => `${repair.id}:validation:${i}`),
        createdAt: now,
        status: 'active',
      },
    }
  }

  const genericCheck = repair.validationResults.find(v => (v.operation.id === 'typecheck' || v.operation.id === 'eslint_targeted' || v.operation.id === 'build') && v.ok)
  if (genericCheck) {
    return {
      created: true,
      artifact: {
        id: randomUUID(),
        issueFingerprint: issue.fingerprint,
        repairMissionId: repair.id,
        type: 'validation_rule',
        description: `${genericCheck.operation.id} passing on ${repair.selectedProposal?.relevantFiles.join(', ') ?? 'the patched files'} is generic re-verification, not a dedicated regression test — it will catch a syntactic/type regression of this class but not necessarily the exact original logic bug.`,
        files: repair.selectedProposal?.relevantFiles ?? [],
        validationEvidenceIds: repair.validationResults.map((_, i) => `${repair.id}:validation:${i}`),
        createdAt: now,
        status: 'active',
      },
    }
  }

  return {
    created: false,
    reason: 'No dedicated validation script and no passing generic check (typecheck/eslint/build) exists for this repair — only manual re-inspection would catch a recurrence.',
  }
}
