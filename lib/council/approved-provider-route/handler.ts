import { ApprovalVerifier } from '../approved-call'
import {
  ExplicitExecutionApprovalFactory,
  FAKE_MODEL_ID,
  FAKE_PROVIDER_FAMILY,
  FAKE_PROVIDER_ID,
  type ApprovalVerificationFailureReason,
  type ApprovedProviderCallRequest,
  type ExplicitExecutionApproval,
} from '../approved-call'
import {
  buildApprovedProviderPayload,
  openAIApprovedProviderTransport,
} from './transport'
import {
  APPROVED_PROVIDER_FAMILY,
  APPROVED_PROVIDER_ID,
  APPROVED_PROVIDER_MODEL,
  OPENAI_APPROVED_PROVIDER_URL,
  type ApprovedProviderEnv,
  type ApprovedProviderRouteAuditRecord,
  type ApprovedProviderRouteFlagState,
  type ApprovedProviderRouteOptions,
  type ApprovedProviderRouteRequest,
  type ApprovedProviderRouteResponse,
  type ApprovedProviderRouteStatus,
  type ApprovedProviderTransport,
  type ApprovedProviderTransportResponse,
} from './types'

const DEFAULT_TIMEOUT_MS = 10_000

type BlockedReason =
  | ApprovalVerificationFailureReason
  | 'route_disabled'
  | 'invalid_request'
  | 'disallowed_prompt'

type OpenAIChatCompletionBody = {
  choices?: Array<{ message?: { content?: unknown } }>
  error?: { message?: unknown }
}

export async function handleApprovedProviderCall(
  rawRequest: unknown,
  options: ApprovedProviderRouteOptions = {}
): Promise<ApprovedProviderRouteResponse> {
  const now = options.now ?? new Date().toISOString()
  const env: ApprovedProviderEnv = options.env ?? {
    WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE:
      process.env.WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE,
    WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE:
      process.env.WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const flagState = readRouteFlags(env)
  const parsed = parseRouteRequest(rawRequest)
  const requestId = parsed
    ? createRequestId(parsed.executionPlan.executionPlanId, parsed.preview.previewId, parsed.executionStepId)
    : `approved_provider_route_blocked_${Date.parse(now) || 0}`

  if (!flagState.routeEnabled || !flagState.realProviderSmokeEnabled) {
    return buildBlockedResponse({
      requestId,
      parsed,
      approval: parsed?.approval ?? null,
      flagState,
      blockedReason: 'route_disabled',
      failureReason: 'Approved provider route flags are disabled.',
      now,
      networkCallCount: 0,
      approvalVerificationResult: 'not_checked',
    })
  }

  if (!parsed) {
    return buildBlockedResponse({
      requestId,
      parsed: null,
      approval: null,
      flagState,
      blockedReason: 'invalid_request',
      failureReason: 'Request body does not match ApprovedProviderRouteRequest.',
      now,
      networkCallCount: 0,
      approvalVerificationResult: 'not_checked',
    })
  }

  const disallowedPromptReason = findDisallowedPromptReason(parsed.input.prompt)
    ?? findDisallowedPromptReason(parsed.input.systemInstruction)

  if (disallowedPromptReason) {
    return buildBlockedResponse({
      requestId,
      parsed,
      approval: parsed.approval,
      flagState,
      blockedReason: 'disallowed_prompt',
      failureReason: disallowedPromptReason,
      now,
      networkCallCount: 0,
      approvalVerificationResult: 'not_checked',
    })
  }

  const verificationRequest = createVerificationRequest(parsed, requestId, now)
  const verifier = new ApprovalVerifier()
  const verification = verifier.verify(parsed.approval, verificationRequest, now)

  if (!verification.valid) {
    return buildBlockedResponse({
      requestId,
      parsed,
      approval: parsed.approval,
      flagState,
      blockedReason: verification.reason,
      failureReason: verification.message,
      now,
      networkCallCount: 0,
      approvalVerificationResult: 'invalid',
    })
  }

  const apiKey = env.OPENAI_API_KEY?.trim()

  if (!apiKey) {
    return buildBlockedResponse({
      requestId,
      parsed,
      approval: parsed.approval,
      flagState,
      blockedReason: 'invalid_request',
      failureReason: 'OPENAI_API_KEY is not configured for the approved smoke route.',
      now,
      networkCallCount: 0,
      approvalVerificationResult: 'valid',
    })
  }

  const consumedApproval = ExplicitExecutionApprovalFactory.markConsumed(
    parsed.approval,
    now
  )
  const transport = options.transport ?? openAIApprovedProviderTransport
  const providerResult = await callProviderOnce({
    apiKey,
    parsed,
    transport,
    timeoutMs,
  })
  const content =
    providerResult.status === 'succeeded'
      ? extractProviderContent(providerResult.response?.body)
      : null
  const status =
    providerResult.status === 'succeeded' && content
      ? 'succeeded'
      : providerResult.status === 'succeeded'
        ? 'invalid_output'
        : providerResult.status
  const output = status === 'succeeded' && content ? { content } : null
  const failureReason =
    status === 'succeeded'
      ? null
      : providerResult.error ?? 'Provider response did not contain usable text.'

  return buildResponse({
    requestId,
    parsed,
    approval: consumedApproval,
    flagState,
    status,
    output,
    approvalConsumed: true,
    blockedReason: null,
    failureReason,
    now,
    providerInvocationAttempted: true,
    networkCallCount: 1,
    approvalVerificationResult: 'valid',
  })
}

function readRouteFlags(env: ApprovedProviderEnv): ApprovedProviderRouteFlagState {
  return {
    routeEnabled: env.WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE === 'true',
    realProviderSmokeEnabled: env.WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE === 'true',
  }
}

function parseRouteRequest(rawRequest: unknown): ApprovedProviderRouteRequest | null {
  if (!rawRequest || typeof rawRequest !== 'object') return null
  const candidate = rawRequest as Partial<ApprovedProviderRouteRequest>

  if (!candidate.executionPlan || !candidate.preview || !candidate.approval) {
    return null
  }

  if (
    typeof candidate.providerCandidateId !== 'string' ||
    typeof candidate.executionStepId !== 'string' ||
    !candidate.input ||
    typeof candidate.input.prompt !== 'string' ||
    typeof candidate.input.systemInstruction !== 'string'
  ) {
    return null
  }

  if (
    typeof candidate.executionPlan.executionPlanId !== 'string' ||
    typeof candidate.preview.previewId !== 'string' ||
    typeof candidate.preview.executionPlanId !== 'string'
  ) {
    return null
  }

  return candidate as ApprovedProviderRouteRequest
}

function findDisallowedPromptReason(text: string): string | null {
  if (/\b(tool|function\s*call|function_call|web\s*brows(?:e|ing)|browse\s+the\s+web)\b/i.test(text)) {
    return 'Prompt attempts tool use, function calling, or web browsing.'
  }

  if (/\b(file|database|supabase|repo|git|commit|deploy|deployment|memory\s*write|send\s+message)\b/i.test(text)) {
    return 'Prompt attempts file, database, repo, deployment, memory, or message side effects.'
  }

  return null
}

function createVerificationRequest(
  parsed: ApprovedProviderRouteRequest,
  requestId: string,
  now: string
): ApprovedProviderCallRequest {
  return {
    requestId,
    executionPlanId: parsed.executionPlan.executionPlanId,
    previewId: parsed.preview.previewId,
    routingId: parsed.preview.routingId,
    recommendationId: parsed.preview.recommendationId,
    providerCandidateId: parsed.providerCandidateId,
    executionStepId: parsed.executionStepId,
    providerFamily: FAKE_PROVIDER_FAMILY,
    providerId: FAKE_PROVIDER_ID,
    modelId: FAKE_MODEL_ID,
    actionType: 'single_provider_call',
    input: parsed.input,
    createdAt: now,
  }
}

async function callProviderOnce(input: {
  apiKey: string
  parsed: ApprovedProviderRouteRequest
  transport: ApprovedProviderTransport
  timeoutMs: number
}): Promise<{
  status: Exclude<ApprovedProviderRouteStatus, 'blocked' | 'invalid_output'>
  response: ApprovedProviderTransportResponse | null
  error: string | null
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  const payload = buildApprovedProviderPayload(input.parsed.input)

  try {
    const response = await Promise.race([
      input.transport({
        url: OPENAI_APPROVED_PROVIDER_URL,
        apiKey: input.apiKey,
        body: payload,
        signal: controller.signal,
      }),
      new Promise<ApprovedProviderTransportResponse>((_, reject) => {
        setTimeout(() => reject(new Error('Approved provider smoke call timed out.')), input.timeoutMs)
      }),
    ])

    if (!response.ok) {
      return {
        status: 'failed',
        response,
        error: extractProviderError(response.body) ?? `OpenAI smoke call failed with HTTP ${response.status}.`,
      }
    }

    return {
      status: 'succeeded',
      response,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approved provider smoke call failed.'
    return {
      status: message.toLowerCase().includes('timed out') ? 'timed_out' : 'failed',
      response: null,
      error: message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function extractProviderContent(body: unknown): string | null {
  const data = body as OpenAIChatCompletionBody
  const content = data?.choices?.[0]?.message?.content

  return typeof content === 'string' && content.trim() ? content : null
}

function extractProviderError(body: unknown): string | null {
  const data = body as OpenAIChatCompletionBody
  const message = data?.error?.message

  return typeof message === 'string' && message.trim() ? message : null
}

function buildBlockedResponse(input: {
  requestId: string
  parsed: ApprovedProviderRouteRequest | null
  approval: ExplicitExecutionApproval | null
  flagState: ApprovedProviderRouteFlagState
  blockedReason: BlockedReason
  failureReason: string
  now: string
  networkCallCount: number
  approvalVerificationResult: 'valid' | 'invalid' | 'not_checked'
}): ApprovedProviderRouteResponse {
  return buildResponse({
    requestId: input.requestId,
    parsed: input.parsed,
    approval: input.approval,
    flagState: input.flagState,
    status: 'blocked',
    output: null,
    approvalConsumed: false,
    blockedReason: input.blockedReason,
    failureReason: input.failureReason,
    now: input.now,
    providerInvocationAttempted: false,
    networkCallCount: input.networkCallCount,
    approvalVerificationResult: input.approvalVerificationResult,
  })
}

function buildResponse(input: {
  requestId: string
  parsed: ApprovedProviderRouteRequest | null
  approval: ExplicitExecutionApproval | null
  flagState: ApprovedProviderRouteFlagState
  status: ApprovedProviderRouteStatus
  output: { content: string } | null
  approvalConsumed: boolean
  blockedReason: BlockedReason | null
  failureReason: string | null
  now: string
  providerInvocationAttempted: boolean
  networkCallCount: number
  approvalVerificationResult: 'valid' | 'invalid' | 'not_checked'
}): ApprovedProviderRouteResponse {
  const auditRecord: ApprovedProviderRouteAuditRecord = {
    auditId: `audit_${input.requestId}`,
    requestId: input.requestId,
    approvalId: input.approval?.approvalId ?? null,
    executionPlanId:
      input.parsed?.executionPlan.executionPlanId ??
      input.approval?.executionPlanId ??
      'execution_plan_unknown',
    previewId:
      input.parsed?.preview.previewId ?? input.approval?.previewId ?? 'preview_unknown',
    providerCandidateId: input.parsed?.providerCandidateId ?? null,
    executionStepId: input.parsed?.executionStepId ?? null,
    status: input.status,
    approvalConsumed: input.approvalConsumed,
    adapterCalled: input.providerInvocationAttempted,
    adapterInvocationCountBefore: 0,
    adapterInvocationCountAfter: input.networkCallCount,
    blockedReason: isApprovalBlockedReason(input.blockedReason)
      ? input.blockedReason
      : null,
    notes: [
      '46H approved provider route smoke gate.',
      'No tools, database writes, repo mutation, message sending, deployment, Auto Mode, fallback provider, or retry path executed.',
      input.failureReason ?? 'Approved provider route completed without a failure reason.',
    ],
    createdAt: input.now,
    routeFlagState: input.flagState,
    approvalVerificationResult: input.approvalVerificationResult,
    providerInvocationAttempted: input.providerInvocationAttempted,
    networkCallCount: input.networkCallCount,
    timeoutOrFailureReason: input.failureReason,
  }

  return {
    requestId: input.requestId,
    status: input.status,
    providerFamily: APPROVED_PROVIDER_FAMILY,
    providerId: APPROVED_PROVIDER_ID,
    modelId: APPROVED_PROVIDER_MODEL,
    output: input.output,
    approvalConsumed: input.approvalConsumed,
    auditRecord,
    safeSummary: createSafeSummary(input.status),
    recommendedNextAction: createRecommendedNextAction(input.status),
  }
}

function isApprovalBlockedReason(
  reason: BlockedReason | null
): reason is ApprovalVerificationFailureReason {
  return Boolean(
    reason &&
      !['route_disabled', 'invalid_request', 'disallowed_prompt'].includes(reason)
  )
}

function createSafeSummary(status: ApprovedProviderRouteStatus): string {
  if (status === 'succeeded') {
    return 'The single approved OpenAI smoke call completed successfully.'
  }

  if (status === 'timed_out') {
    return 'The single approved OpenAI smoke call timed out. No retry or fallback was attempted.'
  }

  if (status === 'invalid_output') {
    return 'The single approved OpenAI smoke call returned invalid output. No retry or fallback was attempted.'
  }

  if (status === 'failed') {
    return 'The single approved OpenAI smoke call failed. No retry or fallback was attempted.'
  }

  return 'The approved provider route was blocked before provider invocation.'
}

function createRecommendedNextAction(status: ApprovedProviderRouteStatus): string {
  if (status === 'succeeded') {
    return 'Review the smoke output and keep additional execution behind fresh explicit approval.'
  }

  if (status === 'blocked') {
    return 'Resolve the blocked condition, then create a fresh ExplicitExecutionApproval if another attempt is needed.'
  }

  return 'Review the audit record. Any further attempt requires a fresh ExplicitExecutionApproval.'
}

function createRequestId(
  executionPlanId: string,
  previewId: string,
  executionStepId: string
): string {
  return `approved_provider_${executionPlanId}_${previewId}_${executionStepId}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
}
