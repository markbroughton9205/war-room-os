import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import { resolveCouncilRoutingMode, resolveCouncilRoutingPreference } from '@/lib/council/live-orchestration/backends/routingMode'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'
import { buildCouncilRosterSnapshot } from '@/lib/council/live-orchestration/rosterHealth'

/**
 * Packaged-equivalent live proof: 0 cloud keys, COUNCIL_ROUTING_MODE unset (AUTO),
 * AppData council-runtime.json disabled, no routingModeOverride, real Ollama inference.
 * Must not pass from mocks. Must not claim a cloud provider is active.
 */

export type ContinuityLiveResult = { name: string; pass: boolean; detail: string }

const CLOUD_KEY_ENV_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY']

const PACKAGED_EQUIVALENT = {
  COUNCIL_ROUTING_MODE: undefined,
  WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH: '',
} as const

async function withPackagedEquivalentEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const name of [...CLOUD_KEY_ENV_NAMES, 'COUNCIL_ROUTING_MODE', 'WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH']) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  process.env.WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH = PACKAGED_EQUIVALENT.WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH
  try {
    return await fn()
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

export async function runCouncilContinuityLiveProof(): Promise<ContinuityLiveResult[]> {
  const results: ContinuityLiveResult[] = []
  const probe = await probeOllama()
  const installed = probe.models.some(
    name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'),
  )
  results.push({
    name: 'live_ollama_reachable',
    pass: probe.available && installed,
    detail: probe.available ? `installed=${probe.models.join(',')}` : `unreachable: ${probe.detail}`,
  })
  if (!probe.available || !installed) {
    results.push({
      name: 'live_packaged_equivalent_council_request',
      pass: false,
      detail: 'skipped - Ollama or shared local model not available; not a mocked pass',
    })
    return results
  }

  await withPackagedEquivalentEnv(async () => {
    const preference = resolveCouncilRoutingPreference()
    const mode = resolveCouncilRoutingMode()
    results.push({
      name: 'live_packaged_equivalent_routing_is_AUTO_LOCAL_FIRST',
      pass: preference === 'AUTO' && mode === 'LOCAL_FIRST',
      detail: `preference=${preference} mode=${mode}`,
    })

    const roster = buildCouncilRosterSnapshot({
      configured: { chatgpt: false, claude: false, grok: false, gemini: false },
      continuity: { localReady: true, routingPreference: preference, routingModeResolved: mode },
    })
    const fakeCloud = [roster.families.chatgpt, roster.families.claude, roster.families.grok, roster.families.gemini]
      .some(entry => entry?.cloudState === 'AVAILABLE' || /READY/i.test(entry?.uiDetail ?? '') && /OpenAI|Anthropic|xAI|Gemini/.test(entry?.uiDetail ?? ''))
    results.push({
      name: 'live_roster_no_false_cloud_ready',
      pass: roster.operationalState === 'READY_LOCAL' && !fakeCloud && roster.families.chatgpt?.cloudState === 'NOT_CONFIGURED',
      detail: `state=${roster.operationalState} aurora=${roster.families.chatgpt?.uiDetail}`,
    })

    const deltas: string[] = []
    const result = await invokeCouncilSeat({
      seat: 'chatgpt',
      systemPrompt: 'You are AURORA in War Room. Answer in one short sentence.',
      userPrompt: 'Council, confirm local continuity is operating. One sentence.',
      maxTokens: 120,
      signal: new AbortController().signal,
      onDelta: delta => {
        if (delta) deltas.push(delta)
      },
      timeoutKind: 'social',
    })

    const local = result.backend.backendType === 'LOCAL'
    const providerHonest = result.backend.provider === 'ollama'
    const notFrontier = !['openai', 'anthropic', 'xai', 'google', 'OpenAI', 'Anthropic'].includes(result.backend.provider)
    const modelLocal = result.backend.model === NEBULA_SHARED_LOCAL_MODEL_ID || result.backend.model.startsWith('huihui_ai/qwen3-abliterated:')
    results.push({
      name: 'live_request_accepted_local_inference',
      pass: result.ok && local && providerHonest && notFrontier && modelLocal && result.text.trim().length > 0,
      detail: `ok=${result.ok} type=${result.backend.backendType} provider=${result.backend.provider} model=${result.backend.model} textLen=${result.text.length} deltas=${deltas.length}`,
    })
    results.push({
      name: 'live_audit_backing_is_local_not_cloud',
      pass: local && providerHonest && notFrontier && result.backend.status === 'OK',
      detail: JSON.stringify({
        backendType: result.backend.backendType,
        provider: result.backend.provider,
        model: result.backend.model,
        status: result.backend.status,
        fallbackFrom: result.backend.fallbackFrom ?? null,
      }),
    })
  })

  return results
}
