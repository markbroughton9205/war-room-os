import type {
  AutoSandboxCheckpoint,
  AutoSandboxRollbackPlan,
  AutoSandboxRollbackResult,
} from './types'
import { FakeAutoActionSandbox } from './FakeAutoActionSandbox'

export class AutoModeRollbackManager {
  createPlan(
    checkpoint: AutoSandboxCheckpoint,
    createdAt: string
  ): AutoSandboxRollbackPlan {
    return {
      rollbackPlanId: `rollback_${checkpoint.checkpointId}`,
      checkpointId: checkpoint.checkpointId,
      actionType: checkpoint.actionType,
      targetId: checkpoint.targetId,
      rollbackAvailable: true,
      expectedReversal: 'Restore fake sandbox to checkpoint snapshot.',
      createdAt,
    }
  }

  rollback(
    sandbox: FakeAutoActionSandbox,
    checkpoint: AutoSandboxCheckpoint | null,
    rollbackPlan: AutoSandboxRollbackPlan | null,
    createdAt: string
  ): AutoSandboxRollbackResult {
    if (!checkpoint || !rollbackPlan?.rollbackAvailable) {
      return {
        rollbackResultId: 'rollback_result_not_available',
        rollbackPlanId: rollbackPlan?.rollbackPlanId ?? 'none',
        status: 'not_available',
        sandboxChanged: false,
        message: 'No rollback checkpoint was available.',
        createdAt,
      }
    }

    sandbox.restore(checkpoint.beforeSnapshot)
    sandbox.appendAuditEvent({
      eventType: 'rollback_applied',
      actionType: checkpoint.actionType,
      targetId: checkpoint.targetId,
      message: 'Fake sandbox restored to checkpoint snapshot.',
      createdAt,
    })

    return {
      rollbackResultId: `rollback_result_${rollbackPlan.rollbackPlanId}`,
      rollbackPlanId: rollbackPlan.rollbackPlanId,
      status: 'rolled_back',
      sandboxChanged: true,
      message: 'Fake sandbox rollback applied.',
      createdAt,
    }
  }
}
