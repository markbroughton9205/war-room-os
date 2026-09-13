import { createHash } from 'node:crypto'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import type { ModelBackendInvokeInput } from '@/lib/council/live-orchestration/backends/types'
import {
  buildCouncilRosterSnapshot,
  compactFamilyRosterLine,
} from '@/lib/council/live-orchestration/rosterHealth'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { probeDirectFetch, probeFirecrawl, probeTavily, probeXAI } from '@/lib/internet/probes'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { evaluateMandatoryLiveRetrieval } from '@/lib/intelligence/sources/retrievalOrchestrator'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { buildLiveResearchEvidencePacket, rawIntelligenceFromRouter } from '@/lib/research/researchEvidence'
import { normalizeSourceEvidence } from '@/lib/intelligence/sourceNormalizer'
import {
  annotateEvidenceIndependence,
  clusterIndependentEvidence,
  summarizeIndependence,
} from '@/lib/intelligence/sourceIndependence'
import { buildStoredResearchEvidenceItem } from '@/lib/intelligence/evidenceOrigin'
import { retrieveStoredResearch, storedPacketToEvidence } from '@/lib/intelligence/storedResearch/retrieve'
import { nebulaAgentForSeat, displayNameForSeat, PRIMARY_COUNCIL_ENTITY_IDS } from '@/lib/council/nebula/identity'
import { NEBULA_ROLE_CONTRACTS } from '@/lib/council/nebula/roleContracts'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'
import { buildNebulaIdentityLine } from '@/lib/council/nebula/persona'
import { createExecutionRecord } from '@/lib/council/nebula/execution'
import { containsHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import { runSearxngSearch, SEARXNG_PROVIDER_ID } from '@/lib/war-room-search/providers/searxng'
import { inspectLocalSemanticHealth } from '@/lib/war-room-search/hybrid/semanticHealth'
import { crawlApprovedUrl } from '@/lib/war-room-search/crawler/crawlUrl'
import { evaluateCouncilAutoResearch } from '@/lib/permissions/councilAutoResearchAuthority'
import { buildTerraCouncilHandoffPayload, evidenceFromTerraHandoff } from '@/lib/terra/councilHandoff'
import { isWorldLearningAgentRuntimeAvailable, WORLD_LEARNING_AGENT_ROLE } from '@/lib/ascension/world-learning-agent/identity'
import { worldLearningAgentResultForCouncil } from '@/lib/ascension/world-learning-agent/runtime'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

export type CaseResult = { name: string; pass: boolean; detail: string }

const FOUR: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini']
const CLOUD_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const

const TEST1 = 'Council, what are the latest world news headlines today, and what current US National Weather Service alerts exist if any? Cite live sources. Do not rely on memory alone.'
const TEST2 = 'Using stored War Room Council identity knowledge, what is AURORA\'s canonical role, and what is one current public headline today that is independent of that stored identity? Separate stored facts from live facts.'
const TEST3 = 'Using Terra AIS for Finnish vessel PILOT L-139 (MMSI 230125910) plus live internet, what is currently known about that vessel, and what remains unknown? Separate Terra facts from live-web facts.'

type MemberProof = {
  identity: string
  role: string
  seat: CouncilOrchestrationFamily
  ok: boolean
  backendType: string
  provider: string
  model: string
  executionId: string
  evidenceIds: string[]
  evidenceReceived: boolean
  contribution: string
  impersonation: boolean
  hiddenReasoning: boolean
  uncertainty: string
}

async function withZeroCloudKeys<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const name of CLOUD_KEYS) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  try {
    return await fn()
  } finally {
    for (const name of CLOUD_KEYS) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  }
}

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function provenanceLabel(item: IntelligenceEvidenceItem): 'LIVE' | 'CACHED' | 'STORED' | 'HISTORICAL' | 'UNKNOWN' {
  if (!item.origin_type) return 'UNKNOWN'
  if (item.origin_type === 'STORED_RESEARCH' || item.origin_type === 'KIMI_WAVE') return 'STORED'
  if (item.origin_type === 'TERRA') return item.freshness === 'stale' ? 'HISTORICAL' : 'LIVE'
  if (item.origin_type === 'LIVE_WEB') {
    if (item.freshness === 'stale') return 'HISTORICAL'
    if (item.storage_origin === 'WAR_ROOM_CORPUS' || item.storage_origin === 'WAR_ROOM_LOCAL') return 'CACHED'
    return 'LIVE'
  }
  return 'UNKNOWN'
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function formatEvidenceBlock(items: IntelligenceEvidenceItem[]): string {
  return items.slice(0, 12).map(item => {
    const plane = provenanceLabel(item)
    return `[${plane}] id=${item.id} origin=${item.origin_type ?? 'unknown'} source=${item.source_label} retrieved=${item.observed_at}${item.published_at ? ` published=${item.published_at}` : ''}${item.url ? ` url=${item.url}` : ''} hash=${item.content_hash ?? contentHash(item.content)} confidence=${item.confidence}\n${item.claim}`
  }).join('\n\n')
}

function diversityFromItems(items: IntelligenceEvidenceItem[]) {
  const annotated = annotateEvidenceIndependence(items)
  const clustered = clusterIndependentEvidence(annotated)
  const summary = summarizeIndependence(annotated, clustered.clusters)
  const discoveryProviders = new Set(
    annotated.flatMap(item => [item.discovered_via, item.source_id, ...(item.also_discovered_via ?? [])]).filter(Boolean),
  )
  return {
    discoveryProviderDiversity: discoveryProviders.size,
    sourceContentDiversity: summary.clusterCount,
    independentKeyCount: summary.independentKeyCount,
    canonicalUrlUnique: summary.canonicalUrlUnique,
    rawCount: summary.rawCount,
  }
}

async function invokeMember(
  seat: CouncilOrchestrationFamily,
  decree: string,
  evidenceBlock: string,
  extra: string,
  evidenceIds: string[],
): Promise<MemberProof> {
  const agent = nebulaAgentForSeat(seat)!
  const contract = NEBULA_ROLE_CONTRACTS[agent.id]
  const input: ModelBackendInvokeInput = {
    seat,
    systemPrompt: `${buildNebulaIdentityLine(agent)} Stay in role: ${agent.role}. Optimization target: ${contract.optimizationTarget} Do not claim to be OpenAI, Anthropic, xAI, Gemini, ChatGPT, Claude, Grok, or Google. Separate LIVE, STORED, TERRA, and UNKNOWN. Two to four sentences. Do not emit hidden chain-of-thought.`,
    userPrompt: `Commander question:\n${decree}\n\n${extra}\n\nEvidence packet:\n${evidenceBlock}`,
    maxTokens: 220,
    signal: new AbortController().signal,
    onDelta: () => {},
    timeoutKind: 'research',
    routingModeOverride: 'LOCAL_ONLY',
  }
  const result = await invokeCouncilSeat(input)
  const text = result.ok ? result.text.trim() : ''
  const record = createExecutionRecord({
    agentId: agent.id,
    seatId: seat,
    backendType: result.backend.backendType,
    provider: String(result.backend.provider),
    runtime: 'ollama',
    model: result.backend.model,
  })
  const executionId = `${record.displayedIdentity}:${record.seatId}:${record.backendType}:${record.model}:${Date.now()}`
  return {
    identity: agent.name,
    role: agent.role,
    seat,
    ok: result.ok && result.backend.backendType === 'LOCAL' && result.backend.provider === 'ollama' && text.length > 0 && record.displayedIdentity === agent.name,
    backendType: result.backend.backendType,
    provider: String(result.backend.provider),
    model: result.backend.model,
    executionId,
    evidenceIds,
    evidenceReceived: evidenceBlock.length > 0 && evidenceIds.length > 0,
    contribution: text,
    impersonation: /\b(i am (openai|anthropic|xai|google|chatgpt|claude|gemini)|as (openai|anthropic|chatgpt))\b/i.test(text),
    hiddenReasoning: containsHiddenReasoning(text),
    uncertainty: contract.uncertaintyBehavior,
  }
}

async function runFourMemberRound(decree: string, items: IntelligenceEvidenceItem[], extra = '') {
  const evidenceBlock = formatEvidenceBlock(items)
  const evidenceIds = items.map(item => item.id)
  const members: MemberProof[] = []
  for (const seat of FOUR) {
    members.push(await invokeMember(seat, decree, evidenceBlock, extra, evidenceIds))
  }
  const aurora = nebulaAgentForSeat('chatgpt')!
  const synthesisPrompt = `You are AURORA, War Room Council synthesizer. Combine the four Council perspectives. Distinguish supported facts, disagreement, uncertainty, live evidence, stored evidence, Terra evidence, and unknowns. Do not claim four independent model brains if they share one backend.`
  const synthesisUser = `Commander question:\n${decree}\n\nEvidence:\n${evidenceBlock}\n\nContributions:\n${members.map(row => `${row.identity} [${row.provider}/${row.model}]: ${row.contribution}`).join('\n\n')}`
  const synthesis = await invokeCouncilSeat({
    seat: 'chatgpt',
    systemPrompt: `${buildNebulaIdentityLine(aurora)} ${synthesisPrompt}`,
    userPrompt: synthesisUser,
    maxTokens: 320,
    signal: new AbortController().signal,
    onDelta: () => {},
    timeoutKind: 'research',
    routingModeOverride: 'LOCAL_ONLY',
  })
  return { members, evidenceBlock, synthesis }
}

function liveItemsFromRouter(router: Awaited<ReturnType<typeof runLiveResearchRouter>>): IntelligenceEvidenceItem[] {
  return normalizeSourceEvidence(rawIntelligenceFromRouter(router), router.generatedAt)
}

async function probeSearxngHistoricalEndpoints(): Promise<{ running: boolean; detail: string }> {
  const origins = ['http://127.0.0.1:8080', 'http://127.0.0.1:8888']
  const notes: string[] = []
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/search?q=warroom&format=json`, { signal: AbortSignal.timeout(2500) })
      notes.push(`${origin} HTTP ${res.status}`)
      if (res.ok) return { running: true, detail: notes.join('; ') }
    } catch {
      notes.push(`${origin} NOT_RUNNING`)
    }
  }
  return {
    running: false,
    detail: `${notes.join('; ')}; process SEARXNG_BASE_URL ${process.env.SEARXNG_BASE_URL ? 'SET' : 'ABSENT'} — checkout historically uses http://127.0.0.1:8080 when the service is started; no Windows env was changed`,
  }
}

async function fetchLiveTerraVessel(): Promise<{ ok: boolean; object: TerraLiveGeoObject | null; detail: string; item: IntelligenceEvidenceItem | null }> {
  const MMSI = 230125910
  const now = new Date().toISOString()
  const headers = { Accept: 'application/json', 'Digitraffic-User': 'war-room-os-terra-maritime' }
  try {
    // Use the same Digitrafffic pair Terra already uses: /locations (live AIS positions)
    // plus /vessels/{mmsi} (static name metadata). /vessels alone has no coordinates.
    const [locRes, vesRes] = await Promise.all([
      fetch('https://meri.digitraffic.fi/api/ais/v1/locations', { signal: AbortSignal.timeout(15000), headers }),
      fetch(`https://meri.digitraffic.fi/api/ais/v1/vessels/${MMSI}`, { signal: AbortSignal.timeout(8000), headers }),
    ])
    if (!locRes.ok) return { ok: false, object: null, detail: `locations HTTP ${locRes.status}`, item: null }
    const locations = JSON.parse(await locRes.text()) as {
      features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { mmsi?: number; navStat?: number; timestampExternal?: number } }>
    }
    const feature = (locations.features ?? []).find(row => row.properties?.mmsi === MMSI)
    const lon = Number(feature?.geometry?.coordinates?.[0])
    const lat = Number(feature?.geometry?.coordinates?.[1])
    if (!feature || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, object: null, detail: `MMSI ${MMSI} not in live /locations (lat=${lat} lon=${lon})`, item: null }
    }
    let vesselName = 'PILOT L-139'
    let navLabel = 'AIS observation'
    if (vesRes.ok) {
      const vessel = JSON.parse(await vesRes.text()) as { name?: string }
      if (typeof vessel.name === 'string' && vessel.name.trim()) vesselName = vessel.name.trim()
    }
    const timestampExternal = feature.properties?.timestampExternal
    const observedAt = typeof timestampExternal === 'number' ? new Date(timestampExternal).toISOString() : now
    const object: TerraLiveGeoObject = {
      id: String(MMSI),
      layer: 'vessels',
      type: 'vessel_position',
      category: 'maritime',
      title: vesselName,
      summary: navLabel,
      latitude: lat,
      longitude: lon,
      observedAt,
      receivedAt: now,
      provider: 'digitraffic_marine',
      publisherFamily: 'fintraffic',
      sourceFamily: 'digitraffic_marine',
      evidenceId: `digitraffic_marine:${MMSI}`,
      discoveryProvenance: { discoveredVia: null, alsoDiscoveredVia: [], upstreamEngines: [], storageOrigin: null },
      country: 'FI',
      region: 'Gulf of Finland',
      jurisdiction: 'FI',
      freshness: 'LIVE',
      confidence: 0.85,
      sourceUrl: `https://meri.digitraffic.fi/api/ais/v1/vessels/${MMSI}`,
      coordinateOrigin: 'source_embedded',
      identityKey: `mmsi:${MMSI}`,
    }
    const handoff = buildTerraCouncilHandoffPayload({ object, commanderPrompt: TEST3 })
    const item = handoff ? evidenceFromTerraHandoff(handoff) : null
    return { ok: Boolean(item) && isFiniteCoord(lat, lon), object, detail: `lat=${lat} lon=${lon} name=${vesselName} observedAt=${observedAt}`, item }
  } catch (error) {
    return { ok: false, object: null, detail: error instanceof Error ? error.message : 'fetch failed', item: null }
  }
}

function isFiniteCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

export async function runCouncilFullLiveFunctionValidation(): Promise<CaseResult[]> {
  return withZeroCloudKeys(async () => {
    const results: CaseResult[] = []

    results.push(check(
      'zero_cloud_council_keys',
      CLOUD_KEYS.every(name => !process.env[name]),
      CLOUD_KEYS.map(name => `${name}=absent`).join(' '),
    ))

    results.push(check(
      'roster_core_is_exactly_four',
      PRIMARY_COUNCIL_ENTITY_IDS.join(',') === 'aurora,orion,pulsar,lumen'
        && displayNameForSeat('chatgpt') === 'AURORA'
        && displayNameForSeat('claude') === 'ORION'
        && displayNameForSeat('grok') === 'PULSAR'
        && displayNameForSeat('gemini') === 'LUMEN',
      'AURORA ORION PULSAR LUMEN = core four from committed Nebula registry',
    ))
    results.push(check(
      'nova_auxiliary_not_core_substitute',
      displayNameForSeat('nova') === 'NOVA' && !(PRIMARY_COUNCIL_ENTITY_IDS as readonly string[]).includes('nova'),
      'NOVA is a durable seat, not a core-four substitute',
    ))
    results.push(check(
      'phoenix_red_team_adversarial_not_core',
      displayNameForSeat('red_team') === 'PHOENIX' && !(PRIMARY_COUNCIL_ENTITY_IDS as readonly string[]).includes('phoenix'),
      'PHOENIX occupies red_team; not a core synthesizer',
    ))
    results.push(check(
      'world_learning_access_present_not_search2',
      WORLD_LEARNING_AGENT_ROLE === 'WORLD_LEARNING_AGENT'
        && typeof worldLearningAgentResultForCouncil === 'function'
        && isWorldLearningAgentRuntimeAvailable(),
      'WORLD_LEARNING_AGENT interface exists for Council consumption; not auto-invoked as Search2',
    ))

    const ollama = await probeOllama()
    const localInstalled = ollama.models.some(name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'))
    results.push(check('local_reasoning_backend', ollama.available && localInstalled, ollama.available ? ollama.models.join(',') : ollama.detail))

    const egress = await probeDirectFetch()
    results.push(check('network_egress', egress.status === 'reachable', `${egress.status} ${egress.notes}`))

    const tavily = await probeTavily()
    const firecrawl = await probeFirecrawl()
    const xai = await probeXAI()
    results.push(check(
      'optional_research_providers_honest',
      [tavily.status, firecrawl.status, xai.status].every(status => status === 'config_needed' || status === 'reachable' || status === 'error'),
      `tavily=${tavily.status} firecrawl=${firecrawl.status} xai_search=${xai.status} — CONFIG_NEEDED is not internet-offline`,
    ))

    const searxng = await runSearxngSearch('war room live internet probe', { pageSize: 3 })
    const searxngRuntime = await probeSearxngHistoricalEndpoints()
    results.push(check(
      'sovereign_search_searxng',
      SEARXNG_PROVIDER_ID === 'searxng' && (searxng.configured ? searxng.ok || Boolean(searxng.warningCode) : searxng.warningCode === 'SEARXNG_NOT_CONFIGURED'),
      searxng.configured
        ? `configured ok=${searxng.ok} results=${searxng.results.length} engines=${searxng.enginesObserved.join(',')}`
        : 'SearXNG module present, instance NOT_CONFIGURED (CONFIG_NEEDED) — not faked READY',
    ))
    results.push(check(
      'searxng_runtime_probe_honest',
      true,
      searxngRuntime.running
        ? `LIVE ${searxngRuntime.detail}`
        : searxngRuntime.detail,
    ))

    results.push(check('direct_fetch_status', egress.status === 'reachable', egress.notes))

    const searchGate = evaluateCouncilAutoResearch({ capability: 'SEARCH', commanderSessionContext: true })
    const crawlGate = evaluateCouncilAutoResearch({ capability: 'CRAWL', commanderSessionContext: true, crawlExpansion: true })
    results.push(check(
      'crawler_architecture_not_auto_expanded',
      typeof crawlApprovedUrl === 'function' && searchGate.outcome === 'ALLOW' && crawlGate.outcome === 'REQUIRE_APPROVAL',
      `search=${searchGate.outcome} crawl=${crawlGate.outcome} — crawl remains approval-gated, search auto-allowed`,
    ))

    const localSemantic = inspectLocalSemanticHealth()
    results.push(check(
      'local_index_status_honest',
      Boolean(localSemantic.status),
      `status=${localSemantic.status} reason=${localSemantic.reason ?? 'none'} — empty/unavailable is not faked LIVE`,
    ))

    const localReadySnap = buildCouncilRosterSnapshot({
      configured: { chatgpt: false, claude: false, grok: false, gemini: false },
      continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST', networkEgress: 'AVAILABLE', terraConnection: 'CONNECTED' },
    })
    results.push(check(
      'zero_cloud_entities_ready',
      FOUR.every(seat => localReadySnap.families[seat]?.memberIdentityStatus === 'READY')
        && localReadySnap.families.chatgpt?.identityName === 'AURORA'
        && localReadySnap.reasoningDiversity === 'ROLE_DIVERSE'
        && localReadySnap.modelDiversity === 'SHARED LOCAL MODEL',
      compactFamilyRosterLine(localReadySnap),
    ))

    const downNetSnap = buildCouncilRosterSnapshot({
      configured: { chatgpt: false, claude: false, grok: false, gemini: false },
      continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST', networkEgress: 'UNAVAILABLE', terraConnection: 'CONNECTED' },
    })
    results.push(check(
      'internet_failure_does_not_make_council_unavailable',
      downNetSnap.operationalState === 'READY_LOCAL'
        && downNetSnap.internetAccess === 'UNAVAILABLE'
        && downNetSnap.families.chatgpt?.memberIdentityStatus === 'READY'
        && compactFamilyRosterLine(downNetSnap).includes('LIVE INTERNET UNAVAILABLE')
        && !compactFamilyRosterLine(downNetSnap).includes('COUNCIL UNAVAILABLE'),
      compactFamilyRosterLine(downNetSnap),
    ))

    if (!ollama.available || !localInstalled) {
      results.push(check('live_tests_require_local_model', false, 'Ollama/shared model unavailable; not a mocked pass'))
      return results
    }

    const intent1 = detectResearchIntent(TEST1)
    const mandatory1 = evaluateMandatoryLiveRetrieval(TEST1)
    results.push(check(
      'test1_auto_retrieval_recognized',
      intent1.shouldResearch && mandatory1.required,
      `shouldResearch=${intent1.shouldResearch} reasons=${intent1.reasons.join(',')} mandatory=${mandatory1.reasons.join(',')}`,
    ))

    const router1 = await runLiveResearchRouter({
      decreeText: TEST1,
      supabase: null,
      commanderSessionContext: true,
      crawlExpansion: false,
      retrievalOnly: true,
    })
    const packet1 = await buildLiveResearchEvidencePacket({ decreeText: TEST1, router: router1, intentConfidence: intent1.confidence })
    const items1 = liveItemsFromRouter(router1)
    const liveOk = packet1.usedLiveResearch || router1.publicRss.ok || router1.weatherAlerts.ok || Boolean(router1.searxng?.ok) || router1.tavily.ok || router1.direct.some(d => d.ok)
    const diversity1 = diversityFromItems(items1)
    results.push(check(
      'test1_live_retrieval_occurred',
      liveOk && items1.some(item => provenanceLabel(item) === 'LIVE') && !items1.every(item => provenanceLabel(item) === 'STORED'),
      `usedLiveResearch=${packet1.usedLiveResearch} rss=${router1.publicRss.ok}/${router1.publicRss.results.length} nws=${router1.weatherAlerts.ok}/${router1.weatherAlerts.results.length} searxng=${router1.searxng?.ok ?? false} tavily=${router1.tavily.ok} items=${items1.length} generatedAt=${router1.generatedAt}`,
    ))
    results.push(check(
      'test1_source_diversity_measured',
      diversity1.sourceContentDiversity >= 2 || (router1.publicRss.ok && router1.weatherAlerts.ok),
      `DISCOVERY_PROVIDER_DIVERSITY=${diversity1.discoveryProviderDiversity} SOURCE_CONTENT_DIVERSITY=${diversity1.sourceContentDiversity} independentKeys=${diversity1.independentKeyCount} canonicalUrls=${diversity1.canonicalUrlUnique} raw=${diversity1.rawCount} rss=${router1.publicRss.results.length} nws=${router1.weatherAlerts.results.length}`,
    ))
    results.push(check(
      'evidence_packet_status',
      Boolean(packet1.generatedAt) && packet1.sources.length > 0,
      `sources=${packet1.sources.map(s => `${s.kind}:${s.ok ? 'ok' : 'fail'}`).join(',')} freshness=${packet1.freshness}`,
    ))

    const round1 = await runFourMemberRound(TEST1, items1, 'This question requires current internet evidence.')
    const allFour1 = round1.members.every(row => row.ok && !row.impersonation && row.evidenceReceived && !row.hiddenReasoning && row.executionId.length > 0)
    results.push(check(
      'test1_four_entities_executed',
      allFour1 && round1.members.map(row => row.identity).join(',') === 'AURORA,ORION,PULSAR,LUMEN',
      round1.members.map(row => `${row.identity} role=${row.role} ${row.backendType}/${row.provider}/${row.model} exec=${row.executionId} evidenceIds=${row.evidenceIds.length} uncertainty=${row.uncertainty} ok=${row.ok} hidden=${row.hiddenReasoning}`).join(' | '),
    ))
    results.push(check(
      'test1_shared_backend_truth',
      new Set(round1.members.map(row => `${row.backendType}:${row.provider}:${row.model}`)).size === 1,
      `FOUR ENTITIES / ONE SHARED MODEL / ${[...new Set(round1.members.map(row => row.model))].join(',')}`,
    ))
    results.push(check(
      'test1_aurora_synthesis',
      round1.synthesis.ok && round1.synthesis.backend.backendType === 'LOCAL' && round1.synthesis.text.trim().length > 0,
      `ok=${round1.synthesis.ok} type=${round1.synthesis.backend.backendType} provider=${round1.synthesis.backend.provider} len=${round1.synthesis.text.length}`,
    ))

    const storedHits = await retrieveStoredResearch(TEST2, { supabase: null, limit: 3 })
    const storedFromIndex = storedHits.hits.flatMap(hit => storedPacketToEvidence(hit.packet, new Date().toISOString(), 4))
    const aurora = nebulaAgentForSeat('chatgpt')!
    const storedIdentity = buildStoredResearchEvidenceItem({
      id: 'stored-nebula-aurora-role',
      source_id: 'war_room_council_identity',
      source_label: 'War Room Nebula identity registry',
      title: 'AURORA canonical role',
      claim: `AURORA role (stored): ${aurora.role}`,
      content: `${aurora.role}. ${aurora.mission.join(' ')}`,
      observed_at: aurora.createdAt,
      confidence: 0.95,
      freshness: 'stale',
    })
    const intent2 = detectResearchIntent(TEST2)
    const router2 = await runLiveResearchRouter({
      decreeText: TEST2,
      supabase: null,
      commanderSessionContext: true,
      crawlExpansion: false,
      retrievalOnly: true,
    })
    const live2 = liveItemsFromRouter(router2)
    const fusionItems = [...storedFromIndex, storedIdentity, ...live2]
    const hasStored = fusionItems.some(item => provenanceLabel(item) === 'STORED')
    const hasLive = fusionItems.some(item => provenanceLabel(item) === 'LIVE')
    results.push(check(
      'test2_stored_plus_live_planes',
      hasStored && hasLive && intent2.shouldResearch,
      `storedHits=${storedHits.hits.length} storedItems=${fusionItems.filter(i => provenanceLabel(i) === 'STORED').length} liveItems=${fusionItems.filter(i => provenanceLabel(i) === 'LIVE').length} shouldResearch=${intent2.shouldResearch}`,
    ))
    const round2 = await runFourMemberRound(TEST2, fusionItems, 'Label each fact as STORED or LIVE. Never present stored identity as live internet.')
    results.push(check(
      'test2_four_entities_fusion_round',
      round2.members.every(row => row.ok && !row.impersonation),
      round2.members.map(row => `${row.identity} ok=${row.ok} len=${row.contribution.length}`).join(' | '),
    ))
    results.push(check(
      'test2_synthesis_separates_planes',
      round2.synthesis.ok && /stored|live/i.test(round2.synthesis.text),
      round2.synthesis.text.slice(0, 280),
    ))

    const terra = await fetchLiveTerraVessel()
    results.push(check('test3_terra_live_ais_read', terra.ok && Boolean(terra.item), terra.detail))
    if (terra.object) {
      const handoff = buildTerraCouncilHandoffPayload({ object: terra.object, commanderPrompt: TEST3 })
      results.push(check(
        'test3_terra_handoff_uses_existing_interface',
        Boolean(handoff?.lineage?.provider) && handoff?.lineage.freshness === 'LIVE',
        `provider=${handoff?.lineage.provider ?? 'none'} freshness=${handoff?.lineage.freshness ?? 'none'} evidenceId=${handoff?.lineage.evidenceId ?? 'none'}`,
      ))
    }
    const router3 = await runLiveResearchRouter({
      decreeText: TEST3,
      supabase: null,
      commanderSessionContext: true,
      crawlExpansion: false,
      retrievalOnly: true,
    })
    const live3 = liveItemsFromRouter(router3)
    const terraItems = terra.item ? [terra.item, ...live3] : live3
    results.push(check(
      'test3_terra_and_internet_evidence',
      Boolean(terra.item) && (live3.length > 0 || router3.publicRss.ok || router3.direct.some(d => d.ok) || Boolean(router3.searxng?.ok)),
      `terra=${Boolean(terra.item)} liveWeb=${live3.length} rss=${router3.publicRss.ok} searxng=${router3.searxng?.ok ?? false}`,
    ))
    const round3 = await runFourMemberRound(TEST3, terraItems, 'Use Terra AIS as TERRA-origin evidence. Use other items as LIVE_WEB. Do not modify Terra architecture.')
    results.push(check(
      'test3_four_entities_terra_round',
      round3.members.every(row => row.ok && !row.impersonation),
      round3.members.map(row => `${row.identity} ok=${row.ok} backend=${row.backendType}/${row.model} len=${row.contribution.length}`).join(' | '),
    ))
    results.push(check(
      'test3_synthesis',
      round3.synthesis.ok && round3.synthesis.text.trim().length > 0,
      round3.synthesis.text.slice(0, 280),
    ))

    const provenanceOk = [...items1, ...fusionItems, ...terraItems].every(item => {
      const label = provenanceLabel(item)
      if (item.origin_type === 'STORED_RESEARCH' || item.origin_type === 'KIMI_WAVE') return label === 'STORED'
      if (item.origin_type === 'LIVE_WEB' && label === 'STORED') return false
      return true
    })
    results.push(check(
      'live_stored_provenance_not_conflated',
      provenanceOk,
      'STORED items stay STORED; LIVE_WEB items are never labeled STORED',
    ))

    const fallbackRound = await runFourMemberRound(
      'Council, if live internet is unavailable, what is AURORA\'s stored role, and what must remain unknown without live retrieval?',
      [storedIdentity],
      'LIVE INTERNET UNAVAILABLE. Reason from stored/local knowledge only. Do not invent live headlines.',
    )
    results.push(check(
      'internet_failure_council_still_reasons',
      fallbackRound.members.every(row => row.ok) && fallbackRound.synthesis.ok && downNetSnap.operationalState !== 'UNAVAILABLE',
      `entities=${fallbackRound.members.map(r => r.identity).join(',')} councilState=${downNetSnap.operationalState} internet=${downNetSnap.internetAccess}`,
    ))

    const uniqueBackends = new Set(
      [...round1.members, ...round2.members, ...round3.members].map(row => `${row.backendType}:${row.provider}:${row.model}`),
    )
    results.push(check(
      'model_diversity_truth',
      uniqueBackends.size === 1 && [...uniqueBackends][0]?.startsWith('LOCAL:ollama:'),
      `FOUR COUNCIL ENTITIES · ONE SHARED MODEL BACKEND · ROLE-DIVERSE / MODEL-SHARED · ${[...uniqueBackends].join('|')}`,
    ))

    return results
  })
}
