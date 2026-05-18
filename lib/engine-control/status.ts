import {
  GEMINI_REST_BASE,
  fetchGeminiListModelsJson,
  geminiAllowedGenerateContentIds,
  geminiOrderedCandidates,
} from '@/lib/ai/providers/geminiGenerative'

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
  id: 'grok' | 'claude' | 'chatgpt',
  lastChecked: string,
  configured: boolean,
  configuredNotes: string,
  missingNotes: string,
): EngineStatus {
  const reg = registryRow(id)
  const reachable = configured
  const functional = configured
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
      lastCheckResult: configured ? 'credential_present_call_allowed' : 'missing_api_key',
      ...(configured ? {} : { reason: missingNotes }),
    }),
    notes: configured
      ? `${configuredNotes} Credential present; outbound API health not probed in Phase 2.`
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

function buildGemini(lastChecked: string, tools: ToolRoutingSnapshot): EngineStatus {
  const reg = registryRow('gemini')
  const rawKey = process.env.GEMINI_API_KEY
  const configured = typeof rawKey === 'string' && rawKey.trim().length > 0

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
  if (tools.internetReachable) {
    capabilities.push('chat', 'reasoning', 'research_assist')
  }

  return finalize({
    id: 'gemini',
    displayName: reg.displayName,
    category: reg.category,
    providerType: reg.providerType,
    installed: true,
    configured: true,
    reachable: true,
    functional: true,
    capabilities,
    lastChecked,
    lastSuccessfulProbeAt: null,
    probedModelId: null,
    providerDiagnostics: providerDiagnostic({
      id: 'gemini',
      configured: true,
      apiKeyPresent: true,
      lastCheckResult: 'credential_present_call_allowed_probe_deferred',
    }),
    notes: 'Gemini credential present; live model probe is deferred so transient status checks do not block council calls.',
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

  const gemini = buildGemini(lastChecked, tools)

  const ordered: EngineStatus[] = [
    ideEngine('cursor', lastChecked),
    ideEngine('codex', lastChecked),
    cloudEngine('grok', lastChecked, Boolean(process.env.XAI_API_KEY?.trim()), 'xAI Grok.', 'Set XAI_API_KEY for Grok API access.'),
    cloudEngine('claude', lastChecked, Boolean(process.env.ANTHROPIC_API_KEY?.trim()), 'Anthropic Claude.', 'Set ANTHROPIC_API_KEY for Claude API access.'),
    cloudEngine('chatgpt', lastChecked, Boolean(process.env.OPENAI_API_KEY?.trim()), 'OpenAI Chat Completions.', 'Set OPENAI_API_KEY for OpenAI API access.'),
    gemini,
  ]

  return ordered
}

export function buildEngineControlStatusResponse(engines: EngineStatus[]): EngineControlStatusResponse {
  return {
    engines,
    checkedAt: new Date().toISOString(),
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
