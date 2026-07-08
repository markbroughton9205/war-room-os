import type { ExecutionPlan } from '../execution-plan'
import type { ApprovedExecutionPreview } from '../execution-gate'
import {
  EXPLICIT_EXECUTION_APPROVAL_TEXT,
  ExplicitExecutionApprovalFactory,
  type ApprovalScopeActionType,
  type ExplicitExecutionApproval,
} from '../approved-call'
import { handleApprovedProviderCall } from './handler'
import {
  createDefaultNoNetworkSpyTransport,
  createErrorSpyTransport,
  createInvalidOutputSpyTransport,
  createSuccessfulSpyTransport,
  createTimeoutSpyTransport,
  type ApprovedProviderSpyTransport,
} from './transport'
import {
  APPROVED_PROVIDER_ID,
  type ApprovedProviderEnv,
  type ApprovedProviderRouteRequest,
  type ApprovedProviderRouteStatus,
  type ApprovedProviderRouteValidationResult,
} from './types'

const VALIDATION_TIME = '2026-07-07T12:00:00.000Z'
const FUTURE_TIME = '2026-07-07T12:10:00.000Z'
const PAST_TIME = '2026-07-07T11:59:00.000Z'
const EXECUTION_PLAN_ID = 'exec_46h_validation'
const PREVIEW_ID = 'preview_46h_validation'
const STEP_ID = 'step_46h_provider_call'

type RouteValidationCase = {
  caseId: string
  description: string
  env: ApprovedProviderEnv
  request: ApprovedProviderRouteRequest | null
  transport: ApprovedProviderSpyTransport
  expectedStatus: ApprovedProviderRouteStatus
  expectedNetworkCalls: number
  expectedApprovalConsumed: boolean
  expectedBlockedReason?: ApprovedProviderRouteValidationResult['expectedBlockedReason']
}

export async function runApprovedProviderRouteBehaviorValidation(): Promise<
  ApprovedProviderRouteValidationResult[]
> {
  const enabledEnv = enabledSmokeEnv()

  return [
    await runCase({
      caseId: 'case_01_route_flag_false',
      description: 'Route flag false blocks before approval verification and network.',
      env: { ...enabledEnv, WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE: 'false' },
      request: createRouteRequest(),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'route_disabled',
    }),
    await runCase({
      caseId: 'case_02_smoke_flag_false',
      description: 'Real-provider smoke flag false blocks before approval verification and network.',
      env: { ...enabledEnv, WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE: 'false' },
      request: createRouteRequest(),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'route_disabled',
    }),
    await runCase({
      caseId: 'case_03_flags_missing',
      description: 'Missing flags block before approval verification and network.',
      env: { OPENAI_API_KEY: 'test-key' },
      request: createRouteRequest(),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'route_disabled',
    }),
    await runCase({
      caseId: 'case_04_no_approval',
      description: 'No approval object blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({ approval: null }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'invalid_request',
    }),
    await runCase({
      caseId: 'case_05_preview_approval_only',
      description: 'Approved preview only does not authorize execution.',
      env: enabledEnv,
      request: createPreviewApprovalOnlyRequest(),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'invalid_request',
    }),
    await runCase({
      caseId: 'case_06_wrong_approval_text',
      description: 'Wrong approval text blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_wrong_text', {
          approvalText: 'I approve this provider call',
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'wrong_approval_text',
    }),
    await runCase({
      caseId: 'case_07_wrong_approval_type',
      description: 'Wrong approval type blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: {
          ...createApproval('approval_wrong_type'),
          approvalType: 'preview_only',
        } as unknown as ExplicitExecutionApproval,
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'wrong_approval_type',
    }),
    await runCase({
      caseId: 'case_08_wrong_approver',
      description: 'Wrong approver blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: {
          ...createApproval('approval_wrong_approver'),
          approvedBy: 'operator',
        } as unknown as ExplicitExecutionApproval,
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'wrong_approver',
    }),
    await runCase({
      caseId: 'case_09_expired_approval',
      description: 'Expired approval blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_expired', { expiresAt: PAST_TIME }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'expired_approval',
    }),
    await runCase({
      caseId: 'case_10_consumed_approval',
      description: 'Consumed approval blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_consumed', { consumedAt: VALIDATION_TIME }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'approval_already_consumed',
    }),
    await runCase({
      caseId: 'case_11_wrong_execution_plan',
      description: 'Wrong executionPlanId blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_wrong_plan', {
          executionPlanId: 'exec_other',
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'execution_plan_mismatch',
    }),
    await runCase({
      caseId: 'case_12_wrong_preview',
      description: 'Wrong previewId blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_wrong_preview', { previewId: 'preview_other' }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'preview_mismatch',
    }),
    await runCase({
      caseId: 'case_13_wrong_provider_candidate',
      description: 'Wrong providerCandidateId blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_wrong_provider', {
          allowedProviderCandidateId: 'provider_other',
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'provider_candidate_mismatch',
    }),
    await runCase({
      caseId: 'case_14_wrong_execution_step',
      description: 'Wrong executionStepId blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_wrong_step', {
          allowedExecutionStepId: 'step_other',
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'execution_step_mismatch',
    }),
    await runCase({
      caseId: 'case_15_wrong_action_type',
      description: 'Wrong action type blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_wrong_action', {
          allowedActionType: 'tool_call' as ApprovalScopeActionType,
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'action_type_mismatch',
    }),
    await runCase({
      caseId: 'case_16_prompt_attempts_tool_use',
      description: 'Prompt attempts tool use, so it blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({ prompt: 'Please use a tool to browse the web.' }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'disallowed_prompt',
    }),
    await runCase({
      caseId: 'case_17_prompt_attempts_side_effect',
      description: 'Prompt attempts file/database/repo/deployment action, so it blocks.',
      env: enabledEnv,
      request: createRouteRequest({ prompt: 'Write to Supabase and commit the repo.' }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'disallowed_prompt',
    }),
    await runCase({
      caseId: 'case_18_malformed_request',
      description: 'Malformed request blocks before network.',
      env: enabledEnv,
      request: { bad: 'shape' } as unknown as ApprovedProviderRouteRequest,
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'invalid_request',
    }),
    await runCase({
      caseId: 'case_19_provider_timeout',
      description: 'Valid approval with provider timeout consumes approval and records one call.',
      env: enabledEnv,
      request: createRouteRequest({ approval: createApproval('approval_timeout') }),
      transport: createTimeoutSpyTransport(),
      expectedStatus: 'timed_out',
      expectedNetworkCalls: 1,
      expectedApprovalConsumed: true,
    }),
    await runCase({
      caseId: 'case_20_provider_error',
      description: 'Valid approval with provider error consumes approval and records one call.',
      env: enabledEnv,
      request: createRouteRequest({ approval: createApproval('approval_error') }),
      transport: createErrorSpyTransport(),
      expectedStatus: 'failed',
      expectedNetworkCalls: 1,
      expectedApprovalConsumed: true,
    }),
    await runCase({
      caseId: 'case_21_invalid_provider_output',
      description: 'Valid approval with invalid output consumes approval and records one call.',
      env: enabledEnv,
      request: createRouteRequest({ approval: createApproval('approval_invalid_output') }),
      transport: createInvalidOutputSpyTransport(),
      expectedStatus: 'invalid_output',
      expectedNetworkCalls: 1,
      expectedApprovalConsumed: true,
    }),
    await runCase({
      caseId: 'case_22_success',
      description: 'Valid approval succeeds with exactly one network-spy call.',
      env: enabledEnv,
      request: createRouteRequest({ approval: createApproval('approval_success') }),
      transport: createSuccessfulSpyTransport('Smoke response accepted.'),
      expectedStatus: 'succeeded',
      expectedNetworkCalls: 1,
      expectedApprovalConsumed: true,
    }),
    await runCase({
      caseId: 'case_23_reuse_after_success',
      description: 'Reused consumed approval after success blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_reuse_success', {
          consumedAt: VALIDATION_TIME,
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'approval_already_consumed',
    }),
    await runCase({
      caseId: 'case_24_reuse_after_timeout_failure',
      description: 'Reused consumed approval after timeout/failure blocks before network.',
      env: enabledEnv,
      request: createRouteRequest({
        approval: createApproval('approval_reuse_failure', {
          consumedAt: VALIDATION_TIME,
        }),
      }),
      transport: createDefaultNoNetworkSpyTransport(),
      expectedStatus: 'blocked',
      expectedNetworkCalls: 0,
      expectedApprovalConsumed: false,
      expectedBlockedReason: 'approval_already_consumed',
    }),
  ]
}

async function runCase(
  input: RouteValidationCase
): Promise<ApprovedProviderRouteValidationResult> {
  const response = await handleApprovedProviderCall(input.request, {
    env: input.env,
    transport: input.transport.transport,
    now: VALIDATION_TIME,
    timeoutMs: 5,
  })
  const spy = input.transport.snapshot()
  const observedBlockedReason = response.auditRecord.blockedReason
    ?? inferRouteBlockedReason(response.auditRecord.timeoutOrFailureReason)
  const spyVerified =
    spy.requestCount === input.expectedNetworkCalls &&
    spy.calls.every(call => call.targetHost === 'api.openai.com' && call.bodyMatchesSingleApprovedShape)
  const passed =
    response.status === input.expectedStatus &&
    spy.requestCount === input.expectedNetworkCalls &&
    response.approvalConsumed === input.expectedApprovalConsumed &&
    Boolean(response.auditRecord.auditId) &&
    response.auditRecord.networkCallCount === input.expectedNetworkCalls &&
    (!input.expectedBlockedReason || observedBlockedReason === input.expectedBlockedReason) &&
    spyVerified

  return {
    caseId: input.caseId,
    description: input.description,
    expectedStatus: input.expectedStatus,
    observedStatus: response.status,
    expectedNetworkCalls: input.expectedNetworkCalls,
    observedNetworkCalls: spy.requestCount,
    expectedApprovalConsumed: input.expectedApprovalConsumed,
    observedApprovalConsumed: response.approvalConsumed,
    expectedBlockedReason: input.expectedBlockedReason,
    observedBlockedReason,
    auditRecordProduced: Boolean(response.auditRecord.auditId),
    spyVerified,
    result: passed ? 'PASS' : 'FAIL',
    notes: response.auditRecord.notes,
  }
}

function inferRouteBlockedReason(
  reason: string | null
): ApprovedProviderRouteValidationResult['observedBlockedReason'] {
  if (!reason) return null
  if (reason.includes('flags')) return 'route_disabled'
  if (reason.includes('Request body') || reason.includes('OPENAI_API_KEY')) return 'invalid_request'
  if (reason.includes('Prompt attempts')) return 'disallowed_prompt'
  return null
}

function enabledSmokeEnv(): ApprovedProviderEnv {
  return {
    WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE: 'true',
    WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE: 'true',
    OPENAI_API_KEY: 'test-key',
  }
}

function createRouteRequest(overrides: {
  approval?: ExplicitExecutionApproval | null
  prompt?: string
  systemInstruction?: string
} = {}): ApprovedProviderRouteRequest {
  return {
    executionPlan: createExecutionPlan(),
    preview: createPreview(),
    approval: overrides.approval === undefined
      ? createApproval('approval_valid')
      : overrides.approval as ExplicitExecutionApproval,
    providerCandidateId: APPROVED_PROVIDER_ID,
    executionStepId: STEP_ID,
    input: {
      prompt: overrides.prompt ?? 'Provide one contained smoke-test response.',
      systemInstruction:
        overrides.systemInstruction ??
        'You are running a contained approved provider smoke test. Return one short text response.',
    },
  }
}

function createPreviewApprovalOnlyRequest(): ApprovedProviderRouteRequest {
  const request = createRouteRequest()

  return {
    ...request,
    approval: undefined,
  } as unknown as ApprovedProviderRouteRequest
}

function createApproval(
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
      overrides.allowedProviderCandidateId ?? APPROVED_PROVIDER_ID,
    allowedExecutionStepId: overrides.allowedExecutionStepId ?? STEP_ID,
    allowedActionType: overrides.allowedActionType,
    approvedAt: VALIDATION_TIME,
    expiresAt: overrides.expiresAt ?? FUTURE_TIME,
    approvalTokenSeed: approvalId,
    approvalText:
      (overrides.approvalText as typeof EXPLICIT_EXECUTION_APPROVAL_TEXT) ??
      EXPLICIT_EXECUTION_APPROVAL_TEXT,
  })

  return overrides.consumedAt === undefined
    ? approval
    : { ...approval, consumedAt: overrides.consumedAt }
}

function createExecutionPlan(): ExecutionPlan {
  return {
    executionPlanId: EXECUTION_PLAN_ID,
    routingId: 'routing_46h_validation',
    recommendationId: 'recommendation_46h_validation',
    commanderMessage: 'Validate one approved provider route smoke call.',
    intent: 'validation',
    selectedSkillIds: ['strategic_synthesis'],
    selectedEntityIds: ['strategist'],
    recommendedBrainCandidateIds: [APPROVED_PROVIDER_ID],
    selectedBrainCandidateId: APPROVED_PROVIDER_ID,
    approvalRequired: true,
    blockedReason: null,
    executionAllowed: false,
    executionMode: 'dry_run',
    executionSteps: [
      {
        stepId: STEP_ID,
        label: 'Approved OpenAI smoke call',
        ownerEntityId: 'strategist',
        skillId: 'strategic_synthesis',
        brainCandidateId: APPROVED_PROVIDER_ID,
        actionType: 'synthesize',
        description: 'Run one contained approved provider smoke call.',
        requiresApproval: true,
        riskLevel: 'medium',
        status: 'planned',
      },
    ],
    expectedInputs: [],
    expectedOutputs: [],
    safetyChecks: [],
    estimatedCostClass: 'low',
    estimatedLatencyClass: 'fast',
    fallbackPlan: {
      fallbackPlanId: 'fallback_46h_validation',
      reason: 'No fallback provider is permitted in 46H.',
      strategy: 'no_action',
      steps: ['Stop and return audit record.'],
    },
    decisionPath: ['46H validation fixture created.'],
    createdAt: VALIDATION_TIME,
  }
}

function createPreview(): ApprovedExecutionPreview {
  return {
    previewId: PREVIEW_ID,
    executionPlanId: EXECUTION_PLAN_ID,
    routingId: 'routing_46h_validation',
    recommendationId: 'recommendation_46h_validation',
    commanderMessage: 'Validate one approved provider route smoke call.',
    approvalState: 'approved_preview_only',
    approvalRequired: true,
    approvalReason:
      'Preview approval is not execution approval and cannot authorize a provider call.',
    executionGateDecision: {
      gateDecisionId: 'gate_46h_validation',
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
      'Create ExplicitExecutionApproval to test one approved provider call.',
    ],
    executionAllowed: false,
    liveExecutionEnabled: false,
    decisionPath: ['Approved preview created without execution authorization.'],
    createdAt: VALIDATION_TIME,
  }
}
