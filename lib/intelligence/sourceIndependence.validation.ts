import { pathToFileURL } from 'node:url'
import { hashEvidenceContent, textsAreNearDuplicate } from './contentHash'
import {
  annotateEvidenceIndependence,
  classifySourceAuthority,
  clusterIndependentEvidence,
  independentSupportCount,
} from './sourceIndependence'
import type { IntelligenceEvidenceItem } from './intelligencePacket'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'STRUCTURAL'): CaseResult {
  return { name, pass, detail, proof }
}

const NOW = '2026-09-08T20:00:00.000Z'

function item(overrides: Partial<IntelligenceEvidenceItem> & Pick<IntelligenceEvidenceItem, 'id' | 'title' | 'url' | 'content'>): IntelligenceEvidenceItem {
  return {
    source_id: 'fixture',
    source_type: 'rss',
    source_label: 'Fixture',
    verified_level: 'unverified',
    claim: overrides.title,
    observed_at: NOW,
    confidence: 0.5,
    confidence_tier: 'emerging',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.5,
    contradiction_flags: [],
    evidence_density: 0.3,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: 'LIVE_WEB',
    ...overrides,
  }
}

export function runSourceIndependenceValidation(): CaseResult[] {
  const cases: CaseResult[] = []
  const body = 'Tokyo and Seoul fabs face export-control delays after a new licensing rule.'
  const mirrors = [1, 2, 3, 4, 5].map(n => item({
    id: `mirror-${n}`,
    title: 'Semiconductor supply chain update',
    url: `https://outlet-${n}.example.com/story?utm_source=feed`,
    content: body,
    source_label: n === 1 ? 'Reuters' : `Outlet ${n} (Reuters)`,
  }))
  const clusteredA = clusterIndependentEvidence(annotateEvidenceIndependence(mirrors))
  cases.push(check('hash_01_same_text_same_hash', hashEvidenceContent(body) === hashEvidenceContent(`  ${body}  `), hashEvidenceContent(body) ?? 'null'))
  cases.push(check('hash_02_near_duplicate', textsAreNearDuplicate(body, body.replace('fabs', 'fabs')), 'true'))
  cases.push(check(
    'cluster_01_five_mirrors_one_independent',
    clusteredA.clusters.length === 1 && independentSupportCount(mirrors.map(entry => entry.id), clusteredA.items) === 1,
    JSON.stringify({ clusters: clusteredA.clusters.length, keys: [...new Set(clusteredA.items.map(entry => entry.independence_key))] }),
  ))

  const independent = clusterIndependentEvidence(annotateEvidenceIndependence([
    item({
      id: 'fr-1',
      title: 'Federal Register rule',
      url: 'https://www.federalregister.gov/documents/2026/09/01/rule',
      content: 'FMCSA publishes a brokerage bonding rule.',
      source_id: 'federal_register',
      source_label: 'Federal Register',
    }),
    item({
      id: 'sec-1',
      title: 'Expeditors 8-K',
      url: 'https://www.sec.gov/Archives/edgar/data/1/0001/8-k.htm',
      content: 'Expeditors International files an 8-K disclosing insurance expense.',
      source_id: 'sec_edgar',
      source_label: 'SEC EDGAR',
    }),
  ]))
  cases.push(check(
    'cluster_02_two_primary_families_stay_independent',
    independent.clusters.length === 2 && independentSupportCount(['fr-1', 'sec-1'], independent.items) === 2,
    JSON.stringify(independent.items.map(entry => ({ id: entry.id, family: entry.source_family, key: entry.independence_key, authority: entry.source_authority_class }))),
  ))
  cases.push(check(
    'authority_01_sec_is_primary_corporate',
    classifySourceAuthority({ source_id: 'sec_edgar', url: 'https://www.sec.gov/x', source_label: 'SEC EDGAR' }) === 'PRIMARY_CORPORATE',
    classifySourceAuthority({ source_id: 'sec_edgar', url: 'https://www.sec.gov/x', source_label: 'SEC EDGAR' }),
  ))
  cases.push(check(
    'authority_02_federal_register_is_primary_regulator',
    classifySourceAuthority({ source_id: 'federal_register', url: 'https://www.federalregister.gov/x' }) === 'PRIMARY_REGULATOR',
    classifySourceAuthority({ source_id: 'federal_register', url: 'https://www.federalregister.gov/x' }),
  ))
  const annotated = annotateEvidenceIndependence([item({
    id: 'ja-1',
    title: '半導体の供給が遅れている',
    url: 'https://www.e-stat.go.jp/item',
    content: '経済産業省が発表した',
  })], { region: 'EAST_ASIA', queryLanguage: 'ja' })
  cases.push(check(
    'lang_01_japanese_untranslated',
    annotated[0]?.original_language === 'ja' && annotated[0]?.translation_status === 'UNTRANSLATED',
    JSON.stringify({ lang: annotated[0]?.original_language, status: annotated[0]?.translation_status }),
  ))
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runSourceIndependenceValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (results.some(item => !item.pass)) process.exit(1)
}
