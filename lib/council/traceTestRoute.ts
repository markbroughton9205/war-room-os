import { NextResponse } from 'next/server'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import type { CouncilRuntimeTraceSnapshot } from '@/lib/council/runtimeTrace'

export const COUNCIL_TRACE_TEST_PROMPT =
  'Runtime trace verification only. Have each currently active Council family briefly identify itself and its role. Stay strictly within this request. Do not save memory, create missions, recommend actions, or execute anything.'

export type CouncilTraceTestProviderStatus = 'active' | 'unavailable' | 'error' | 'timed_out'

export type CouncilTraceTestProvider = {
  family: string
  status: CouncilTraceTestProviderStatus
  reason: string
  configuredContext?: string
  causeVerifiedAtRuntime?: boolean
}

export type CouncilTraceTestSummary = {
  traceCaptured: boolean
  traceId: string | null
  missionId: string | null
  missionVersion: number | null
  eventOrder: string[]
  activeProviders: CouncilTraceTestProvider[]
  unavailableProviders: CouncilTraceTestProvider[]
  runtimeObservedStages: string[]
  skippedOrInferredStages: string[]
  intentTransformationChain: string[]
  driftFindings: string[]
  bypassesObserved: string[]
  secretRedactionVerdict: 'passed' | 'failed' | 'not_available'
  normalCouncilResponse: CouncilTraceTestCouncilResponse[]
}

export type CouncilTraceTestCouncilResponse = {
  family: string
  status: string
  content: string
  messageType?: string
}

export type CouncilTraceTestRunResponse = {
  ok: boolean
  diagnostic: CouncilRuntimeDiagnosticClassification
  summary: CouncilTraceTestSummary
  councilTrace: CouncilRuntimeTraceSnapshot | null
  rawCouncilTraceJson: string
}

export type CouncilRuntimeDiagnosticClassification = {
  featureType: 'commander_diagnostic'
  authority: 'commander_only'
  runtimeImpact: 'observational'
  executionAuthority: 'none'
  memoryWriteAuthority: 'none'
  providerControlAuthority: 'none'
  authenticatedRuntimeTraceGate: 'passed'
  verifiedEnvironment: 'production'
  verificationStatus: 'independently_reviewed'
}

type ProviderResultLike = {
  family?: unknown
  status?: unknown
  content?: unknown
  messageType?: unknown
}

type ChatPost = (request: Request) => Promise<Response>

type TraceTestDeps = {
  assertEnvironmentAllowed?: typeof assertLiveActionsAllowed
  requireCommander?: typeof requireCommanderSession
  chatPost?: ChatPost
  env?: Record<string, string | undefined>
}

const EXPECTED_PROVIDER_ENV: Array<{
  family: string
  envKeys: string[]
  unavailableReason: string
  configuredContext?: string
  causeVerifiedAtRuntime?: boolean
}> = [
  { family: 'ChatGPT', envKeys: ['OPENAI_API_KEY'], unavailableReason: 'OPENAI_API_KEY not configured' },
  { family: 'Claude', envKeys: ['ANTHROPIC_API_KEY'], unavailableReason: 'ANTHROPIC_API_KEY not configured' },
  { family: 'Grok', envKeys: ['XAI_API_KEY'], unavailableReason: 'XAI_API_KEY not configured' },
  { family: 'Gemini', envKeys: ['GEMINI_API_KEY'], unavailableReason: 'GEMINI_API_KEY not configured' },
  {
    family: 'Kimi',
    envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    unavailableReason: 'unavailable in this request',
    configuredContext: 'funding paused',
    causeVerifiedAtRuntime: false,
  },
]

export const COUNCIL_RUNTIME_DIAGNOSTIC_CLASSIFICATION: CouncilRuntimeDiagnosticClassification = {
  featureType: 'commander_diagnostic',
  authority: 'commander_only',
  runtimeImpact: 'observational',
  executionAuthority: 'none',
  memoryWriteAuthority: 'none',
  providerControlAuthority: 'none',
  authenticatedRuntimeTraceGate: 'passed',
  verifiedEnvironment: 'production',
  verificationStatus: 'independently_reviewed',
}

export function buildCouncilTraceTestChatBody(): Record<string, unknown> {
  return {
    message: COUNCIL_TRACE_TEST_PROMPT,
    profile: '',
    threadHistory: [],
    mode: 'trace_test',
    toneMode: 'casual',
    councilFlowMode: 'full_council',
    councilTraceDebug: true,
  }
}

export async function handleCouncilTraceTestStatus(_request: Request, deps: TraceTestDeps = {}): Promise<Response> {
  const environmentBlocked = (deps.assertEnvironmentAllowed ?? assertLiveActionsAllowed)()
  if (environmentBlocked) return environmentBlocked

  const commander = await (deps.requireCommander ?? requireCommanderSession)('Council runtime diagnostics')
  if (!commander.ok) return commander.response

  return NextResponse.json({
    available: true,
    diagnostic: COUNCIL_RUNTIME_DIAGNOSTIC_CLASSIFICATION,
    label: 'Run Council Runtime Trace',
  })
}

export async function handleCouncilTraceTestRun(request: Request, deps: TraceTestDeps = {}): Promise<Response> {
  const environmentBlocked = (deps.assertEnvironmentAllowed ?? assertLiveActionsAllowed)()
  if (environmentBlocked) return environmentBlocked

  const commander = await (deps.requireCommander ?? requireCommanderSession)('Council runtime diagnostics')
  if (!commander.ok) return commander.response

  const chatPost = deps.chatPost
  if (!chatPost) {
    return NextResponse.json({ error: 'Council runtime diagnostics route is not configured.' }, { status: 500 })
  }

  const chatRequest = new Request(new URL('/api/chat', request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildCouncilTraceTestChatBody()),
  })
  const chatResponse = await chatPost(chatRequest)
  const chatPayload = await safeJson(chatResponse)
  const runResponse = buildCouncilTraceTestRunResponse(chatPayload, deps.env ?? process.env)

  return NextResponse.json(runResponse, { status: chatResponse.ok ? 200 : chatResponse.status })
}

export function buildCouncilTraceTestRunResponse(
  chatPayload: unknown,
  env: Record<string, string | undefined> = process.env,
): CouncilTraceTestRunResponse {
  const payload = isRecord(chatPayload) ? chatPayload : {}
  const trace = isCouncilTraceSnapshot(payload.councilTrace) ? payload.councilTrace : null
  const results = Array.isArray(payload.results) ? payload.results : []
  const normalCouncilResponse = results.map(coerceCouncilResponse).filter(Boolean) as CouncilTraceTestCouncilResponse[]
  const eventOrder = trace?.stages.map(stage => stage.stage) ?? []
  const runtimeObservedStages = trace?.stages
    .filter(stage => stage.observation === 'runtime_observed')
    .map(stage => stage.stage) ?? []
  const skippedOrInferredStages = trace?.stages
    .filter(stage => stage.observation !== 'runtime_observed')
    .map(stage => stage.stage) ?? []

  return {
    ok: Boolean(trace),
    diagnostic: COUNCIL_RUNTIME_DIAGNOSTIC_CLASSIFICATION,
    summary: {
      traceCaptured: Boolean(trace),
      traceId: trace?.councilTraceId ?? null,
      missionId: trace?.missionId ?? null,
      missionVersion: trace?.missionVersion ?? null,
      eventOrder,
      activeProviders: summarizeActiveProviders(normalCouncilResponse),
      unavailableProviders: summarizeUnavailableProviders(normalCouncilResponse, env),
      runtimeObservedStages,
      skippedOrInferredStages,
      intentTransformationChain: summarizeIntentChain(trace),
      driftFindings: summarizeDriftFindings(trace),
      bypassesObserved: summarizeBypasses(trace),
      secretRedactionVerdict: trace ? (containsSecretLikeValue(trace) ? 'failed' : 'passed') : 'not_available',
      normalCouncilResponse,
    },
    councilTrace: trace,
    rawCouncilTraceJson: trace ? JSON.stringify(trace, null, 2) : '',
  }
}

function summarizeActiveProviders(results: CouncilTraceTestCouncilResponse[]): CouncilTraceTestProvider[] {
  return results
    .filter(result => !isUnavailableStatus(result.status))
    .map(result => ({
      family: result.family,
      status: result.status === 'TIMED_OUT' ? 'timed_out' : result.status === 'FAILED' ? 'error' : 'active',
      reason: result.status,
    }))
}

function summarizeUnavailableProviders(
  results: CouncilTraceTestCouncilResponse[],
  env: Record<string, string | undefined>,
): CouncilTraceTestProvider[] {
  const fromResults = results
    .filter(result => isUnavailableStatus(result.status))
    .map(result => ({
      family: result.family,
      status: result.status === 'TIMED_OUT' ? 'timed_out' as const : result.status === 'FAILED' ? 'error' as const : 'unavailable' as const,
      reason: result.content || result.status,
    }))

  const presentFamilies = new Set(results.map(result => result.family.toLowerCase()))
  const fromConfig = EXPECTED_PROVIDER_ENV
    .filter(provider => !presentFamilies.has(provider.family.toLowerCase()))
    .filter(provider => provider.family === 'Kimi' || !provider.envKeys.some(key => Boolean(env[key]?.trim())))
    .map(provider => ({
      family: provider.family,
      status: 'unavailable' as const,
      reason: provider.unavailableReason,
      ...(provider.configuredContext ? { configuredContext: provider.configuredContext } : {}),
      ...(typeof provider.causeVerifiedAtRuntime === 'boolean'
        ? { causeVerifiedAtRuntime: provider.causeVerifiedAtRuntime }
        : {}),
    }))

  return [...fromResults, ...fromConfig]
}

function summarizeIntentChain(trace: CouncilRuntimeTraceSnapshot | null): string[] {
  if (!trace) return []
  const intentStages = new Set([
    'request_received',
    'command_parsed',
    'current_intent_resolved',
    'active_scope_built',
    'topic_scope_built',
    'mode_governor_resolved',
  ])
  return trace.stages
    .filter(stage => intentStages.has(stage.stage))
    .map(stage => `${stage.stage}: ${stage.stateChange}`)
}

function summarizeDriftFindings(trace: CouncilRuntimeTraceSnapshot | null): string[] {
  if (!trace) return []
  return trace.stages
    .filter(stage => stage.stage === 'scope_guardian_checked' || stage.stage === 'red_team_checked' || stage.stage === 'trace_error')
    .map(stage => `${stage.stage}: ${stage.stateChange}`)
}

function summarizeBypasses(trace: CouncilRuntimeTraceSnapshot | null): string[] {
  if (!trace) return []
  return trace.stages
    .filter(stage => /bypass/i.test(`${stage.stateChange} ${JSON.stringify(stage.outputSummary)}`))
    .map(stage => `${stage.stage}: ${stage.stateChange}`)
}

function coerceCouncilResponse(raw: unknown): CouncilTraceTestCouncilResponse | null {
  if (!isRecord(raw)) return null
  const result = raw as ProviderResultLike
  return {
    family: typeof result.family === 'string' ? result.family : 'UNKNOWN',
    status: typeof result.status === 'string' ? result.status : 'UNKNOWN',
    content: typeof result.content === 'string' ? result.content : '',
    ...(typeof result.messageType === 'string' ? { messageType: result.messageType } : {}),
  }
}

function isUnavailableStatus(status: string): boolean {
  return status === 'UNAVAILABLE' || status === 'FAILED' || status === 'TIMED_OUT'
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function isCouncilTraceSnapshot(value: unknown): value is CouncilRuntimeTraceSnapshot {
  if (!isRecord(value)) return false
  return (
    typeof value.councilTraceId === 'string'
    && typeof value.missionId === 'string'
    && typeof value.missionVersion === 'number'
    && Array.isArray(value.stages)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function containsSecretLikeValue(value: unknown): boolean {
  try {
    if (typeof value === 'string') {
      return /(bearer\s+[a-z0-9._-]+|eyJ[a-z0-9._-]+|sk-[a-z0-9_-]+|sb_secret_[a-z0-9_-]+|fc-[a-z0-9_-]+|tvly-[a-z0-9_-]+|xai-[a-z0-9_-]+|AIza[A-Za-z0-9_-]{20,})/i.test(value)
    }
    if (Array.isArray(value)) return value.some(containsSecretLikeValue)
    if (isRecord(value)) return Object.values(value).some(containsSecretLikeValue)
    return false
  } catch {
    return false
  }
}
