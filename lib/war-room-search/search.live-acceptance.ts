import { pathToFileURL } from 'node:url'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { federatedSearch } from './federatedSearch'
import { buildSearchHandoffEvidencePacket } from './councilHandoff'
import type { FederatedSearchResponse, SearchResult } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof: string): CaseResult {
  return { name, pass, detail, proof }
}

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

function families(results: SearchResult[]): Set<string> {
  return new Set(results.map(item => item.sourceFamily).filter((value): value is string => Boolean(value)))
}

function hasRealLinks(results: SearchResult[]): boolean {
  return results.some(item => Boolean(item.url && /^https?:\/\//i.test(item.url)))
}

function duplicatedCanonicals(results: SearchResult[]): string[] {
  const seen = new Map<string, number>()
  for (const item of results) {
    const key = item.canonicalUrl || item.url
    if (!key) continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}

async function search(query: string, options: Record<string, unknown> = {}): Promise<FederatedSearchResponse> {
  return federatedSearch({ query, options })
}

export async function runWarRoomSearchLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const SEMI = 'latest semiconductor supply chain developments'
  const FREIGHT = 'U.S. freight broker regulations'
  const SCIENCE = 'lithium battery degradation research'
  const EAST = 'semiconductor policy'
  const JAPAN = 'Japan capital'

  const semi = await search(SEMI, { limit: 16, sort: 'RELEVANCE' })
  cases.push(check('live_semi_01_results', semi.resultCount > 0 && hasRealLinks(semi.results), `count=${semi.resultCount} took=${semi.tookMs}`, semi.resultCount ? 'REAL LIVE WEB' : 'NOT EXECUTED'))
  cases.push(check('live_semi_02_families', families(semi.results).size >= 2 || semi.resultCount === 0, [...families(semi.results)].join(','), 'REAL LIVE WEB'))
  cases.push(check('live_semi_03_no_dup_canonical', duplicatedCanonicals(semi.results).length === 0, duplicatedCanonicals(semi.results).join(' | ') || 'none', 'REAL LIVE WEB'))
  cases.push(check('live_semi_04_dates_or_null', semi.results.every(item => item.publishedAt === null || Number.isFinite(Date.parse(item.publishedAt))), semi.results.map(item => item.publishedAt).slice(0, 5).join(','), 'REAL LIVE WEB'))

  const freight = await search(FREIGHT, { limit: 16 })
  const freightAuthorities = freight.results.map(item => item.authorityClass)
  const freightUrls = freight.results.map(item => item.url ?? '')
  cases.push(check('live_freight_01_results', freight.resultCount > 0 && hasRealLinks(freight.results), `count=${freight.resultCount}`, freight.resultCount ? 'REAL LIVE WEB' : 'NOT EXECUTED'))
  cases.push(check(
    'live_freight_02_regulatory_path',
    freight.sourceSummary.researchEngineProviders.includes('federal_register') || freightAuthorities.includes('PRIMARY_REGULATOR') || freightUrls.some(url => /federalregister\.gov/i.test(url)),
    JSON.stringify({ providers: freight.sourceSummary.researchEngineProviders, authorities: [...new Set(freightAuthorities)] }),
    'REAL LIVE WEB',
  ))
  cases.push(check(
    'live_freight_03_sec_not_misclassified_as_regulation',
    freight.results.filter(item => /sec\.gov/i.test(item.url ?? '')).every(item => item.authorityClass !== 'PRIMARY_REGULATOR'),
    freight.results.filter(item => /sec\.gov/i.test(item.url ?? '')).map(item => item.authorityClass).join(',') || 'no sec urls',
    'REAL LIVE WEB',
  ))

  const science = await search(SCIENCE, { limit: 16, primaryOnly: false })
  const academic = science.results.filter(item => item.authorityClass === 'PRIMARY_ACADEMIC' || /arxiv\.org|nih\.gov|crossref/i.test(item.url ?? ''))
  cases.push(check('live_science_01_results', science.resultCount > 0, `count=${science.resultCount}`, science.resultCount ? 'REAL LIVE WEB' : 'NOT EXECUTED'))
  cases.push(check(
    'live_science_02_academic',
    academic.length > 0 || science.sourceSummary.researchEngineProviders.some(id => ['arxiv', 'crossref', 'ncbi'].includes(id)),
    JSON.stringify({ academic: academic.length, providers: science.sourceSummary.researchEngineProviders }),
    'REAL LIVE WEB',
  ))

  const east = await search(EAST, { limit: 16, region: 'EAST_ASIA' })
  cases.push(check('live_east_01_region_attempted', east.sourceSummary.region === 'EAST_ASIA' && east.sourceSummary.primaryAttempted.length > 0, JSON.stringify(east.sourceSummary), 'REAL LIVE WEB'))
  cases.push(check('live_east_02_honest_fallback', typeof east.sourceSummary.genericRssUsedAsFallback === 'boolean', String(east.fallbackUsed), 'REAL LIVE WEB'))
  cases.push(check('live_east_03_results_or_honest_empty', east.resultCount > 0 || east.warnings.length > 0, `count=${east.resultCount} warnings=${east.warnings.join(' | ')}`, 'REAL LIVE WEB'))

  const japan = await search(JAPAN, { limit: 8 })
  cases.push(check(
    'live_fast_01_search_only',
    japan.query === JAPAN && japan.profile === 'STANDARD_RESEARCH' && !('scoutSwarm' in japan),
    `profile=${japan.profile} count=${japan.resultCount} took=${japan.tookMs}`,
    'REAL LIVE WEB',
  ))

  const timeout = await federatedSearch({ query: SEMI, options: { timeoutMs: 4000, limit: 8 } })
  cases.push(check(
    'live_timeout_01_degrades',
    timeout.timedOut || timeout.resultCount > 0 || timeout.warnings.length > 0,
    JSON.stringify({ timedOut: timeout.timedOut, count: timeout.resultCount, warnings: timeout.warnings.slice(0, 3) }),
    'REAL LIVE WEB',
  ))

  const probe = await probeOllama()
  const ollamaReady = probe.available
  cases.push(check('live_handoff_01_ollama_probe', ollamaReady, probe.detail, ollamaReady ? 'REAL OLLAMA' : 'NOT EXECUTED'))
  if (ollamaReady && freight.results.length) {
    const handoffQuery = 'What changed in U.S. freight brokerage regulation this week?'
    const handoff = buildSearchHandoffEvidencePacket({ query: handoffQuery, results: freight.results })
    const res = await executeCouncilChatRequest(chatReq({
      message: handoffQuery,
      raelDirectiveText: handoffQuery,
      councilLogicalRequestId: `search-handoff-${Date.now()}`,
      searchHandoff: { query: handoffQuery, results: freight.results },
    }))
    const body = await res.json() as {
      error?: string
      message?: string
      councilSingleResponse?: string
      scoutSwarm?: { isolation?: { pass?: boolean } }
      liveResearchAttempted?: boolean
    }
    const aurora = body.councilSingleResponse ?? ''
    cases.push(check('live_handoff_02_chat_ok', res.ok && !body.error, body.message ?? body.error ?? `status=${res.status}`, 'REAL LIVE WEB + REAL OLLAMA'))
    cases.push(check(
      'live_handoff_03_evidence_used',
      Boolean(handoff.intelligencePacket?.evidence?.length && body.liveResearchAttempted),
      `evidence=${handoff.intelligencePacket?.evidence?.length} attempted=${body.liveResearchAttempted} origin=${handoff.intelligencePacket?.evidence?.[0]?.origin_type} key=${handoff.intelligencePacket?.evidence?.[0]?.independence_key}`,
      'REAL LIVE WEB + REAL OLLAMA',
    ))
    cases.push(check(
      'live_handoff_04_isolation_or_fastpath',
      body.scoutSwarm?.isolation?.pass !== false,
      JSON.stringify(body.scoutSwarm?.isolation ?? { note: 'single-seat continue; isolation barrier not required to fail closed' }),
      'REAL OLLAMA',
    ))
    cases.push(check(
      'live_handoff_05_aurora_no_invented_rule',
      !/new (federal )?(freight )?brokerage regulation (was|has been) (enacted|issued|published)/i.test(aurora),
      aurora.slice(0, 280) || 'empty',
      'REAL OLLAMA',
    ))
  } else if (!ollamaReady) {
    cases.push(check('live_handoff_02_chat_ok', false, 'Ollama unavailable', 'NOT EXECUTED'))
  }

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runWarRoomSearchLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`War Room Search live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
