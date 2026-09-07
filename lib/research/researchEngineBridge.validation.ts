import { pathToFileURL } from 'node:url'
import { runResearchEngineBridge, compactQueryText } from './researchEngineBridge'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

/**
 * Structural coverage only — no network calls are expected/required to pass. Real live-web proof
 * for the bridge lives in the Build #4A acceptance-test evidence (arXiv/Crossref/NCBI/SEC EDGAR/
 * Wikidata calls made through the real Council chat path), not here.
 */
export async function runResearchEngineBridgeValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []

  const generalCurrent = await runResearchEngineBridge({ queryText: 'hello', domain: 'GENERAL_CURRENT' })
  cases.push(check(
    'bridge_01_general_current_never_attempts_a_call',
    generalCurrent.attempted === false && generalCurrent.providerIds.length === 0,
    JSON.stringify(generalCurrent),
  ))

  const science = await runResearchEngineBridge({ queryText: 'mRNA vaccine durability', domain: 'SCIENCE_ACADEMIC' })
  cases.push(check(
    'bridge_02_science_academic_selects_arxiv_crossref_ncbi',
    ['arxiv', 'crossref', 'ncbi'].every(id => science.providerIds.includes(id as never)),
    JSON.stringify(science.providerIds),
  ))

  const hybrid = await runResearchEngineBridge({
    queryText: 'freight brokerage regulatory compliance',
    domain: 'HYBRID',
    matchedDomains: ['TRANSPORTATION_LOGISTICS', 'GOVERNMENT_REGULATORY'],
  })
  cases.push(check(
    'bridge_03_hybrid_unions_matched_domain_provider_sets',
    hybrid.providerIds.includes('sec_edgar' as never),
    JSON.stringify(hybrid.providerIds),
  ))

  const transport = await runResearchEngineBridge({ queryText: 'freight brokerage', domain: 'TRANSPORTATION_LOGISTICS' })
  cases.push(check(
    'bridge_04_transportation_logistics_selects_sec_edgar',
    transport.providerIds.includes('sec_edgar' as never),
    JSON.stringify(transport.providerIds),
  ))

  cases.push(check(
    'bridge_05_every_result_carries_a_provider_id_matching_selection',
    science.results.every(r => science.providerIds.includes(r.providerId)),
    JSON.stringify(science.results.map(r => r.providerId)),
  ))

  cases.push(check(
    'bridge_06_ok_is_true_only_when_documents_present',
    science.ok === (science.documents.length > 0),
    JSON.stringify({ ok: science.ok, docCount: science.documents.length }),
  ))

  const noisyText = 'What are the current headlines on freight brokerage regulation for trucking companies today? Cover distinct current-event areas without repeating the same search: 1. current geopolitics and major conflicts 2. global economics and markets'
  const compact = compactQueryText(noisyText)
  cases.push(check(
    'bridge_07_compact_query_drops_generic_multi_topic_instruction_tail',
    compact === 'What are the current headlines on freight brokerage regulation for trucking companies today?',
    compact,
  ))
  cases.push(check(
    'bridge_08_compact_query_never_exceeds_max_length',
    compactQueryText('a'.repeat(500)).length <= 220,
    String(compactQueryText('a'.repeat(500)).length),
  ))
  cases.push(check(
    'bridge_09_compact_query_leaves_short_text_unchanged',
    compactQueryText('freight brokerage') === 'freight brokerage',
    compactQueryText('freight brokerage'),
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResearchEngineBridgeValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`Research engine bridge validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}
