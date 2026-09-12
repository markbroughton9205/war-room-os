/**
 * #22 Phase 11B — Canonical local model router.
 * Reuses lib/native-builder/ollamaClient.ts + council localModelRegistry.
 * LM Studio: NOT_IMPLEMENTED (no existing adapter found).
 * Electron renderer must NOT call Ollama directly — only through this path / Core / Next API.
 */
import { probeOllama, requestOllamaStreamingCompletion } from '@/lib/native-builder/ollamaClient'
import { safeOllamaBaseUrl } from '@/lib/council/live-orchestration/backends/localBackend'
import { LOCAL_MODEL_REGISTRY } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import { assertLocalSessionOwnerMatch } from '@/lib/sovereign-runtime/session'
import { assertEndpointAllowedForLocalModel, classifyLocalModelEndpoint } from './endpointGuard'
import {
  GENESIS_GENERAL_MODEL_ID,
  type LocalCouncilModeReport,
  type LocalModelDiscovery,
  type LocalModelInferRequest,
  type LocalModelInferResult,
  type LocalModelProviderType,
  type LocalModelRuntimeState,
} from './types'

export const LOCAL_MODEL_ROUTER_ID = 'sovereign-local-model-router-v1' as const

const DEFAULT_OLLAMA = 'http://127.0.0.1:11434'

function configuredOllamaUrl(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA).replace(/\/+$/, '')
}

/** LM Studio — audited: no existing War Room adapter. */
export function lmStudioPathTruth(): {
  status: 'NOT_IMPLEMENTED'
  detail: string
} {
  return {
    status: 'NOT_IMPLEMENTED',
    detail: 'No LM Studio adapter exists in War Room. Do not overclaim.',
  }
}

export function localOpenAiCompatiblePathTruth(): {
  status: 'NOT_IMPLEMENTED'
  detail: string
} {
  return {
    status: 'NOT_IMPLEMENTED',
    detail: 'No separate LOCAL_OPENAI_COMPATIBLE adapter beyond Ollama. LM Studio path NOT_IMPLEMENTED.',
  }
}

export async function discoverOllama(): Promise<LocalModelDiscovery> {
  const raw = configuredOllamaUrl()
  const endpointGate = classifyLocalModelEndpoint(raw)
  const notes = [
    'CONFIGURED != AVAILABLE',
    'MODEL_LISTED != SUCCESSFUL_INFERENCE',
    'THIRD_PARTY_MODEL_RUNNING_LOCALLY != WRIM != RA\'EL',
    'No automatic ollama pull / restart / delete.',
  ]

  if (!endpointGate.ok) {
    return {
      provider: 'OLLAMA',
      configured: Boolean(process.env.OLLAMA_BASE_URL?.trim() || true),
      endpoint: null,
      endpoint_class: 'DENIED',
      service_status: 'NOT_CONFIGURED',
      models: [],
      selected_model: GENESIS_GENERAL_MODEL_ID,
      selected_model_status: 'NOT_CONFIGURED',
      inference_ready: false,
      streaming_supported: true,
      detail: endpointGate.reason,
      notes,
    }
  }

  const probe = await probeOllama()
  const safeEndpoint = safeOllamaBaseUrl(probe.baseUrl)
  const selected = GENESIS_GENERAL_MODEL_ID
  const installed = probe.models.some(
    name => name === selected || name.startsWith(`${selected.split(':')[0]}:`),
  )

  let service_status: LocalModelRuntimeState = 'NOT_RUNNING'
  if (probe.available) service_status = probe.models.length ? 'AVAILABLE' : 'DEGRADED'
  else service_status = 'ENDPOINT_UNREACHABLE'

  let selected_model_status: LocalModelRuntimeState = 'MODEL_NOT_INSTALLED'
  if (!probe.available) selected_model_status = 'ENDPOINT_UNREACHABLE'
  else if (installed) selected_model_status = 'READY'
  else selected_model_status = 'MODEL_NOT_INSTALLED'

  return {
    provider: 'OLLAMA',
    configured: true,
    endpoint: safeEndpoint,
    endpoint_class: 'LOOPBACK',
    service_status,
    models: probe.models,
    selected_model: selected,
    selected_model_status,
    inference_ready: probe.available && installed,
    streaming_supported: true,
    detail: probe.detail,
    notes,
  }
}

export async function discoverLocalModels(): Promise<{
  router: typeof LOCAL_MODEL_ROUTER_ID
  ollama: LocalModelDiscovery
  lm_studio: ReturnType<typeof lmStudioPathTruth>
  local_openai_compatible: ReturnType<typeof localOpenAiCompatiblePathTruth>
  council: LocalCouncilModeReport
  website_required: false
  cloudflare_required: false
  public_dns_required: false
  external_ai_required: false
}> {
  const ollama = await discoverOllama()
  const council = buildLocalCouncilModeReport(ollama)
  return {
    router: LOCAL_MODEL_ROUTER_ID,
    ollama,
    lm_studio: lmStudioPathTruth(),
    local_openai_compatible: localOpenAiCompatiblePathTruth(),
    council,
    website_required: false,
    cloudflare_required: false,
    public_dns_required: false,
    external_ai_required: false,
  }
}

export function buildLocalCouncilModeReport(ollama: LocalModelDiscovery): LocalCouncilModeReport {
  const general = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'GENERAL')
  const research = LOCAL_MODEL_REGISTRY.find(e => e.slot === 'RESEARCH')
  const shared =
    Boolean(general && research && general.modelId === research.modelId) ||
    research?.enabled === false
  const ready = ollama.inference_ready
  return {
    mode: ready ? 'DEGRADED_LOCAL' : 'UNAVAILABLE',
    shared_physical_model: shared,
    physical_model_id: general?.modelId ?? GENESIS_GENERAL_MODEL_ID,
    role_contracts_preserved: true,
    seats_using_shared_weight: shared ? ['GENERAL', 'RESEARCH', 'NEBULA_SHARED_BRAIN'] : ['GENERAL'],
    note: ready
      ? 'DEGRADED_LOCAL — local Ollama path usable; not identical to FULL_MULTI_PROVIDER_COUNCIL. SHARED_PHYSICAL_MODEL when seats share one weight.'
      : 'Local Council fallback unavailable until Ollama reachable and model installed.',
  }
}

function policyDenials(input: LocalModelInferRequest): LocalModelInferResult['denials'] {
  const denials: LocalModelInferResult['denials'] = []
  if (input.attemptToolAuthorization) {
    denials.push({
      capability_or_action: 'TOOL_AUTHORIZATION',
      reason_code: 'MODEL_RESPONSE_NOT_APPROVAL',
      reason: 'LOCAL MODEL != LOCAL ADMIN. Model response cannot authorize tools.',
    })
  }
  if (input.attemptDeployAuthorization) {
    denials.push({
      capability_or_action: 'DEPLOY',
      reason_code: 'MODEL_CANNOT_AUTHORIZE',
      reason: 'Local model cannot authorize deploy.',
    })
  }
  if (input.attemptPushAuthorization) {
    denials.push({
      capability_or_action: 'PUSH',
      reason_code: 'MODEL_CANNOT_AUTHORIZE',
      reason: 'Local model cannot authorize push.',
    })
  }
  if (input.attemptFinanceAuthorization) {
    denials.push({
      capability_or_action: 'FINANCE',
      reason_code: 'MODEL_CANNOT_AUTHORIZE',
      reason: 'Local model cannot authorize finance.',
    })
  }
  if (input.attemptAgentSpawn) {
    denials.push({
      capability_or_action: 'AGENT_SPAWN',
      reason_code: 'MODEL_CANNOT_SPAWN',
      reason: 'Local model cannot spawn Ascension agents.',
    })
  }
  if (input.attemptApproveGovernance) {
    denials.push({
      capability_or_action: 'GOVERNANCE_APPROVAL',
      reason_code: 'MODEL_RESPONSE_NOT_APPROVAL',
      reason: 'MODEL RESPONSE != APPROVAL. Phase 1 governance preserved.',
    })
  }
  if (input.claimIsWrim) {
    denials.push({
      capability_or_action: 'WRIM_CLAIM',
      reason_code: 'THIRD_PARTY_LOCAL_NOT_WRIM',
      reason: 'Qwen/Ollama is THIRD_PARTY_MODEL_RUNNING_LOCALLY — WRIM NOT_IMPLEMENTED / #23 NOT_STARTED.',
    })
  }
  if (input.claimIsRael) {
    denials.push({
      capability_or_action: 'RAEL_CLAIM',
      reason_code: 'THIRD_PARTY_LOCAL_NOT_RAEL',
      reason: 'Local third-party model is not Ra\'el. #23 NOT_STARTED.',
    })
  }
  return denials
}

/**
 * Canonical inference — Ollama only when configured/reachable/model installed.
 * Never auto-downloads. Never restarts Ollama. Never switches to paid provider.
 */
export async function runLocalModelInference(
  input: LocalModelInferRequest,
): Promise<LocalModelInferResult> {
  const started_at = new Date().toISOString()
  const startedMs = Date.now()
  const requested: LocalModelProviderType = input.provider ?? 'OLLAMA'
  const denials = policyDenials(input)

  if (input.ownerUserId && input.resourceOwnerUserId) {
    const own = assertLocalSessionOwnerMatch(input.ownerUserId, input.resourceOwnerUserId)
    if (!own.ok) {
      denials.push({
        capability_or_action: 'OWNER_SCOPE',
        reason_code: 'OWNER_SCOPE_DENIED',
        reason: own.reason,
      })
      return failResult({
        requested,
        status: 'ERROR',
        error: own.reason,
        started_at,
        startedMs,
        denials,
        conversationId: input.conversationId ?? null,
      })
    }
  }

  if (requested === 'LM_STUDIO') {
    return failResult({
      requested,
      status: 'NOT_CONFIGURED',
      error: lmStudioPathTruth().detail,
      started_at,
      startedMs,
      denials,
      conversationId: input.conversationId ?? null,
    })
  }

  if (requested === 'LOCAL_OPENAI_COMPATIBLE') {
    return failResult({
      requested,
      status: 'NOT_CONFIGURED',
      error: localOpenAiCompatiblePathTruth().detail,
      started_at,
      startedMs,
      denials,
      conversationId: input.conversationId ?? null,
    })
  }

  const endpointCheck = assertEndpointAllowedForLocalModel(configuredOllamaUrl())
  if (!endpointCheck.allowed) {
    return failResult({
      requested,
      status: 'NOT_CONFIGURED',
      error: endpointCheck.reason,
      started_at,
      startedMs,
      denials,
      conversationId: input.conversationId ?? null,
    })
  }

  const discovery = await discoverOllama()
  const model = (input.model?.trim() || discovery.selected_model || GENESIS_GENERAL_MODEL_ID).trim()

  if (!discovery.inference_ready && discovery.service_status === 'ENDPOINT_UNREACHABLE') {
    return failResult({
      requested,
      status: 'ENDPOINT_UNREACHABLE',
      error: discovery.detail,
      started_at,
      startedMs,
      denials,
      conversationId: input.conversationId ?? null,
      actual_model: model,
    })
  }

  const installed = discovery.models.some(
    name => name === model || name.startsWith(`${model.split(':')[0]}:`),
  )
  if (!installed) {
    return failResult({
      requested,
      status: 'MODEL_NOT_INSTALLED',
      error: `Model ${model} is not installed. No automatic pull.`,
      started_at,
      startedMs,
      denials,
      conversationId: input.conversationId ?? null,
      actual_model: model,
    })
  }

  const prompt = String(input.prompt || '').trim()
  if (!prompt) {
    return failResult({
      requested,
      status: 'ERROR',
      error: 'Empty prompt.',
      started_at,
      startedMs,
      denials,
      conversationId: input.conversationId ?? null,
      actual_model: model,
    })
  }

  const completion = await requestOllamaStreamingCompletion({
    model,
    prompt,
    system: input.system,
  })

  const completed_at = new Date().toISOString()
  if (!completion.ok) {
    const timeout = /abort|timed? ?out/i.test(completion.detail)
    return {
      ok: false,
      status: timeout ? 'TIMEOUT' : 'ERROR',
      requested_provider: requested,
      actual_provider: 'OLLAMA',
      actual_model: model,
      fallback_used: false,
      local_or_remote: 'LOCAL',
      content: null,
      error: completion.detail,
      started_at,
      completed_at,
      latency_ms: Date.now() - startedMs,
      streaming: true,
      denials,
      audit: {
        provider_type: 'OLLAMA',
        model,
        local_or_remote: 'LOCAL',
        result_status: timeout ? 'TIMEOUT' : 'ERROR',
        fallback_used: false,
        actor: input.ownerUserId ?? 'local_core',
        conversation_id: input.conversationId ?? null,
      },
      intelligence_class: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
      wrim: 'NOT_IMPLEMENTED',
      rael: 'NOT_IMPLEMENTED',
      roadmap_23: 'NOT_STARTED',
    }
  }

  return {
    ok: true,
    status: 'READY',
    requested_provider: requested,
    actual_provider: 'OLLAMA',
    actual_model: completion.model,
    fallback_used: false,
    local_or_remote: 'LOCAL',
    content: completion.text,
    error: null,
    started_at,
    completed_at,
    latency_ms: completion.metrics.totalMs,
    streaming: true,
    denials,
    audit: {
      provider_type: 'OLLAMA',
      model: completion.model,
      local_or_remote: 'LOCAL',
      result_status: 'READY',
      fallback_used: false,
      actor: input.ownerUserId ?? 'local_core',
      conversation_id: input.conversationId ?? null,
    },
    intelligence_class: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    wrim: 'NOT_IMPLEMENTED',
    rael: 'NOT_IMPLEMENTED',
    roadmap_23: 'NOT_STARTED',
  }
}

function failResult(args: {
  requested: LocalModelProviderType
  status: LocalModelRuntimeState
  error: string
  started_at: string
  startedMs: number
  denials: LocalModelInferResult['denials']
  conversationId: string | null
  actual_model?: string | null
}): LocalModelInferResult {
  return {
    ok: false,
    status: args.status,
    requested_provider: args.requested,
    actual_provider: null,
    actual_model: args.actual_model ?? null,
    fallback_used: false,
    local_or_remote: 'LOCAL',
    content: null,
    error: args.error,
    started_at: args.started_at,
    completed_at: new Date().toISOString(),
    latency_ms: Date.now() - args.startedMs,
    streaming: false,
    denials: args.denials,
    audit: {
      provider_type: null,
      model: args.actual_model ?? null,
      local_or_remote: 'LOCAL',
      result_status: args.status,
      fallback_used: false,
      actor: 'local_core',
      conversation_id: args.conversationId,
    },
    intelligence_class: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    wrim: 'NOT_IMPLEMENTED',
    rael: 'NOT_IMPLEMENTED',
    roadmap_23: 'NOT_STARTED',
  }
}

/** Red-team: reject dangerous endpoints without probing them. */
export function redTeamEndpointProbe(raw: string): { allowed: false; reason: string } {
  const c = classifyLocalModelEndpoint(raw)
  return { allowed: false, reason: c.reason }
}
