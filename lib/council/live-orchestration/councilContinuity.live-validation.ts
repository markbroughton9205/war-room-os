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
      continuity: { localReady: true, routingPreference: preference, routingModeResolved: mode, networkEgress: 'AVAILABLE', terraConnection: 'CONNECTED' },
    })
    const fakeCloud = [roster.families.chatgpt, roster.families.claude, roster.families.grok, roster.families.gemini]
      .some(entry => entry?.cloudState === 'AVAILABLE' || /OpenAI|Anthropic|xAI|Gemini/.test(entry?.uiDetail ?? ''))
    const fourReady = ['chatgpt', 'claude', 'grok', 'gemini'].every(seat =>
      roster.families[seat as 'chatgpt']?.memberIdentityStatus === 'READY'
    )
    results.push({
      name: 'live_roster_no_false_cloud_ready',
      pass: roster.operationalState === 'READY_LOCAL' && !fakeCloud && roster.families.chatgpt?.cloudState === 'NOT_CONFIGURED' && fourReady,
      detail: `state=${roster.operationalState} aurora=${roster.families.chatgpt?.uiDetail} ready=${fourReady}`,
    })
    results.push({
      name: 'live_roster_identities_are_council_not_vendors',
      pass: roster.families.chatgpt?.identityName === 'AURORA'
        && roster.families.claude?.identityName === 'ORION'
        && roster.families.grok?.identityName === 'PULSAR'
        && roster.families.gemini?.identityName === 'LUMEN'
        && /ROLE.?DIVERSE/i.test(roster.reasoningDiversity ?? ''),
      detail: `diversity=${roster.reasoningDiversity} model=${roster.modelDiversity}`,
    })

    const members = [
      { seat: 'chatgpt' as const, name: 'AURORA', stance: 'broad synthesis / strategic framing' },
      { seat: 'claude' as const, name: 'ORION', stance: 'engineering / architecture / operational viability' },
      { seat: 'grok' as const, name: 'PULSAR', stance: 'research / signals / evidence discovery' },
      { seat: 'gemini' as const, name: 'LUMEN', stance: 'claim verification / calibration / traceability' },
    ]
    const perspectives: { name: string; text: string; backendType: string; provider: string; model: string }[] = []
    for (const member of members) {
      const deltas: string[] = []
      const result = await invokeCouncilSeat({
        seat: member.seat,
        systemPrompt: `You are ${member.name} in the War Room Council. Stay in identity. Do not claim to be OpenAI, Anthropic, xAI, Gemini, ChatGPT, Claude, Grok, or Google. Role: ${member.stance}. Answer in two short sentences as ${member.name}.`,
        userPrompt: `Council task: Confirm you are ${member.name}, that you can reason over War Room knowledge, and give one ${member.stance} observation about local Council continuity. Do not impersonate a commercial provider.`,
        maxTokens: 120,
        signal: new AbortController().signal,
        onDelta: delta => {
          if (delta) deltas.push(delta)
        },
        timeoutKind: 'social',
      })
      const local = result.backend.backendType === 'LOCAL'
      const providerHonest = result.backend.provider === 'ollama'
      const notFrontier = !/openai|anthropic|xai|google/i.test(result.backend.provider)
      const impersonation = /\b(i am (openai|anthropic|xai|google|chatgpt|claude|gemini)|as (openai|anthropic|chatgpt))\b/i.test(result.text)
      const modelLocal = result.backend.model === NEBULA_SHARED_LOCAL_MODEL_ID || result.backend.model.startsWith('huihui_ai/qwen3-abliterated:')
      perspectives.push({
        name: member.name,
        text: result.text,
        backendType: result.backend.backendType,
        provider: result.backend.provider,
        model: result.backend.model,
      })
      results.push({
        name: `live_${member.name}_receives_task_with_identity`,
        pass: result.ok && local && providerHonest && notFrontier && modelLocal && result.text.trim().length > 0 && !impersonation,
        detail: `ok=${result.ok} identity=${member.name} type=${result.backend.backendType} provider=${result.backend.provider} model=${result.backend.model} textLen=${result.text.length} impersonation=${impersonation}`,
      })
    }

    const uniqueBackends = new Set(perspectives.map(row => `${row.backendType}:${row.provider}:${row.model}`))
    results.push({
      name: 'live_diversity_truth_shared_local_model',
      pass: perspectives.length === 4 && uniqueBackends.size === 1,
      detail: `entities=${perspectives.length} uniqueBackends=${uniqueBackends.size} models=${[...uniqueBackends].join('|')}`,
    })

    const synthesisDeltas: string[] = []
    const synthesis = await invokeCouncilSeat({
      seat: 'chatgpt',
      systemPrompt: 'You are AURORA, War Room Council synthesizer. Combine the four Council perspectives without claiming four independent model brains.',
      userPrompt: `Synthesize these Council perspectives in 3 sentences. Disclose that they share one local backend if that is true.\n${perspectives.map(row => `${row.name} [${row.provider}/${row.model}]: ${row.text}`).join('\n')}`,
      maxTokens: 180,
      signal: new AbortController().signal,
      onDelta: delta => {
        if (delta) synthesisDeltas.push(delta)
      },
      timeoutKind: 'social',
    })
    results.push({
      name: 'live_council_synthesis_from_four_entities',
      pass: synthesis.ok && synthesis.backend.backendType === 'LOCAL' && synthesis.text.trim().length > 0,
      detail: `ok=${synthesis.ok} type=${synthesis.backend.backendType} provider=${synthesis.backend.provider} textLen=${synthesis.text.length} deltas=${synthesisDeltas.length}`,
    })
  })

  return results
}
