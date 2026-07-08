import type {
  MemoryRollbackPlan,
  MemoryWriteProposal,
  StagedMemoryWrite,
} from './types'

export class MemoryRollbackPlanner {
  createPlan(input: {
    proposal: MemoryWriteProposal
    stagedWrite: StagedMemoryWrite
    targetMemoryId: string | null
    committed: boolean
    createdAt: string
    reason?: string
  }): MemoryRollbackPlan {
    return {
      rollbackPlanId: `rollback_${input.stagedWrite.stagedWriteId}`,
      proposalId: input.proposal.proposalId,
      stagedWriteId: input.stagedWrite.stagedWriteId,
      targetMemoryId: input.targetMemoryId,
      rollbackStrategy: input.committed ? 'mark_revoked' : 'no_op_uncommitted',
      reversible: true,
      reason: input.reason ?? 'Rollback plan is required before memory commit.',
      expectedEffect: input.committed
        ? 'Committed fake memory will be marked revoked; no record will be deleted.'
        : 'Uncommitted staged write can be discarded with no persistent memory effect.',
      createdAt: input.createdAt,
    }
  }
}

