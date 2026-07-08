import type { ExecutionPlan } from '../execution-plan'
import type { ApprovedExecutionPreview } from '../execution-gate'
import { ApprovedCallOrchestrator } from './ApprovedCallOrchestrator'
import { ExplicitExecutionApprovalFactory } from './ExplicitExecutionApproval'
import { FakeProviderAdapter } from './FakeProviderAdapter'
import {
  EXPLICIT_EXECUTION_APPROVAL_TEXT,
  FAKE_PROVIDER_ID,
  type ApprovalScopeActionType,
  type ApprovalVerificationFailureReason,
  type ApprovedCallBehaviorValidationResult,
  type ExplicitExecutionApproval,
  type ProviderCallStatus,
} from './types'

type ValidationCase = {
  caseId: string
  description: string
  approval: ExplicitExecutionApproval | null
  prompt?: string
  providerCandidateId?: string
  executionPlanIdOverride?: string
  previewIdOverride?: string
  expectedStatus: ProviderCallStatus
  expectedAdapterCalls: number
  expectedApprovalConsumed: boolean
  expectedBlockedReason?: ApprovalVerificationFailureReason
  reuseConsumedApproval?: boolean
}

const VALIDATION_TIME = '2026-07-07T12:00:00.000Z'
const FUTURE_TIME = '2026-07-07T12:10:00.000Z'
const PAST_TIME = '2026-07-07T11:59:00.000Z'
const EXECUTION_PLAN_ID = 'exec_46g_validation'
const PREVIEW_ID = 'preview_46g_validation'
const STEP_ID = 'step_46g_provider_call'
const PROVIDER_CANDIDATE_ID = FAKE_PROVIDER_ID

export function runApprovedCallBehaviorValidation(): ApprovedCallBehaviorValidationResult[] {
  const validApproval = createValidationApproval('approval_valid')
  const firstSuccess = runCase({
    caseId: 'case_09_valid_approval',
    description: 'Correct, valid approval calls fake adapter exactly once.',
    approval: validApproval,
    expectedStatus: 'succeeded',
    expectedAdapterCalls: 1,
    expectedApprovalConsumed: true,
  })
  const consumedApproval = createValidationApproval('approval_reused', {
    consumedAt: VALIDATION_TIME,
  })

  return [
    runCase({
      caseId: 'case_01_preview_approval_only',
      description: 'Preview approval only never authorizes execution.',
      approval: null,
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'missing_approval',
    }),
    runCase({
      caseId: 'case_02_no_approval',
      description: 'Missing explicit approval blocks before fake adapter invocation.',
      approval: null,
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'missing_approval',
    }),
    runCase({
      caseId: 'case_03_wrong_approval_text',
      description: 'Wrong approval phrase blocks before fake adapter invocation.',
      approval: createValidationApproval('approval_wrong_text', {
        approvalText: 'I approve this provider call',
      }),
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'wrong_approval_text',
    }),
    runCase({
      caseId: 'case_04_expired_approval',
      description: 'Expired approval blocks before fake adapter invocation.',
      approval: createValidationApproval('approval_expired', {
        expiresAt: PAST_TIME,
      }),
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'expired_approval',
    }),
    runCase({
      caseId: 'case_05_consumed_approval',
      description: 'Consumed single-use approval blocks before fake adapter invocation.',
      approval: consumedApproval,
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'approval_already_consumed',
    }),
    runCase({
      caseId: 'case_06_wrong_execution_plan',
      description: 'Execution plan lineage mismatch blocks before fake adapter invocation.',
      approval: createValidationApproval('approval_wrong_plan', {
        executionPlanId: 'exec_other',
      }),
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'execution_plan_mismatch',
    }),
    runCase({
      caseId: 'case_07_wrong_preview',
      description: 'Preview lineage mismatch blocks before fake adapter invocation.',
      approval: createValidationApproval('approval_wrong_preview', {
        previewId: 'preview_other',
      }),
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'preview_mismatch',
    }),
    runCase({
      caseId: 'case_08_wrong_provider_candidate',
      description: 'Provider candidate scope mismatch blocks before fake adapter invocation.',
      approval: createValidationApproval('approval_wrong_provider', {
        allowedProviderCandidateId: 'candidate_other',
      }),
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'provider_candidate_mismatch',
    }),
    firstSuccess,
    runCase({
      caseId: 'case_10_fake_timeout',
      description: 'Correct approval with simulated timeout consumes approval and never retries.',
      approval: createValidationApproval('approval_timeout'),
      prompt: '[simulate_timeout]',
      expectedStatus: 'timed_out',
      expectedAdapterCalls: 1,
      expectedApprovalConsumed: true,
    }),
    runCase({
      caseId: 'case_11_fake_malformed',
      description:
        'Correct approval with simulated malformed output consumes approval and never retries.',
      approval: createValidationApproval('approval_malformed'),
      prompt: '[simulate_malformed]',
      expectedStatus: 'invalid_output',
      expectedAdapterCalls: 1,
      expectedApprovalConsumed: true,
    }),
    runCase({
      caseId: 'case_12_reuse_after_success',
      description: 'Correct approval reused after success is blocked as already consumed.',
      approval: firstSuccess.observedApprovalConsumed
        ? createValidationApproval('approval_reuse_after_success', {
            consumedAt: VALIDATION_TIME,
          })
        : null,
      expectedStatus: 'blocked',
      expectedAdapterCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'approval_already_consumed',
      reuseConsumedApproval: true,
    }),
  ]
}

function runCase(input: ValidationCase): ApprovedCallBehaviorValidationResult {
  const adapter = new FakeProviderAdapter()
  const orchestrator = new ApprovedCallOrchestrator(adapter)
  const result = orchestrator.run({
    executionPlan: createExecutionPlan(input.executionPlanIdOverride),
    preview: createPreview(input.previewIdOverride),
    approval: input.approval,
    prompt: input.prompt,
    providerCandidateId: input.providerCandidateId,
    createdAt: VALIDATION_TIME,
  })
  const observedAdapterCalls = result.auditRecord.adapterInvocationCountAfter
  const observedApprovalConsumed = result.result.approvalConsumed
  const baseNotes = [
    result.result.safeSummary,
    ...result.auditRecord.notes,
  ]
  const notes = input.reuseConsumedApproval
    ? [
        ...baseNotes,
        'Reuse case validates that consumed approvals do not invoke the fake adapter.',
      ]
    : baseNotes
  const passed =
    result.result.status === input.expectedStatus &&
    observedAdapterCalls === input.expectedAdapterCalls &&
    observedApprovalConsumed === input.expectedApprovalConsumed &&
    result.auditRecord.adapterCalled === input.expectedAdapterCalls > 0 &&
    Boolean(result.auditRecord) &&
    (!input.expectedBlockedReason ||
      result.result.blockedReason === input.expectedBlockedReason)

  return {
    caseId: input.caseId,
    description: input.description,
    expectedStatus: input.expectedStatus,
    observedStatus: result.result.status,
    expectedAdapterCalls: input.expectedAdapterCalls,
    observedAdapterCalls,
    expectedApprovalConsumed: input.expectedApprovalConsumed,
    observedApprovalConsumed,
    expectedBlockedReason: input.expectedBlockedReason,
    observedBlockedReason: result.result.blockedReason,
    auditRecordProduced: Boolean(result.auditRecord.auditId),
    result: passed ? 'PASS' : 'FAIL',
    notes,
  }
}

function createValidationApproval(
  approvalId: string,
  overrides: Partial<{
    approvalText: string
    executionPlanId: string
    previewId: string
    allowedProviderCandidateId: string
    allowedExecutionStepId: string
    allowedActionType: ApprovalScopeActionType
    expiresAt: string
    consumedAt: string | null
  }> = {}
): ExplicitExecutionApproval {
  const approval = ExplicitExecutionApprovalFactory.create({
    approvalId,
    executionPlanId: overrides.executionPlanId ?? EXECUTION_PLAN_ID,
    previewId: overrides.previewId ?? PREVIEW_ID,
    allowedProviderCandidateId:
      overrides.allowedProviderCandidateId ?? PROVIDER_CANDIDATE_ID,
    allowedExecutionStepId: overrides.allowedExecutionStepId ?? STEP_ID,
    allowedActionType: overrides.allowedActionType,
    approvedAt: VALIDATION_TIME,
    expiresAt: overrides.expiresAt ?? FUTURE_TIME,
    approvalTokenSeed: approvalId,
    approvalText:
      (overrides.approvalText as typeof EXPLICIT_EXECUTION_APPROVAL_TEXT) ??
      EXPLICIT_EXECUTION_APPROVAL_TEXT,
  })

  if (overrides.consumedAt !== undefined) {
    return {
      ...approval,
      consumedAt: overrides.consumedAt,
    }
  }

  return approval
}

function createExecutionPlan(
  executionPlanId = EXECUTION_PLAN_ID
): ExecutionPlan {
  return {
    executionPlanId,
    routingId: 'routing_46g_validation',
    recommendationId: 'recommendation_46g_validation',
    commanderMessage: 'Validate one contained fake provider call.',
    intent: 'validation',
    selectedSkillIds: ['strategic_synthesis'],
    selectedEntityIds: ['strategist'],
    recommendedBrainCandidateIds: [PROVIDER_CANDIDATE_ID],
    selectedBrainCandidateId: PROVIDER_CANDIDATE_ID,
    approvalRequired: true,
    blockedReason: null,
    executionAllowed: false,
    executionMode: 'dry_run',
    executionSteps: [
      {
        stepId: STEP_ID,
        label: 'Contained fake provider call',
        ownerEntityId: 'strategist',
        skillId: 'strategic_synthesis',
        brainCandidateId: PROVIDER_CANDIDATE_ID,
        actionType: 'synthesize',
        description: 'Simulate one contained provider-shaped response.',
        requiresApproval: true,
        riskLevel: 'medium',
        status: 'planned',
      },
    ],
    expectedInputs: [],
    expectedOutputs: [],
    safetyChecks: [],
    estimatedCostClass: 'none',
    estimatedLatencyClass: 'instant',
    fallbackPlan: {
      fallbackPlanId: 'fallback_46g_validation',
      reason: 'No fallback provider is permitted in 46G.',
      strategy: 'no_action',
      steps: ['Stop and return audit record.'],
    },
    decisionPath: ['46G validation fixture created.'],
    createdAt: VALIDATION_TIME,
  }
}

function createPreview(previewId = PREVIEW_ID): ApprovedExecutionPreview {
  return {
    previewId,
    executionPlanId: EXECUTION_PLAN_ID,
    routingId: 'routing_46g_validation',
    recommendationId: 'recommendation_46g_validation',
    commanderMessage: 'Validate one contained fake provider call.',
    approvalState: 'approved_preview_only',
    approvalRequired: true,
    approvalReason:
      'Preview approval is not execution approval and cannot authorize a provider call.',
    executionGateDecision: {
      gateDecisionId: 'gate_46g_validation',
      executionPlanId: EXECUTION_PLAN_ID,
      gateState: 'preview_only',
      executionAllowed: false,
      liveExecutionEnabled: false,
      blockedExecutionTypes: ['provider_call'],
      requiredApprovals: ['commander_approval'],
      reason: '46F preview remains inert.',
      decisionPath: ['Execution gate produced preview only.'],
    },
    autoModePolicy: {
      autoModeSupported: true,
      autoModeEnabled: false,
      autoEligible: false,
      autoEligibilityReason: null,
      autoBlockedReason: 'Auto Mode is disabled.',
      requiredApprovalBeforeAuto: true,
      allowedAutoActionTypes: [],
      blockedAutoActionTypes: ['provider_call'],
      decisionPath: ['Auto Mode remains disabled.'],
    },
    allowedNextActions: [],
    blockedActions: [
      {
        actionId: 'blocked_provider_call',
        label: 'Provider call blocked',
        blockedExecutionType: 'provider_call',
        blockedReason: 'ExplicitExecutionApproval is required.',
        requiredApprovalType: 'commander_approval',
      },
    ],
    previewSummary: 'Preview only; no execution authorized.',
    operatorInstructions: [
      'Create ExplicitExecutionApproval to test one fake adapter call.',
    ],
    executionAllowed: false,
    liveExecutionEnabled: false,
    decisionPath: ['Approved preview created without execution authorization.'],
    createdAt: VALIDATION_TIME,
  }
}
