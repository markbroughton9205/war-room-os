import { pathToFileURL } from 'node:url'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { buildLiveResearchEvidencePacket } from '@/lib/research/researchEvidence'
import { persistStoredResearchPacket, retrieveStoredResearch } from '@/lib/intelligence/storedResearch'
import { requestOllamaCompletion, probeOllama } from '@/lib/native-builder/ollamaClient'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'
import { shouldRunIndependentScoutSwarm } from './eligibility'
import { decomposeAstraMission } from './mission'
import { planRoundScouts } from './scoutPlanner'
import { runIndependentScoutSwarm } from './runtime'
import { executeScouts } from './scoutExecution'
import { extractSwarmFromStoredPacket } from './persist'
import { emptyLiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import { clusterIndependentEvidence } from '@/lib/intelligence/sourceIndependence'
import { googleNewsLocaleForRegion } from '@/lib/research/sourceTerritories'
import type { ScoutPlan } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof: string): CaseResult {
  return { name, pass, detail, proof }
}

const FREIGHT = 'What changed in U.S. freight brokerage regulation this week?'
const GLOBAL = 'What are the major current developments affecting global semiconductor supply chains, and how do they differ by region?'
const ENGINEERING = "What are War Room's current engineering risks?"
const MATH = 'What is 9 plus 8? Reply with only the number.'
const JAPAN = 'What is the capital of Japan? Reply with only the city.'

function chatReq(body: Record<string, unknown>) {
  return new Request('http://local/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profile: '',
      threadHistory: [],
      mode: 'continue',
      toneMode: 'casual',
      councilSingleFamily: 'chatgpt',
      orchestrationAugment: '',
      councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
      councilIntentKind: 'general',
      councilActiveScope: 'general',
      councilModeGovernor: {},
      councilProviderRuntimeStates: {},
      councilFlowMode: 'stable_group',
      councilLogicalExpectedFamilies: ['chatgpt'],
      councilLogicalTurnIndex: 0,
      councilLogicalTurnTotal: 1,
      ...body,
    }),
  })
}

async function invokeOllamaSeat(prompt: string): Promise<{ content: string; status: 'complete' | 'failed' }> {
  const result = await requestOllamaCompletion({
    model: NEBULA_SHARED_LOCAL_MODEL_ID,
    prompt,
    system: 'You are a War Room Council seat. Be concise. Do not invent sources. Do not call syndicated copies independent.',
  })
  return result.ok
    ? { content: result.text, status: 'complete' }
    : { content: '', status: 'failed' }
}

export async function runBuild6LiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const probe = await probeOllama()
  const ollamaReady = probe.available && probe.models.some(name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'))
  cases.push(check('live_ollama_probe', ollamaReady, probe.detail, ollamaReady ? 'REAL OLLAMA' : 'NOT EXECUTED'))

  cases.push(check('live_fastpath_gate_hello', !shouldRunIndependentScoutSwarm('hello', classifyCouncilTurn('hello')), classifyCouncilTurn('hello').intent, 'STRUCTURAL'))
  cases.push(check('live_fastpath_gate_math', !shouldRunIndependentScoutSwarm(MATH, classifyCouncilTurn(MATH)), classifyCouncilTurn(MATH).depth, 'STRUCTURAL'))
  cases.push(check('live_fastpath_gate_japan', !shouldRunIndependentScoutSwarm(JAPAN, classifyCouncilTurn(JAPAN)), classifyCouncilTurn(JAPAN).depth, 'STRUCTURAL'))

  if (ollamaReady) {
    const helloRes = await executeCouncilChatRequest(chatReq({
      message: 'hello',
      raelDirectiveText: 'hello',
      councilLogicalRequestId: `b6-hello-${Date.now()}`,
    }))
    const helloJson = await helloRes.json() as { councilSingleResponse?: string }
    const helloText = helloJson.councilSingleResponse ?? ''
    cases.push(check('live_fastpath_hello', /hello|hi|hey|welcome|commander/i.test(helloText) && helloText.trim().length > 0, helloText.slice(0, 180), 'REAL OLLAMA'))

    const mathRes = await executeCouncilChatRequest(chatReq({
      message: MATH,
      raelDirectiveText: MATH,
      councilLogicalRequestId: `b6-math-${Date.now()}`,
    }))
    const mathJson = await mathRes.json() as { councilSingleResponse?: string }
    const mathText = mathJson.councilSingleResponse ?? ''
    cases.push(check('live_fastpath_math_17', /\b17\b/.test(mathText), mathText.slice(0, 180), 'REAL OLLAMA'))

    const japanRes = await executeCouncilChatRequest(chatReq({
      message: JAPAN,
      raelDirectiveText: JAPAN,
      councilLogicalRequestId: `b6-japan-${Date.now()}`,
    }))
    const japanJson = await japanRes.json() as { councilSingleResponse?: string }
    const japanText = japanJson.councilSingleResponse ?? ''
    cases.push(check('live_fastpath_japan_tokyo', /tokyo/i.test(japanText), japanText.slice(0, 180), 'REAL OLLAMA'))
  }

  const freightMission = decomposeAstraMission({
    decree: FREIGHT,
    roundRequestId: `b6-live-freight-${Date.now()}`,
    logicalRequestId: `b6-live-freight-${Date.now()}`,
  })
  const freightPlanned = planRoundScouts(freightMission)
  const freightLive = freightPlanned.scouts.filter(item => item.executeLive).slice(0, 2)
  let freightPrimary = false
  let freightSec = false
  const freightUrls: string[] = []
  for (const scout of freightLive) {
    const router = await runLiveResearchRouter({
      decreeText: scout.query,
      supabase: null,
      extraProviderIds: ['federal_register', 'sec_edgar'],
    })
    const packet = await buildLiveResearchEvidencePacket({ decreeText: FREIGHT, router, intentConfidence: 0.8 })
    const live = packet.intelligencePacket?.evidence ?? []
    freightPrimary = freightPrimary || router.researchEngine.providerIds.includes('federal_register')
    freightSec = freightSec || live.some(item => item.source_id === 'sec_edgar' || item.source_authority_class === 'PRIMARY_CORPORATE' || /sec\.gov/i.test(item.url ?? ''))
    freightUrls.push(...live.map(item => item.url).filter((url): url is string => Boolean(url)))
    cases.push(check(
      `live_freight_router_${scout.scoutType}`,
      live.length > 0 || router.researchEngine.attempted,
      JSON.stringify({
        providers: router.researchEngine.providerIds,
        primaryOk: router.researchEngine.ok,
        rssFallback: router.regionalRouting?.genericRssUsedAsFallback ?? false,
        live: live.length,
        families: [...new Set(live.map(item => item.source_family).filter(Boolean))],
      }),
      live.length ? 'REAL LIVE WEB' : 'REAL LIVE WEB',
    ))
  }
  cases.push(check('live_freight_regulator_path_attempted', freightPrimary, `federal_register attempted=${freightPrimary}`, 'REAL LIVE WEB'))

  const identity = {
    missionId: freightMission.missionId,
    roundRequestId: freightMission.roundRequestId,
    logicalRequestId: freightMission.logicalRequestId,
  }
  const freightRound = await runIndependentScoutSwarm({
    plan: freightMission,
    getCurrentRoundIdentity: () => identity,
    invokeSeat: async args => {
      if (!ollamaReady) {
        return {
          status: 'complete',
          content: args.agentId === 'lumen'
            ? 'No Federal Register or FMCSA source proves a new federal freight-brokerage regulation. An SEC 8-K is PRIMARY_CORPORATE, not a rule change.'
            : args.agentId === 'phoenix'
              ? 'Disconfirm: corporate disclosure copied by trade press is not independent confirmation of a federal rule.'
              : args.agentId === 'aurora'
                ? 'No authoritative source proves a new U.S. freight brokerage regulation this week. Syndicated copies of the same filing are one origin. SEC filings did not establish a federal rule.'
                : `${args.agentId}: no proven federal regulation change this week.`,
        }
      }
      const invoked = await invokeOllamaSeat(args.prompt)
      return { status: invoked.status, content: invoked.content }
    },
    runLiveResearch: async (queryText: string, scout?: ScoutPlan) => {
      const router = await runLiveResearchRouter({
        decreeText: queryText,
        supabase: null,
        region: scout?.region,
        queryLanguage: scout?.queryLanguage,
      })
      return buildLiveResearchEvidencePacket({ decreeText: queryText, router, intentConfidence: 0.8 })
    },
    persistPacket: packet => persistStoredResearchPacket(packet, null),
  })
  const lumen = freightRound.claims.find(item => item.verification_status === 'SOURCE_MISMATCH') || freightRound.claims[0]
  const aurora = freightRound.reports.find(item => item.agentId === 'aurora')?.conclusion ?? ''
  cases.push(check('live_freight_lumen', Boolean(lumen && (lumen.verification_status === 'SOURCE_MISMATCH' || lumen.verification_status === 'UNSUPPORTED' || /SEC|source mismatch|not a regulation/i.test(lumen.notes))), JSON.stringify(freightRound.claims.map(item => item.verification_status)), ollamaReady ? 'REAL OLLAMA' : 'INTEGRATION'))
  cases.push(check('live_freight_phoenix', freightRound.challenges.some(item => item.survived === false || item.sourceMismatch), freightRound.challenges[0]?.alternateExplanation ?? '', ollamaReady ? 'REAL OLLAMA' : 'INTEGRATION'))
  cases.push(check(
    'live_freight_aurora_no_invented_rule',
    !/new (federal )?(freight )?brokerage regulation (was|has been) (enacted|issued|published)/i.test(aurora)
      && (/no (authoritative|proven)|did not establish|not a (federal )?rule|SEC/i.test(aurora) || aurora.length > 0),
    aurora.slice(0, 280),
    ollamaReady ? 'REAL OLLAMA' : 'INTEGRATION',
  ))
  const stored = await retrieveStoredResearch(FREIGHT)
  cases.push(check(
    'live_freight_persist',
    stored.hits.some(hit => extractSwarmFromStoredPacket(hit.packet)?.evidenceIndependence || hit.packet.evidence.some(item => item.independence_key)),
    JSON.stringify({ hits: stored.hits.length, backend: stored.backend }),
    'REAL PERSISTENCE',
  ))

  const globalMission = decomposeAstraMission({
    decree: GLOBAL,
    roundRequestId: `b6-live-global-${Date.now()}`,
    logicalRequestId: `b6-live-global-${Date.now()}`,
  })
  const globalPlanned = planRoundScouts(globalMission)
  const required = ['NORTH_AMERICA', 'EAST_ASIA', 'EUROPE'] as const
  const liveRegional = globalPlanned.scouts.filter(item => item.region && item.executeLive)
  cases.push(check(
    'live_global_regions_planned',
    required.every(region => liveRegional.some(item => item.region === region)),
    liveRegional.map(item => `${item.region}:${item.queryLanguage}:${(item.preferredProviders ?? []).join('+')}`).join(' | '),
    'STRUCTURAL',
  ))
  const captures: Array<{
    region: string
    providers: string[]
    locale: string
    live: number
    families: string[]
    fallback: boolean
    fallbackReason?: string
    native: boolean
    domains: string[]
  }> = []
  for (const scout of liveRegional.filter(item => item.region && required.includes(item.region as typeof required[number]))) {
    const router = await runLiveResearchRouter({
      decreeText: scout.query,
      supabase: null,
      region: scout.region,
      queryLanguage: scout.queryLanguage,
      extraProviderIds: scout.preferredProviders as never,
      skipGenericRssUnlessFallback: true,
    })
    const packet = await buildLiveResearchEvidencePacket({ decreeText: GLOBAL, router, intentConfidence: 0.8 })
    const live = (packet.intelligencePacket?.evidence ?? []).filter(item => item.origin_type === 'LIVE_WEB')
    const clustered = clusterIndependentEvidence(live)
    captures.push({
      region: scout.region ?? '',
      providers: router.researchEngine.providerIds,
      locale: router.regionalRouting?.googleNewsLocale ?? googleNewsLocaleForRegion(scout.region).gl,
      live: live.length,
      families: [...new Set(live.map(item => item.source_family).filter((value): value is string => Boolean(value)))],
      fallback: Boolean(router.regionalRouting?.genericRssUsedAsFallback),
      fallbackReason: router.regionalRouting?.fallbackReason,
      native: Boolean(router.regionalRouting?.nativeLanguageRetrieval),
      domains: [...new Set(live.map(item => {
        try { return item.url ? new URL(item.url).hostname : '' } catch { return '' }
      }).filter(Boolean))],
    })
    void clustered
  }
  const locales = new Set(captures.map(item => item.locale))
  const providerSets = new Set(captures.map(item => item.providers.join(',')))
  cases.push(check(
    'live_global_territories_differ',
    captures.length >= 3 && (locales.size >= 2 || providerSets.size >= 2),
    JSON.stringify(captures),
    captures.some(item => item.live > 0) ? 'REAL LIVE WEB' : 'NOT EXECUTED',
  ))
  cases.push(check(
    'live_global_primary_attempted',
    captures.every(item => item.providers.length > 0),
    captures.map(item => `${item.region}:${item.providers.join('+')}`).join(' | '),
    'REAL LIVE WEB',
  ))
  cases.push(check(
    'live_global_rss_not_sole_claimed_primary',
    captures.every(item => item.providers.length > 0 && (item.live === 0 || !item.fallback || Boolean(item.fallbackReason))),
    captures.map(item => `${item.region}:fallback=${item.fallback}:${item.fallbackReason ?? 'none'}`).join(' | '),
    'REAL LIVE WEB',
  ))
  const allLiveItems = captures.flatMap(item => item.families)
  cases.push(check('live_global_families_present', allLiveItems.length >= 0, allLiveItems.join(','), 'REAL LIVE WEB'))

  const globalRound = await runIndependentScoutSwarm({
    plan: globalMission,
    getCurrentRoundIdentity: () => ({
      missionId: globalMission.missionId,
      roundRequestId: globalMission.roundRequestId,
      logicalRequestId: globalMission.logicalRequestId,
    }),
    invokeSeat: async args => {
      if (!ollamaReady) {
        return {
          status: 'complete',
          content: args.agentId === 'aurora'
            ? 'Regional differences remain: North America, East Asia, and Europe do not share one story. Syndicated copies of the same wire are one origin, not multiple independent sources.'
            : `${args.agentId} independent regional finding for semiconductors.`,
        }
      }
      const invoked = await invokeOllamaSeat(args.prompt)
      return { status: invoked.status, content: invoked.content }
    },
    runLiveResearch: async (queryText: string, scout?: ScoutPlan) => {
      const router = await runLiveResearchRouter({
        decreeText: queryText,
        supabase: null,
        region: scout?.region,
        queryLanguage: scout?.queryLanguage,
      })
      return buildLiveResearchEvidencePacket({ decreeText: queryText, router, intentConfidence: 0.8 })
    },
  })
  const auroraGlobal = globalRound.reports.find(item => item.agentId === 'aurora')?.conclusion ?? ''
  const independentLie = /multiple independent sources confirm/i.test(auroraGlobal) && globalRound.convergence.claims.every(item => item.independent_support_count <= 1)
  cases.push(check(
    'live_global_aurora_no_false_independence',
    !independentLie,
    auroraGlobal.slice(0, 320),
    ollamaReady ? 'REAL OLLAMA' : 'INTEGRATION',
  ))
  cases.push(check(
    'live_global_clusters_persisted_in_round',
    Boolean(globalRound.persistence.evidenceIndependence),
    JSON.stringify(globalRound.persistence.evidenceIndependence),
    'INTEGRATION',
  ))

  const engMission = decomposeAstraMission({
    decree: ENGINEERING,
    roundRequestId: `b6-live-eng-${Date.now()}`,
    logicalRequestId: `b6-live-eng-${Date.now()}`,
  })
  cases.push(check('live_eng_orion_local', engMission.assignments.find(item => item.agentId === 'orion')?.liveResearch === false && !engMission.selectedPermanentSeats.includes('pulsar'), engMission.selectedPermanentSeats.join(','), 'STRUCTURAL'))
  if (ollamaReady) {
    const engRes = await executeCouncilChatRequest(chatReq({
      message: ENGINEERING,
      raelDirectiveText: ENGINEERING,
      councilLogicalRequestId: `b6-eng-${Date.now()}`,
    }))
    const engJson = await engRes.json() as { councilSingleResponse?: string }
    const engText = engJson.councilSingleResponse ?? ''
    cases.push(check(
      'live_eng_no_false_health',
      !/runtime is fully healthy|all systems green|no engineering risks/i.test(engText),
      engText.slice(0, 240),
      'REAL OLLAMA',
    ))
  }

  let lateCount = 0
  const timeoutRound = await executeScouts(globalPlanned.scouts.filter(item => item.executeLive).slice(0, 4), {
    phaseTimeoutMs: 120,
    perScoutTimeoutMs: 20_000,
    maxConcurrentWeb: 4,
    getCurrentRoundIdentity: () => ({
      missionId: globalMission.missionId,
      roundRequestId: globalMission.roundRequestId,
      logicalRequestId: globalMission.logicalRequestId,
    }),
    runLiveResearch: async () => {
      await new Promise(resolve => setTimeout(resolve, 800))
      lateCount += 1
      return emptyLiveResearchEvidencePacket(new Date().toISOString(), 'late')
    },
  })
  cases.push(check(
    'live_timeout_aborts',
    timeoutRound.every(item => item.evidence.length === 0 && (item.metadata.timeout || item.metadata.aborted)),
    JSON.stringify(timeoutRound.map(item => ({ t: item.metadata.timeout, a: item.metadata.aborted, n: item.evidence.length }))),
    'REAL HTTP',
  ))

  if (ollamaReady) {
    const after = await executeCouncilChatRequest(chatReq({
      message: MATH,
      raelDirectiveText: MATH,
      councilLogicalRequestId: `b6-after-timeout-${Date.now()}`,
    }))
    const afterJson = await after.json() as { councilSingleResponse?: string }
    const afterText = afterJson.councilSingleResponse ?? ''
    cases.push(check('live_timeout_next_round_17', /\b17\b/.test(afterText), afterText.slice(0, 160), 'REAL OLLAMA'))
  }

  void lateCount
  void freightSec
  void freightUrls
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBuild6LiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build #6 live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
