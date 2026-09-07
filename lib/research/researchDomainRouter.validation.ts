import { pathToFileURL } from 'node:url'
import { classifyResearchDomain, matchedDomains, extractPrimaryQuerySentence } from './researchDomainRouter'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runResearchDomainRouterValidation(): CaseResult[] {
  const cases: CaseResult[] = []

  const transport = classifyResearchDomain('What are the latest U.S. freight brokerage developments relevant to a small transportation company?')
  cases.push(check('domain_01_freight_brokerage_classified_transportation_logistics', transport === 'TRANSPORTATION_LOGISTICS', transport))

  const regulatory = classifyResearchDomain('What new federal regulatory compliance requirements were issued this quarter?')
  cases.push(check('domain_02_regulatory_query_classified_government_regulatory', regulatory === 'GOVERNMENT_REGULATORY', regulatory))

  const economic = classifyResearchDomain('How is inflation affecting the stock market this month?')
  cases.push(check('domain_03_economic_query_classified_economic_financial', economic === 'ECONOMIC_FINANCIAL', economic))

  const science = classifyResearchDomain('What does the latest peer-reviewed research paper say about mRNA vaccine durability?')
  cases.push(check('domain_04_science_query_classified_science_academic', science === 'SCIENCE_ACADEMIC', science))

  const general = classifyResearchDomain('hello')
  cases.push(check('domain_05_greeting_classified_general_current', general === 'GENERAL_CURRENT', general))

  const localRuntime = classifyResearchDomain('is Ollama running locally right now')
  cases.push(check('domain_06_local_runtime_query_classified_general_current', localRuntime === 'GENERAL_CURRENT', localRuntime))

  const hybrid = classifyResearchDomain('How do new federal regulatory rules on freight brokerage affect trucking company stock prices?')
  cases.push(check('domain_07_multi_domain_query_classified_hybrid', hybrid === 'HYBRID', hybrid))

  const hybridMatches = matchedDomains('How do new federal regulatory rules on freight brokerage affect trucking company stock prices?')
  cases.push(check(
    'domain_08_hybrid_matched_domains_include_all_three',
    hybridMatches.includes('TRANSPORTATION_LOGISTICS') && hybridMatches.includes('GOVERNMENT_REGULATORY') && hybridMatches.includes('ECONOMIC_FINANCIAL'),
    JSON.stringify(hybridMatches),
  ))

  cases.push(check(
    'domain_09_classification_is_deterministic_across_repeated_calls',
    classifyResearchDomain('freight brokerage news') === classifyResearchDomain('freight brokerage news'),
    'called twice with identical input',
  ))

  const abbreviationText = 'What are the latest U.S. freight brokerage developments relevant to a small transportation company?'
  cases.push(check(
    'domain_10_abbreviation_period_does_not_truncate_the_query',
    extractPrimaryQuerySentence(abbreviationText) === abbreviationText,
    extractPrimaryQuerySentence(abbreviationText),
  ))

  const worldBriefExpanded = 'What is the latest peer-reviewed research on mRNA vaccine durability today?\n\nCover distinct current-event areas without repeating the same search:\n1. current geopolitics and major conflicts\n2. global economics and markets'
  const scienceDespiteExpansion = classifyResearchDomain(worldBriefExpanded)
  cases.push(check(
    'domain_11_world_brief_boilerplate_does_not_override_real_domain',
    scienceDespiteExpansion === 'SCIENCE_ACADEMIC',
    scienceDespiteExpansion,
  ))
  cases.push(check(
    'domain_12_world_brief_marker_stripped_from_primary_sentence',
    !extractPrimaryQuerySentence(worldBriefExpanded).includes('Cover distinct'),
    extractPrimaryQuerySentence(worldBriefExpanded),
  ))

  // Build #4A closure regression: "regulat\b" (a bare word-boundary match) never matched inside
  // "regulation" or "regulations" (the "t" and "i"/"o" are both word characters, so there's no
  // boundary between them) — only the separately-listed "regulatory" alternative worked. The
  // mission's own regulatory acceptance-test phrase uses "regulation", which fell through to
  // TRANSPORTATION_LOGISTICS only instead of the required HYBRID (TRANSPORTATION_LOGISTICS +
  // GOVERNMENT_REGULATORY) — confirmed live before this fix. `regulat\w*` covers every inflection.
  const freightRegulationThisWeek = classifyResearchDomain('What changed in U.S. freight brokerage regulation this week?')
  cases.push(check(
    'domain_13_freight_regulation_word_form_classified_hybrid',
    freightRegulationThisWeek === 'HYBRID',
    freightRegulationThisWeek,
  ))
  const freightRegulationMatches = matchedDomains('What changed in U.S. freight brokerage regulation this week?')
  cases.push(check(
    'domain_14_freight_regulation_matches_both_required_domains',
    freightRegulationMatches.includes('TRANSPORTATION_LOGISTICS') && freightRegulationMatches.includes('GOVERNMENT_REGULATORY'),
    JSON.stringify(freightRegulationMatches),
  ))
  const bareRegulation = classifyResearchDomain('What are the new regulations this quarter?')
  cases.push(check(
    'domain_15_bare_plural_regulations_classified_government_regulatory',
    bareRegulation === 'GOVERNMENT_REGULATORY',
    bareRegulation,
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runResearchDomainRouterValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Research domain router validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
