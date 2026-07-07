import type { ExecutionPlan } from '../execution-plan'
import { AllowedNextActionPlanner } from './AllowedNextActionPlanner'
import { ApprovalPolicy } from './ApprovalPolicy'
import { AutoModePolicy } from './AutoModePolicy'
import { BlockedActionPlanner } from './BlockedActionPlanner'
import { ExecutionGate } from './ExecutionGate'
import type { ApprovedExecutionPreview, ExecutionGateInput } from './types'

function createPreviewId(createdAt: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `preview_${createdAt.replace(/[^0-9]/g, '')}_${randomPart}`
}

function buildPreviewSummary(executionPlan: ExecutionPlan): string {
  return executionPlan.blockedReason
    ? `Preview only: ${executionPlan.blockedReason}`
    : 'Preview only: War Room can show what it would do, but live execution is disabled.'
}

export class ApprovedExecutionPreviewBuilder {
  constructor(
    private readonly executionGate: ExecutionGate = new ExecutionGate(),
    private readonly approvalPolicy: ApprovalPolicy = new ApprovalPolicy(),
    private readonly autoModePolicy: AutoModePolicy = new AutoModePolicy(),
    private readonly allowedNextActionPlanner: AllowedNextActionPlanner = new AllowedNextActionPlanner(),
    private readonly blockedActionPlanner: BlockedActionPlanner = new BlockedActionPlanner(),
  ) {}

  build(input: ExecutionGateInput): ApprovedExecutionPreview {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const executionGateDecision = this.executionGate.decide(input.executionPlan)
    const approval = this.approvalPolicy.resolve({
      executionPlan: input.executionPlan,
      gateDecision: executionGateDecision,
    })
    const autoModePolicy = this.autoModePolicy.resolve(input.executionPlan)
    const allowedNextActions = this.allowedNextActionPlanner.plan({
      executionPlan: input.executionPlan,
      gateDecision: executionGateDecision,
    })
    const blockedActions = this.blockedActionPlanner.plan(input.executionPlan)

    return {
      previewId: input.previewId ?? createPreviewId(createdAt),
      executionPlanId: input.executionPlan.executionPlanId,
      routingId: input.executionPlan.routingId,
      recommendationId: input.executionPlan.recommendationId,
      commanderMessage: input.executionPlan.commanderMessage,
      approvalState: approval.approvalState,
      approvalRequired: approval.approvalRequired,
      approvalReason: approval.approvalReason,
      executionGateDecision,
      autoModePolicy,
      allowedNextActions,
      blockedActions,
      previewSummary: buildPreviewSummary(input.executionPlan),
      operatorInstructions: [
        'Review the approved_preview_only packet.',
        'Do not treat preview approval as live execution approval.',
        'Use allowed next actions only; providers, tools, messages, deployments, and mutations remain blocked.',
      ],
      executionAllowed: false,
      liveExecutionEnabled: false,
      decisionPath: [
        `ApprovedExecutionPreview attached to ExecutionPlan ${input.executionPlan.executionPlanId}.`,
        ...executionGateDecision.decisionPath.map(line => `Gate lineage: ${line}`),
        ...autoModePolicy.decisionPath.map(line => `Auto Mode lineage: ${line}`),
        'Preview can be shown; live execution remains disabled.',
      ],
      createdAt,
    }
  }
}
