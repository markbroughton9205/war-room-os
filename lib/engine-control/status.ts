import {
  GEMINI_REST_BASE,
  fetchGeminiListModelsJson,
  geminiAllowedGenerateContentIds,
  geminiOrderedCandidates,
} from '@/lib/ai/providers/geminiGenerative'
import { getProviderRuntimeHealth, type ProviderRuntimeId, type ProviderRuntimeStatus } from '@/lib/providers/health'

import { ENGINE_REGISTRY } from './registry'
import { engineProviderDisplayLabel } from './provider-display'
import { computeApprovalRequired, computeEnginePermissions } from './permissions'
import type {
  EngineCapabilityId,
  EngineId,
  EngineStatus,
  EngineControlStatusResponse,
  ProviderAvailabilityDiagnostic,
  ToolRoutingSnapshot,
} from './types'

function windowlessTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms)
}

function registryRow(id: EngineId) {
  const reg = ENGINE_REGISTRY.find(e => e.id === id)
  if (!reg) throw new Error(`Unknown engine ${id}`)
  return reg
}

const CLOUD_PROVIDER_FAMILY: Partial<Record<EngineId, string>> = {
  chatgpt: 'chatgpt',
  claude: 'claude',
  grok: 'grok',
  gemini: 'gemini',
  kimi: 'kimi',
}

const ENGINE_PROVIDER_RUNTIME_ID: Partial<Record<EngineId, ProviderRuntimeId>> = {
  chatgpt: 'openai',
  claude: 'anthropic',
  grok: 'xai',
  gemini: 'google',
  kimi: 'moonshot',
}

function providerDiagnostic(args: {
  id: EngineId
  configured: boolean
  apiKeyPresent: boolean
  lastCheckResult: string
  reason?: string
}): ProviderAvailabilityDiagnostic {
  return {
    providerId: args.id,
    familyId: CLOUD_PROVIDER_FAMILY[args.id] ?? null,
    configured: args.configured,
    apiKeyPresent: args.apiKeyPresent,
    registryStatus: ENGINE_REGISTRY.some(e => e.id === args.id) ? 'registered' : 'missing',
    lastCheckResult: args.lastCheckResult,
    ...(args.reason ? { reason: args.reason } : {}),
  }
}

function finalize(status: Omit<EngineStatus, 'permissions' | 'approvalRequired' | 'providerLabel'>): EngineStatus {
  const providerLabel = engineProviderDisplayLabel(status.id, status.providerType)
  const permissions = computeEnginePermissions(status)
  const approvalRequired = computeApprovalRequired(status, 'read_only_query')
  return { ...status, providerLabel, permissions, approvalRequired }
}

function cloudEngine(
  id: 'grok' | 'claude' | 'chatgpt' | 'kimi',
  lastChecked: string,
  provider: ProviderRuntimeStatus | undefined,
  configuredNotes: string,
  missingNotes: string,
): EngineStatus {
  const reg = registryRow(id)
  const configured = Boolean(provider?.configured)
  const connected = provider?.health === 'CONNECTED'
  const degraded = Boolean(provider?.configured && provider.health !== 'CONNECTED')
  const reachable = connected
  const functional = connected
  return finalize({
    id,
    displayName: reg.displayName,
    category: reg.category,
    providerType: reg.providerType,
    installed: true,
    configured,
    reachable,
    functional,
    capabilities: [...reg.defaultCapabilities],
    lastChecked,
    providerDiagnostics: providerDiagnostic({
      id,
      configured,
      apiKeyPresent: configured,
      lastCheckResult: connected
        ? 'live_provider_connected'
        : configured
          ? `live_provider_${provider?.health.toLowerCase() ?? 'unknown'}`
          : 'missing_api_key',
      ...(!configured ? { reason: missingNotes } : {}),
      ...(degraded ? { reason: provider?.note ?? 'Live provider check did not report CONNECTED.' } : {}),
    }),
    notes: connected
      ? `${configuredNotes} Live provider health check connected.`
      : configured
        ? `${configuredNotes} Configured but not connected: ${provider?.note ?? 'live provider health unknown.'}`
        : missingNotes,
  })
}

function ideEngine(id: 'cursor' | 'codex', lastChecked: string): EngineStatus {
  const reg = registryRow(id)
  const configured = id === 'codex' ? Boolean(process.env.OPENAI_API_KEY?.trim()) : true
  return finalize({
    id,
    displayName: reg.displayName,
    category: reg.category,
    providerType: reg.providerType,
    installed: false,
    configured,
    reachable: false,
    functional: false,
    capabilities: [...reg.defaultCapabilities],
    lastChecked,
    notes:
      id === 'cursor'
        ? 'Cursor is a manual engineering workspace. War Room prepares handoff packets but does not invoke the IDE.'
        : 'Codex / IDE flows — OPENAI_API_KEY marks provider configuration only; IDE runtime not probed here.',
  })
}

/**
 * Read-only probes against Google Generative Language API (HTTPS). Uses `x-goog-api-key` only;
 * never logs the key or `GEMINI_API_KEY`.
 */
export async function probeGeminiApi(
  apiKey: string,
  signal: AbortSignal,
): Promise<{
  reachable: boolean
  functional: boolean
  notes: string
  lastSuccessfulProbeAt: string | null
  functionalModelId: string | null
}> {
  const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
  try {
    const listed = await fetchGeminiListModelsJson(apiKey, signal)
    if (!listed.ok) {
      return {
        reachable: false,
        functional: false,
        notes: `Gemini list models request failed (HTTP ${listed.status}).`,
        lastSuccessfulProbeAt: null,
        functionalModelId: null,
      }
    }

    const allowed = geminiAllowedGenerateContentIds(listed.json)
    const candidates = geminiOrderedCandidates(allowed)

    for (const modelId of candidates) {
      const genRes = await fetch(`${GEMINI_REST_BASE}/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers,
        signal,
        cache: 'no-store',
        body: JSON.stringify({
          contents: [{ parts: [{ text: '.' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      })
      if (genRes.ok) {
        return {
          reachable: true,
          functional: true,
          notes: `Gemini API reachable; minimal generateContent succeeded (${modelId}).`,
          lastSuccessfulProbeAt: new Date().toISOString(),
          functionalModelId: modelId,
        }
      }
    }

    return {
      reachable: true,
      functional: false,
      notes:
        candidates.length === 0
          ? 'Gemini list models succeeded but no council fallback model is available for generateContent on this key.'
          : 'Gemini list models succeeded but minimal generateContent failed for every listed fallback model.',
      lastSuccessfulProbeAt: null,
      functionalModelId: null,
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      reachable: false,
      functional: false,
      notes: aborted ? 'Gemini API probe timed out.' : 'Gemini API probe failed (network or TLS).',
      lastSuccessfulProbeAt: null,
      functionalModelId: null,
    }
  }
}

/**
 * True when `GEMINI_API_KEY` is set and the same HTTPS probe used for engine status
 * (`listModels` + minimal `generateContent`) succeeds. Does not log the key.
 */
export async function isGeminiFunctional(): Promise<boolean> {
  const rawKey = process.env.GEMINI_API_KEY
  if (typeof rawKey !== 'string' || !rawKey.trim()) return false
  const apiKey = rawKey.trim()
  const controller = new AbortController()
  const t = windowlessTimeout(() => controller.abort(), 10_000)
  try {
    const probe = await probeGeminiApi(apiKey, controller.signal)
    return probe.functional
  } finally {
    clearTimeout(t)
  }
}

function buildGemini(lastChecked: string, tools: ToolRoutingSnapshot, provider: ProviderRuntimeStatus | undefined): EngineStatus {
  const reg = registryRow('gemini')
  const configured = Boolean(provider?.configured)
  const connected = provider?.health === 'CONNECTED'

  if (!configured) {
    return finalize({
      id: 'gemini',
      displayName: reg.displayName,
      category: reg.category,
      providerType: reg.providerType,
      installed: true,
      configured: false,
      reachable: false,
      functional: false,
      capabilities: [...reg.defaultCapabilities],
      lastChecked,
      lastSuccessfulProbeAt: null,
      providerDiagnostics: providerDiagnostic({
        id: 'gemini',
        configured: false,
        apiKeyPresent: false,
        lastCheckResult: 'missing_api_key',
        reason: 'Set GEMINI_API_KEY for Gemini API access.',
      }),
      notes: 'Set GEMINI_API_KEY for Gemini API access.',
      probedModelId: null,
    })
  }

  const capabilities: EngineCapabilityId[] = [...reg.defaultCapabilities]
  if (tools.internetReachable && connected) {
    capabilities.push('chat', 'reasoning', 'research_assist')
  }

  return finalize({
    id: 'gemini',
    displayName: reg.displayName,
    category: reg.category,
    providerType: reg.providerType,
    installed: true,
    configured: true,
    reachable: connected,
    functional: connected,
    capabilities,
    lastChecked,
    lastSuccessfulProbeAt: provider?.lastSuccessAt ?? null,
    probedModelId: provider?.activeModels[0] ?? null,
    providerDiagnostics: providerDiagnostic({
      id: 'gemini',
      configured: true,
      apiKeyPresent: true,
      lastCheckResult: connected
        ? 'live_provider_connected'
        : `live_provider_${provider?.health.toLowerCase() ?? 'unknown'}`,
      ...(connected ? {} : { reason: provider?.note ?? 'Live provider check did not report CONNECTED.' }),
    }),
    notes: connected
      ? 'Gemini live provider health check connected.'
      : `Gemini configured but not connected: ${provider?.note ?? 'live provider health unknown.'}`,
  })
}

/**
 * Build a truthful `EngineStatus` row for every registered engine.
 * Pass `tools` from `buildToolRoutingSnapshotFromOrigin` so Gemini can merge `research_assist` / related caps when the same-origin internet tool is available.
 */
export async function collectEngineStatuses(
  tools: ToolRoutingSnapshot = { internetReachable: false, researchConfigured: false },
): Promise<EngineStatus[]> {
  const lastChecked = new Date().toISOString()
  const providerRuntime = await getProviderRuntimeHealth()
  const providerById = new Map(providerRuntime.providers.map(provider => [provider.id, provider]))

  const gemini = buildGemini(lastChecked, tools, providerById.get(ENGINE_PROVIDER_RUNTIME_ID.gemini!))

  const ordered: EngineStatus[] = [
    ideEngine('cursor', lastChecked),
    ideEngine('codex', lastChecked),
    cloudEngine('grok', lastChecked, providerById.get(ENGINE_PROVIDER_RUNTIME_ID.grok!), 'xAI Grok.', 'Set XAI_API_KEY for Grok API access.'),
    cloudEngine('claude', lastChecked, providerById.get(ENGINE_PROVIDER_RUNTIME_ID.claude!), 'Anthropic Claude.', 'Set ANTHROPIC_API_KEY for Claude API access.'),
    cloudEngine('chatgpt', lastChecked, providerById.get(ENGINE_PROVIDER_RUNTIME_ID.chatgpt!), 'OpenAI Chat Completions.', 'Set OPENAI_API_KEY for OpenAI API access.'),
    gemini,
    cloudEngine('kimi', lastChecked, providerById.get(ENGINE_PROVIDER_RUNTIME_ID.kimi!), 'Moonshot Kimi.', 'Set KIMI_API_KEY (or MOONSHOT_API_KEY) for Kimi API access.'),
  ]

  return ordered
}

export function buildEngineControlStatusResponse(engines: EngineStatus[]): EngineControlStatusResponse {
  const timestamp = new Date().toISOString()
  const configuredProviders = engines.filter(engine => engine.configured).map(engine => engine.id)
  const reachableProviders = engines.filter(engine => engine.reachable).map(engine => engine.id)
  const functionalProviders = engines.filter(engine => engine.functional).map(engine => engine.id)
  const cloudEngines = engines.filter(engine => engine.category === 'cloud' || engine.category === 'cloud_model')
  const functionalCloud = cloudEngines.filter(engine => engine.functional)
  const routingReadiness: EngineControlStatusResponse['routingReadiness'] =
    functionalCloud.length > 0
      ? functionalCloud.length === cloudEngines.length
        ? 'ready'
        : 'degraded'
      : 'unavailable'
  const degradedReason = routingReadiness === 'ready'
    ? null
    : cloudEngines
      .filter(engine => !engine.functional)
      .map(engine => `${engine.id}: ${engine.notes}`)
      .join(' | ') || 'No functional cloud engine reported.'

  return {
    engines,
    configuredProviders,
    reachableProviders,
    functionalProviders,
    routingReadiness,
    approvalRequired: engines.some(engine => engine.approvalRequired),
    timestamp,
    degradedReason,
    checkedAt: timestamp,
  }
}

/** Trimmed list for route-command responses (avoid huge payloads). */
export function summarizeEngines(engines: EngineStatus[]) {
  return engines.map(e => ({
    id: e.id,
    functional: e.functional,
    reachable: e.reachable,
    configured: e.configured,
  }))
}
