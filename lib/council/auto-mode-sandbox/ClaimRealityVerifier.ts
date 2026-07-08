import type {
  AutoSandboxExecutionResult,
  AutoSandboxSnapshot,
  ClaimRealityIssue,
  ClaimRealityReport,
} from './types'

export class ClaimRealityVerifier {
  verify(input: {
    executionResult: AutoSandboxExecutionResult
    beforeSnapshot: AutoSandboxSnapshot
    afterSnapshot: AutoSandboxSnapshot
    createdAt: string
  }): ClaimRealityReport {
    const observedSandboxChanged = !this.domainSnapshotsEqual(
      input.beforeSnapshot,
      input.afterSnapshot
    )
    const observedAppliedActionCount = input.afterSnapshot.auditEvents.filter(
      event => event.eventType === 'action_applied'
    ).length - input.beforeSnapshot.auditEvents.filter(
      event => event.eventType === 'action_applied'
    ).length
    const claimedAppliedActionCount = input.executionResult.appliedActionIds.length
    const issues: ClaimRealityIssue[] = []

    if (input.executionResult.sandboxChanged !== observedSandboxChanged) {
      issues.push({
        issueId: `claim_sandbox_changed_mismatch_${input.executionResult.executionId}`,
        severity: 'high',
        message: 'Execution result sandboxChanged claim does not match fake store state.',
      })
    }

    if (claimedAppliedActionCount !== observedAppliedActionCount) {
      issues.push({
        issueId: `claim_applied_count_mismatch_${input.executionResult.executionId}`,
        severity: 'high',
        message: 'Execution result applied action count does not match fake audit state.',
      })
    }

    return {
      reportId: `claim_reality_${input.executionResult.executionId}`,
      executionId: input.executionResult.executionId,
      claimMatchesReality: issues.length === 0,
      claimedSandboxChanged: input.executionResult.sandboxChanged,
      observedSandboxChanged,
      claimedAppliedActionCount,
      observedAppliedActionCount,
      issues,
      createdAt: input.createdAt,
    }
  }

  private domainSnapshotsEqual(left: AutoSandboxSnapshot, right: AutoSandboxSnapshot): boolean {
    return JSON.stringify({
      reminders: left.reminders,
      memoryTags: left.memoryTags,
      generatedArtifacts: left.generatedArtifacts,
    }) === JSON.stringify({
      reminders: right.reminders,
      memoryTags: right.memoryTags,
      generatedArtifacts: right.generatedArtifacts,
    })
  }
}
