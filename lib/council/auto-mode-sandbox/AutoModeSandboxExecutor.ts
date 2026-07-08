import { AutoModeEligibilityClassifier } from './AutoModeEligibilityClassifier'
import { AutoModeKillSwitch } from './AutoModeKillSwitch'
import { AutoModeRollbackManager } from './AutoModeRollbackManager'
import { ClaimRealityVerifier } from './ClaimRealityVerifier'
import { FakeAutoActionSandbox } from './FakeAutoActionSandbox'
import type {
  ActionRequest,
  AutoSandboxExecutionResult,
} from './types'

const DEFAULT_TIME = '2026-07-07T12:00:00.000Z'

export class AutoModeSandboxExecutor {
  constructor(
    private readonly sandbox: FakeAutoActionSandbox = new FakeAutoActionSandbox(),
    private readonly classifier: AutoModeEligibilityClassifier = new AutoModeEligibilityClassifier(),
    private readonly killSwitch: AutoModeKillSwitch = new AutoModeKillSwitch(),
    private readonly rollbackManager: AutoModeRollbackManager = new AutoModeRollbackManager(),
    private readonly claimRealityVerifier: ClaimRealityVerifier = new ClaimRealityVerifier()
  ) {}

  getSandbox(): FakeAutoActionSandbox {
    return this.sandbox
  }

  getKillSwitch(): AutoModeKillSwitch {
    return this.killSwitch
  }

  run(actionRequest: ActionRequest, createdAt = DEFAULT_TIME): AutoSandboxExecutionResult {
    const beforeSnapshot = this.sandbox.snapshot()
    const eligibilityDecision = this.classifier.classify(actionRequest, createdAt)
    this.sandbox.appendAuditEvent({
      eventType: 'eligibility_checked',
      actionType: actionRequest.actionType,
      targetId: actionRequest.targetId,
      message: eligibilityDecision.message,
      createdAt,
    })

    if (this.killSwitch.getState().engaged) {
      return this.block({
        actionRequest,
        eligibilityDecision,
        message: 'Auto Mode kill switch is engaged.',
        createdAt,
        beforeSnapshot,
      })
    }

    if (!eligibilityDecision.autoEligible) {
      return this.block({
        actionRequest,
        eligibilityDecision,
        message: eligibilityDecision.message,
        createdAt,
        beforeSnapshot,
      })
    }

    const checkpoint = this.sandbox.createCheckpoint(actionRequest, createdAt)
    const rollbackPlan = this.rollbackManager.createPlan(checkpoint, createdAt)
    const appliedActionIds = this.sandbox.apply(actionRequest, createdAt)
    const executionResult: AutoSandboxExecutionResult = {
      executionId: `auto_exec_${actionRequest.actionType}_${createdAt}`,
      status: 'applied',
      actionRequest,
      eligibilityDecision,
      killSwitchEngaged: false,
      sandboxChanged: appliedActionIds.length > 0,
      appliedActionIds,
      checkpoint,
      rollbackPlan,
      rollbackResult: null,
      claimRealityReport: null,
      message: 'Fake sandbox action applied with rollback checkpoint.',
      createdAt,
    }
    const claimRealityReport = this.claimRealityVerifier.verify({
      executionResult,
      beforeSnapshot,
      afterSnapshot: this.sandbox.snapshot(),
      createdAt,
    })
    this.sandbox.appendAuditEvent({
      eventType: 'claim_reality_checked',
      actionType: actionRequest.actionType,
      targetId: actionRequest.targetId,
      message: claimRealityReport.claimMatchesReality
        ? 'Execution claim matched fake sandbox reality.'
        : 'Execution claim mismatch detected.',
      createdAt,
    })

    return {
      ...executionResult,
      status: claimRealityReport.claimMatchesReality ? 'applied' : 'claim_mismatch',
      claimRealityReport,
    }
  }

  rollback(
    executionResult: AutoSandboxExecutionResult,
    createdAt = DEFAULT_TIME
  ): AutoSandboxExecutionResult {
    const rollbackResult = this.rollbackManager.rollback(
      this.sandbox,
      executionResult.checkpoint,
      executionResult.rollbackPlan,
      createdAt
    )

    return {
      ...executionResult,
      status: rollbackResult.status === 'rolled_back' ? 'rolled_back' : executionResult.status,
      rollbackResult,
      message: rollbackResult.message,
    }
  }

  private block(input: {
    actionRequest: ActionRequest
    eligibilityDecision: ReturnType<AutoModeEligibilityClassifier['classify']>
    message: string
    createdAt: string
    beforeSnapshot: ReturnType<FakeAutoActionSandbox['snapshot']>
  }): AutoSandboxExecutionResult {
    this.sandbox.appendAuditEvent({
      eventType: 'execution_blocked',
      actionType: input.actionRequest.actionType,
      targetId: input.actionRequest.targetId,
      message: input.message,
      createdAt: input.createdAt,
    })
    const result: AutoSandboxExecutionResult = {
      executionId: `auto_exec_blocked_${input.actionRequest.actionType}_${input.createdAt}`,
      status: 'blocked',
      actionRequest: input.actionRequest,
      eligibilityDecision: input.eligibilityDecision,
      killSwitchEngaged: this.killSwitch.getState().engaged,
      sandboxChanged: false,
      appliedActionIds: [],
      checkpoint: null,
      rollbackPlan: null,
      rollbackResult: null,
      claimRealityReport: null,
      message: input.message,
      createdAt: input.createdAt,
    }
    const report = this.claimRealityVerifier.verify({
      executionResult: result,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: this.sandbox.snapshot(),
      createdAt: input.createdAt,
    })

    return {
      ...result,
      claimRealityReport: report,
    }
  }
}
