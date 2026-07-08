import type { ExecutionPlan } from '../execution-plan'
import type { ApprovedExecutionPreview } from '../execution-gate'
import type {
  ApprovalVerificationFailureReason,
  ExplicitExecutionApproval,
  ProviderCallAuditRecord,
  ProviderCallStatus,
} from '../approved-call'

export const APPROVED_PROVIDER_ROUTE_FLAG =
  'WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE' as const
export const REAL_PROVIDER_SMOKE_FLAG = 'WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE' as const
export const APPROVED_PROVIDER_FAMILY = 'openai' as const
export const APPROVED_PROVIDER_ID = 'openai-approved-smoke' as const
export const APPROVED_PROVIDER_MODEL = 'gpt-4o' as const
export const OPENAI_APPROVED_PROVIDER_URL =
  'https://api.openai.com/v1/chat/completions' as const

export type ApprovedProviderFamily = typeof APPROVED_PROVIDER_FAMILY
export type ApprovedProviderId = typeof APPROVED_PROVIDER_ID
export type ApprovedProviderModel = typeof APPROVED_PROVIDER_MODEL

export type ApprovedProviderRouteRequest = {
  executionPlan: ExecutionPlan
  preview: ApprovedExecutionPreview
  approval: ExplicitExecutionApproval
  providerCandidateId: string
  executionStepId: string
  input: {
    prompt: string
    systemInstruction: string
  }
}

export type ApprovedProviderRouteStatus = ProviderCallStatus

export type ApprovedProviderRouteFlagState = {
  routeEnabled: boolean
  realProviderSmokeEnabled: boolean
}

export type ApprovedProviderRouteAuditRecord = ProviderCallAuditRecord & {
  routeFlagState: ApprovedProviderRouteFlagState
  approvalVerificationResult: 'valid' | 'invalid' | 'not_checked'
  providerInvocationAttempted: boolean
  networkCallCount: number
  timeoutOrFailureReason: string | null
}

export type ApprovedProviderRouteResponse = {
  requestId: string
  status: ApprovedProviderRouteStatus
  providerFamily: ApprovedProviderFamily
  providerId: ApprovedProviderId
  modelId: ApprovedProviderModel
  output: { content: string } | null
  approvalConsumed: boolean
  auditRecord: ApprovedProviderRouteAuditRecord
  safeSummary: string
  recommendedNextAction: string
}

export type ApprovedProviderEnv = {
  WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE?: string
  WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE?: string
  OPENAI_API_KEY?: string
}

export type OpenAIApprovedProviderPayload = {
  model: ApprovedProviderModel
  messages: [
    { role: 'system'; content: string },
    { role: 'user'; content: string },
  ]
  temperature: 0
  stream: false
}

export type ApprovedProviderTransportRequest = {
  url: typeof OPENAI_APPROVED_PROVIDER_URL
  apiKey: string
  body: OpenAIApprovedProviderPayload
  signal: AbortSignal
}

export type ApprovedProviderTransportResponse = {
  ok: boolean
  status: number
  body: unknown
}

export type ApprovedProviderTransport = (
  request: ApprovedProviderTransportRequest
) => Promise<ApprovedProviderTransportResponse>

export type NetworkSpyCall = {
  targetHost: string
  bodyMatchesSingleApprovedShape: boolean
}

export type NetworkSpySnapshot = {
  requestCount: number
  calls: NetworkSpyCall[]
}

export type ApprovedProviderRouteOptions = {
  env?: ApprovedProviderEnv
  transport?: ApprovedProviderTransport
  now?: string
  timeoutMs?: number
}

export type ApprovedProviderRouteValidationResult = {
  caseId: string
  description: string
  expectedStatus: ApprovedProviderRouteStatus
  observedStatus: ApprovedProviderRouteStatus
  expectedNetworkCalls: number
  observedNetworkCalls: number
  expectedApprovalConsumed: boolean
  observedApprovalConsumed: boolean
  expectedBlockedReason?: ApprovalVerificationFailureReason | 'route_disabled' | 'invalid_request' | 'disallowed_prompt'
  observedBlockedReason:
    | ApprovalVerificationFailureReason
    | 'route_disabled'
    | 'invalid_request'
    | 'disallowed_prompt'
    | null
  auditRecordProduced: boolean
  spyVerified: boolean
  result: 'PASS' | 'FAIL'
  notes: string[]
}

