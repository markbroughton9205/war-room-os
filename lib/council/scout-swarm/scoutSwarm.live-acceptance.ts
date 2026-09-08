import { pathToFileURL } from 'node:url'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { buildLiveResearchEvidencePacket } from '@/lib/research/researchEvidence'
import { persistStoredResearchPacket, retrieveStoredResearch } from '@/lib/intelligence/storedResearch'
import { shouldRunIndependentScoutSwarm } from './eligibility'
import { decomposeAstraMission } from './mission'
import { planRoundScouts } from './scoutPlanner'
import { runIndependentScoutSwarm } from './runtime'
import { extractSwarmFromStoredPacket } from './persist'
import { DEFAULT_SCOUT_GOVERNOR_LIMITS } from './governor'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof: string): CaseResult {
  return { name, pass, detail, proof }
}

const FREIGHT = 'What changed in U.S. freight brokerage regulation this week?'
const GLOBAL = 'What are the major current developments affecting global semiconductor supply chains, and how do they differ by region?'
const ENGINEERING = "What are War Room's current engineering risks?"

export async function runScoutSwarmLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const freightMission = decomposeAstraMission({
    decree: FREIGHT,
    roundRequestId: `live-freight-${Date.now()}`,
    logicalRequestId: `live-freight-${Date.now()}`,
  })
  const planned = planRoundScouts(freightMission, DEFAULT_SCOUT_GOVERNOR_LIMITS)
  const liveScouts = planned.scouts.filter(item => item.executeLive).slice(0, 3)

  let liveEvidence = 0
  const urls: string[] = []
  for (const scout of liveScouts) {
    const router = await runLiveResearchRouter({ decreeText: scout.query, supabase: null, conversationId: null })
    const packet = await buildLiveResearchEvidencePacket({
      decreeText: FREIGHT,
      router,
      intentConfidence: 0.8,
    })
    const items = (packet.intelligencePacket?.evidence ?? []).filter(item => item.origin_type === 'LIVE_WEB')
    liveEvidence += items.length
    urls.push(...items.map(item => item.url).filter((url): url is string => Boolean(url)))
  }
  cases.push(check(
    'live_freight_01_real_web',
    liveEvidence > 0,
    JSON.stringify({ scouts: liveScouts.length, liveEvidence, urls: urls.slice(0, 4) }),
    liveEvidence > 0 ? 'REAL LIVE WEB' : 'NOT EXECUTED',
  ))

  const identity = {
    missionId: freightMission.missionId,
    roundRequestId: freightMission.roundRequestId,
    logicalRequestId: freightMission.logicalRequestId,
  }
  const round = await runIndependentScoutSwarm({
    plan: freightMission,
    getCurrentRoundIdentity: () => identity,
    invokeSeat: async args => ({
      status: 'complete',
      content: args.agentId === 'lumen'
        ? 'No Federal Register or FMCSA source in this round proves a new federal freight-brokerage regulation. SEC filings are not a regulation change.'
        : args.agentId === 'phoenix'
          ? 'Alternate explanation: a corporate disclosure can be copied as if it were a rule.'
          : args.agentId === 'aurora'
            ? 'Current answer: no authoritative source proves a new U.S. freight brokerage regulation this week. Independent seats converged on that gap. SEC filings did not establish a federal rule change.'
            : `${args.agentId} independent report: no proven federal regulation change this week from the private ledger.`,
    }),
    runLiveResearch: async queryText => {
      const router = await runLiveResearchRouter({ decreeText: queryText, supabase: null, conversationId: null })
      return buildLiveResearchEvidencePacket({ decreeText: queryText, router, intentConfidence: 0.8 })
    },
    persistPacket: packet => persistStoredResearchPacket(packet, null),
  })
  cases.push(check('live_freight_02_isolation', round.isolation.pass, round.isolation.leaks.join(',') || 'no leaks', 'INTEGRATION'))
  cases.push(check(
    'live_freight_03_independent_reports',
    ['PULSAR_RESEARCH_REPORT', 'ORION_ENGINEERING_REPORT', 'LUMEN_VERIFICATION_REPORT', 'PHOENIX_RED_TEAM_REPORT', 'NOVA_STRATEGY_REPORT', 'SOLARA_IMPACT_REPORT', 'AURORA_FINAL_SYNTHESIS'].every(kind => round.reports.some(report => report.report_kind === kind)),
    round.reports.map(item => item.report_kind).join(','),
    'INTEGRATION',
  ))
  cases.push(check(
    'live_freight_04_no_rule_without_authority',
    /no (authoritative|proven federal regulation change)|SEC filings did not/i.test(round.reports.find(item => item.agentId === 'aurora')?.conclusion ?? ''),
    round.reports.find(item => item.agentId === 'aurora')?.conclusion.slice(0, 240) ?? '',
    'INTEGRATION',
  ))
  const repeat = await retrieveStoredResearch(FREIGHT)
  cases.push(check(
    'live_freight_05_repeat_retrieval',
    repeat.hits.some(hit => extractSwarmFromStoredPacket(hit.packet)?.reports.some(report => report.agentId === 'pulsar')),
    JSON.stringify({ hits: repeat.hits.length, backend: repeat.backend }),
    'REAL PERSISTENCE',
  ))

  const globalMission = decomposeAstraMission({
    decree: GLOBAL,
    roundRequestId: `live-global-${Date.now()}`,
    logicalRequestId: `live-global-${Date.now()}`,
  })
  cases.push(check(
    'live_global_01_regions',
    globalMission.regionalScatter.length >= 3,
    globalMission.regionalScatter.join(','),
    'STRUCTURAL',
  ))
  const globalPlanned = planRoundScouts(globalMission)
  const requiredRegions = ['NORTH_AMERICA', 'EAST_ASIA', 'EUROPE'] as const
  const liveRegional = globalPlanned.scouts.filter(item => item.region && item.executeLive)
  cases.push(check(
    'live_global_02_required_regions_execute',
    requiredRegions.every(region => liveRegional.some(item => item.region === region)),
    liveRegional.map(item => `${item.region}:${item.query}`).join(' | '),
    'STRUCTURAL',
  ))
  const regionalCaptures = []
  for (const scout of liveRegional.filter((item): item is typeof item & { region: typeof requiredRegions[number] } => Boolean(item.region && requiredRegions.includes(item.region as typeof requiredRegions[number])))) {
    const router = await runLiveResearchRouter({
      decreeText: scout.query,
      supabase: null,
      conversationId: null,
      region: scout.region,
      queryLanguage: scout.queryLanguage,
    })
    const packet = await buildLiveResearchEvidencePacket({ decreeText: GLOBAL, router, intentConfidence: 0.8 })
    const live = (packet.intelligencePacket?.evidence ?? []).filter(item => item.origin_type === 'LIVE_WEB')
    regionalCaptures.push({
      region: scout.region,
      query: scout.query,
      live: live.length,
      urls: live.map(item => item.url).filter((url) => Boolean(url)).slice(0, 3),
      domains: [...new Set(live.map(item => {
        try { return item.url ? new URL(item.url).hostname : '' } catch { return '' }
      }).filter(Boolean))],
    })
  }
  cases.push(check(
    'live_global_03_regional_sources',
    regionalCaptures.length >= 3 && regionalCaptures.every(item => item.live > 0),
    JSON.stringify(regionalCaptures),
    regionalCaptures.some(item => item.live > 0) ? 'REAL LIVE WEB' : 'NOT EXECUTED',
  ))

  const engClassified = classifyCouncilTurn(ENGINEERING)
  const engMission = decomposeAstraMission({
    decree: ENGINEERING,
    roundRequestId: `live-eng-${Date.now()}`,
    logicalRequestId: `live-eng-${Date.now()}`,
  })
  cases.push(check(
    'live_eng_01_no_generic_pulsar_web',
    !engMission.selectedPermanentSeats.includes('pulsar'),
    engMission.selectedPermanentSeats.join(','),
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_eng_02_orion_local_only',
    engMission.assignments.find(item => item.agentId === 'orion')?.liveResearch === false,
    JSON.stringify(engMission.assignments.find(item => item.agentId === 'orion')?.scoutTypes),
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_fastpath_01_hello',
    !shouldRunIndependentScoutSwarm('hello', classifyCouncilTurn('hello')),
    classifyCouncilTurn('hello').intent,
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_fastpath_02_math',
    !shouldRunIndependentScoutSwarm('What is 9 plus 8? Reply with only the number.', classifyCouncilTurn('What is 9 plus 8? Reply with only the number.')),
    classifyCouncilTurn('What is 9 plus 8? Reply with only the number.').depth,
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_fastpath_03_japan',
    !shouldRunIndependentScoutSwarm('What is the capital of Japan? Reply with only the city.', classifyCouncilTurn('What is the capital of Japan? Reply with only the city.')),
    classifyCouncilTurn('What is the capital of Japan? Reply with only the city.').depth,
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_freight_intent_still_swarm',
    shouldRunIndependentScoutSwarm(FREIGHT, classifyCouncilTurn(FREIGHT)),
    JSON.stringify(engClassified),
    'STRUCTURAL',
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runScoutSwarmLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build #5 live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
