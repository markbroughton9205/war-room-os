import { pathToFileURL } from 'node:url'
import { classifyResearchDomain } from '@/lib/research/researchDomainRouter'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { buildLiveResearchEvidencePacket } from '@/lib/research/researchEvidence'
import { retrieveStoredResearch } from '@/lib/intelligence/storedResearch'
import { runPriorAwareResearchTurn } from '@/lib/intelligence/researchTurn'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof: string): CaseResult {
  return { name, pass, detail, proof }
}

const FREIGHT = 'What are the latest U.S. freight brokerage developments relevant to a small transportation company, and what has changed from our prior research?'
const SCIENCE = 'What has changed in recent public research on lithium battery degradation compared with what War Room previously knew?'
const CATALOG = 'What public machine-accessible sources does War Room already know about for arXiv academic scientific literature, and which of them are actually implemented now?'

export async function runBuild4bLiveAcceptance(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []

  const freightTurn = await runPriorAwareResearchTurn({
    decreeText: FREIGHT,
    researchIntentSaysGo: true,
    intentConfidence: 0.85,
    runLiveResearch: async queryText => {
      const router = await runLiveResearchRouter({ decreeText: queryText, supabase: null, conversationId: null })
      return buildLiveResearchEvidencePacket({ decreeText: FREIGHT, router, intentConfidence: 0.85 })
    },
  })
  const freightEvidence = freightTurn.packet.intelligencePacket?.evidence ?? []
  const freightLive = freightEvidence.filter(item => item.origin_type === 'LIVE_WEB')
  const freightPrior = freightEvidence.filter(item => item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH')
  cases.push(check(
    'live_freight_01_domain_transportation',
    classifyResearchDomain(FREIGHT) === 'TRANSPORTATION_LOGISTICS',
    classifyResearchDomain(FREIGHT),
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_freight_02_prior_kimi_or_stored',
    freightPrior.length > 0 || freightTurn.prior.honestyNotes.length > 0,
    JSON.stringify({ prior: freightPrior.length, kimi: freightTurn.prior.kimiCount, stored: freightTurn.prior.storedCount, notes: freightTurn.prior.honestyNotes }),
    'INTEGRATION',
  ))
  cases.push(check(
    'live_freight_03_real_live_web',
    freightLive.length > 0 && freightTurn.packet.usedLiveResearch,
    JSON.stringify({ live: freightLive.length, urls: freightLive.map(item => item.url).filter(Boolean).slice(0, 4), used: freightTurn.packet.usedLiveResearch }),
    'REAL LIVE WEB',
  ))
  cases.push(check(
    'live_freight_04_origins_distinct',
    freightLive.every(item => item.origin_type === 'LIVE_WEB') && freightPrior.every(item => item.origin_type !== 'LIVE_WEB'),
    JSON.stringify([...new Set(freightEvidence.map(item => item.origin_type))]),
    'INTEGRATION',
  ))
  cases.push(check(
    'live_freight_05_persist',
    freightTurn.persistence.ok,
    JSON.stringify(freightTurn.persistence),
    'REAL PERSISTENCE',
  ))
  const freightRepeat = await retrieveStoredResearch(FREIGHT)
  cases.push(check(
    'live_freight_06_repeat_retrieves_stored',
    freightRepeat.ok && freightRepeat.hits.some(hit => hit.packet.decree === FREIGHT),
    JSON.stringify({ hits: freightRepeat.hits.length, backend: freightRepeat.backend }),
    'REAL PERSISTENCE',
  ))

  const scienceTurn = await runPriorAwareResearchTurn({
    decreeText: SCIENCE,
    researchIntentSaysGo: true,
    intentConfidence: 0.85,
    runLiveResearch: async queryText => {
      const router = await runLiveResearchRouter({ decreeText: queryText, supabase: null, conversationId: null })
      return buildLiveResearchEvidencePacket({ decreeText: SCIENCE, router, intentConfidence: 0.85 })
    },
  })
  const scienceEvidence = scienceTurn.packet.intelligencePacket?.evidence ?? []
  const scienceLive = scienceEvidence.filter(item => item.origin_type === 'LIVE_WEB')
  cases.push(check(
    'live_science_01_domain_science_academic',
    classifyResearchDomain(SCIENCE) === 'SCIENCE_ACADEMIC',
    classifyResearchDomain(SCIENCE),
    'STRUCTURAL',
  ))
  cases.push(check(
    'live_science_02_real_live_web',
    scienceLive.length > 0 && scienceTurn.packet.usedLiveResearch,
    JSON.stringify({ live: scienceLive.length, sources: scienceTurn.packet.sources.filter(s => s.ok).map(s => s.kind), urls: scienceLive.map(item => item.url).filter(Boolean).slice(0, 4) }),
    'REAL LIVE WEB',
  ))
  cases.push(check(
    'live_science_03_persist_and_repeat',
    scienceTurn.persistence.ok && (await retrieveStoredResearch(SCIENCE)).hits.some(hit => hit.packet.decree === SCIENCE),
    JSON.stringify(scienceTurn.persistence),
    'REAL PERSISTENCE',
  ))

  const catalogTurn = await runPriorAwareResearchTurn({
    decreeText: CATALOG,
    researchIntentSaysGo: true,
    intentConfidence: 0.7,
    runLiveResearch: async () => {
      throw new Error('catalog query must not invoke live research')
    },
  })
  cases.push(check(
    'live_catalog_01_kimi_candidates_and_implementation_states',
    (catalogTurn.prior.catalog?.candidates.length ?? 0) > 0 || catalogTurn.prior.kimiCount > 0,
    JSON.stringify({
      kimi: catalogTurn.prior.kimiCount,
      candidates: catalogTurn.prior.catalog?.candidates.slice(0, 6).map(item => ({ name: item.catalogName, state: item.implementationState, usable: item.usableNow })),
      usable: catalogTurn.prior.catalog?.usable.length,
      blocked: catalogTurn.prior.catalog?.blockedOrStubOrMissing.length,
    }),
    'INTEGRATION',
  ))
  cases.push(check(
    'live_catalog_02_skips_live_and_does_not_trust_catalog_alone',
    catalogTurn.retrievalPlan.catalogOnly && catalogTurn.retrievalPlan.shouldRunLiveResearch === false,
    JSON.stringify(catalogTurn.retrievalPlan),
    'STRUCTURAL',
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBuild4bLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Build #4B live acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
