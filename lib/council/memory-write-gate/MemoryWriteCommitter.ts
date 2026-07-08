import { FakeMemoryStore } from './FakeMemoryStore'
import { MemoryApprovalVerifier, markMemoryApprovalConsumed } from './MemoryApprovalVerifier'
import { MemoryIntegrityChecker } from './MemoryIntegrityChecker'
import { MemoryRollbackPlanner } from './MemoryRollbackPlanner'
import type {
  ExplicitMemoryWriteApproval,
  MemoryCommitInput,
  MemoryWriteCommitResult,
  MemoryWriteCommitStatus,
} from './types'

export class MemoryWriteCommitter {
  private readonly verifier = new MemoryApprovalVerifier()
  private readonly rollbackPlanner = new MemoryRollbackPlanner()
  private readonly integrityChecker = new MemoryIntegrityChecker()

  commit(input: MemoryCommitInput & { store: FakeMemoryStore }): {
    result: MemoryWriteCommitResult
    consumedApproval: ExplicitMemoryWriteApproval | null
  } {
    const now = input.now ?? new Date().toISOString()
    const rollbackPlan = this.rollbackPlanner.createPlan({
      proposal: input.proposal,
      stagedWrite: input.stagedWrite,
      targetMemoryId: null,
      committed: false,
      createdAt: now,
    })

    if (input.autoModeEnabled) {
      return this.reject(input, rollbackPlan, 'rejected', 'Auto Mode memory writes are disabled.', now)
    }

    if (input.proposal.source === 'provider_result') {
      const approvalCandidate = input.approval as Partial<ExplicitMemoryWriteApproval> | null

      if (!approvalCandidate || approvalCandidate.allowProviderAuthoredMemory !== false) {
        return this.reject(input, rollbackPlan, 'rejected', 'Provider-authored memory requires commander approval with provider-authored allowance disabled.', now)
      }
    }

    if (!input.stagedWrite.reviewChecklist.evidenceAttached) {
      return this.reject(input, rollbackPlan, 'blocked', 'Memory writes without evidence are not committable.', now)
    }

    if (input.stagedWrite.duplicateOfMemoryId) {
      return this.reject(input, rollbackPlan, 'duplicate_detected', 'Duplicate memory fingerprint detected.', now)
    }

    if (input.stagedWrite.conflictsWithMemoryIds.length > 0) {
      return this.reject(input, rollbackPlan, 'conflict_detected', 'Conflicting committed memory detected.', now)
    }

    const verification = this.verifier.verify({
      approval: input.approval,
      proposal: input.proposal,
      stagedWrite: input.stagedWrite,
      now,
    })

    if (!verification.valid) {
      return this.reject(
        input,
        rollbackPlan,
        mapVerificationReasonToStatus(verification.reason),
        verification.message,
        now
      )
    }

    const consumedApproval = markMemoryApprovalConsumed(verification.approval)

    try {
      const commit = input.store.commitMemory({
        proposal: input.proposal,
        stagedWrite: input.stagedWrite,
        createdAt: now,
      })
      const committedRollbackPlan = this.rollbackPlanner.createPlan({
        proposal: input.proposal,
        stagedWrite: input.stagedWrite,
        targetMemoryId: commit.memory.memoryId,
        committed: true,
        createdAt: now,
      })

      return {
        result: {
          commitResultId: `commit_${input.stagedWrite.stagedWriteId}`,
          proposalId: input.proposal.proposalId,
          stagedWriteId: input.stagedWrite.stagedWriteId,
          approvalId: consumedApproval.approvalId,
          memoryId: commit.memory.memoryId,
          status: 'committed',
          memoryStoreChanged: true,
          approvalConsumed: true,
          rollbackPlan: committedRollbackPlan,
          auditEventId: commit.auditEvent.auditEventId,
          errorMessage: null,
          createdAt: now,
        },
        consumedApproval,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fake memory store partial failure.'
      const auditEvent = input.store.markPartialFailure({
        proposalId: input.proposal.proposalId,
        stagedWriteId: input.stagedWrite.stagedWriteId,
        message,
        createdAt: now,
      })
      const partialReport = this.integrityChecker.detectPartialFailure(
        input.store,
        input.stagedWrite.stagedWriteId
      )
      const snapshot = input.store.snapshot()
      const partialMemoryRecord = snapshot.records.find(
        record => record.stagedWriteId === input.stagedWrite.stagedWriteId
      )
      const memoryStoreChanged =
        Boolean(partialMemoryRecord) ||
        snapshot.auditEvents.some(
          event => event.stagedWriteId === input.stagedWrite.stagedWriteId
        )

      return {
        result: {
          commitResultId: `commit_${input.stagedWrite.stagedWriteId}`,
          proposalId: input.proposal.proposalId,
          stagedWriteId: input.stagedWrite.stagedWriteId,
          approvalId: consumedApproval.approvalId,
          memoryId: partialMemoryRecord?.memoryId ?? null,
          status: 'partial_failure',
          memoryStoreChanged,
          approvalConsumed: true,
          rollbackPlan,
          auditEventId: auditEvent.auditEventId,
          errorMessage: `${message} ${partialReport.message}`,
          createdAt: now,
        },
        consumedApproval,
      }
    }
  }

  private reject(
    input: MemoryCommitInput & { store: FakeMemoryStore },
    rollbackPlan: MemoryWriteCommitResult['rollbackPlan'],
    status: MemoryWriteCommitStatus,
    message: string,
    now: string
  ): { result: MemoryWriteCommitResult; consumedApproval: null } {
    const auditEvent = input.store.rejectCommit({
      proposalId: input.proposal.proposalId,
      stagedWriteId: input.stagedWrite.stagedWriteId,
      message,
      createdAt: now,
    })

    return {
      result: {
        commitResultId: `commit_${input.stagedWrite.stagedWriteId}`,
        proposalId: input.proposal.proposalId,
        stagedWriteId: input.stagedWrite.stagedWriteId,
        approvalId: null,
        memoryId: null,
        status,
        memoryStoreChanged: false,
        approvalConsumed: false,
        rollbackPlan,
        auditEventId: auditEvent.auditEventId,
        errorMessage: message,
        createdAt: now,
      },
      consumedApproval: null,
    }
  }
}

function mapVerificationReasonToStatus(
  reason: string
): MemoryWriteCommitStatus {
  if (reason === 'approval_missing') return 'approval_missing'
  if (reason === 'approval_expired') return 'approval_expired'
  if (reason === 'approval_consumed') return 'approval_consumed'

  return 'approval_invalid'
}
