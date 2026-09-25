import {
  classifyResearchIntent,
  classifySourceAuthority,
  constructDomainQueries,
  identityKey,
  preferredAuthorities,
  stripResearchHarness,
  type ResearchDomain,
} from '@/lib/browser-broker/researchPolicy'
import {
  classifySourceType,
  hostOf,
  paperIdentity,
  selectResearchCandidates,
  toCandidate,
  unwrapSearchResultUrl,
  type ResearchSourceCandidate,
} from '@/lib/browser-broker/researchDiscovery'
import { createEngineReceipt } from '../receipts'
import type { StopConditionState } from '../types'
import type {
  DiscoveryStopInput,
  EngineSourceCandidate,
  ResearchDiscoveryInput,
  ResearchDiscoveryPlan,
  ResearchDiscoveryResult,
} from './types'

function normalizeQuestion(question: string): string {
  return stripResearchHarness(question).replace(/\s+/g, ' ').trim()
}

function recoveryFor(domain: ResearchDomain): ResearchDiscoveryPlan['recovery_strategy'] {
  if (domain === 'fda_regulation' || domain === 'sec_filing' || domain === 'court_case') return 'honest_failure'
  if (domain === 'current_news') return 'retry_alternate_query'
  return 'relax_to_authoritative'
}

export function decideDiscoveryStop(input: DiscoveryStopInput): {
  stop: boolean
  condition: StopConditionState
  remaining_evidence_gap: string[]
} {
  const gaps: string[] = []
  if (input.usable_count < input.min_usable) gaps.push(`need ${input.min_usable - input.usable_count} more usable source(s)`)
  if (input.required_freshness && input.usable_count === 0) gaps.push('need in-window publication date')
  if (input.primary_count === 0) gaps.push('need a primary/authoritative source')
  if (input.independent_count < 2 && input.usable_count >= 1) gaps.push('need independent corroboration')

  if (input.tool_budget_exhausted || input.remaining_ms < 4_000) {
    return { stop: true, condition: 'TOOL_BUDGET_EXHAUSTED', remaining_evidence_gap: gaps }
  }
  if (input.freshness_skips >= 6) {
    return { stop: true, condition: 'TOOL_BUDGET_EXHAUSTED', remaining_evidence_gap: gaps }
  }
  if (input.usable_count >= input.min_usable && input.independent_count >= 2 && input.primary_count >= 1) {
    return { stop: true, condition: 'PRIMARY_PLUS_CORROBORATION', remaining_evidence_gap: [] }
  }
  if (input.usable_count >= input.min_usable && gaps.length === 0) {
    return { stop: true, condition: 'EVIDENCE_REQUIREMENT_SATISFIED', remaining_evidence_gap: [] }
  }
  if (input.inspected_count >= input.candidate_budget) {
    return { stop: true, condition: 'CANDIDATE_BUDGET_EXHAUSTED', remaining_evidence_gap: gaps }
  }
  if (input.inspected_count >= 3 && input.usable_count > 0 && input.last_accepted === false && input.remaining_ms < 12_000) {
    return { stop: true, condition: 'NO_INFORMATION_GAIN', remaining_evidence_gap: gaps }
  }
  if (input.usable_count >= input.min_usable && input.remaining_ms < 12_000) {
    return { stop: true, condition: 'TOOL_BUDGET_EXHAUSTED', remaining_evidence_gap: gaps }
  }
  return { stop: false, condition: 'CONTINUE', remaining_evidence_gap: gaps }
}

export function toEngineCandidate(input: {
  url: string
  title?: string
  query: string
  rank: number
  discovery_method?: EngineSourceCandidate['discovery_method']
  discovered_at?: string
}): EngineSourceCandidate | null {
  const raw = toCandidate({
    url: input.url,
    title: input.title,
    discovered_by: input.discovery_method === 'seed' ? 'seed' : input.discovery_method === 'alternate' ? 'alternate' : 'search',
    query: input.query,
    rank: input.rank,
  })
  if (!raw) return null
  const identity = paperIdentity(raw.url) || identityKey(raw.url)
  const source_class = classifySourceAuthority(raw.url)
  return {
    candidate_id: identity || raw.url,
    url: raw.url,
    canonical_url: unwrapSearchResultUrl(raw.url) || raw.url,
    title: raw.title,
    domain: raw.domain || hostOf(raw.url),
    source_class,
    source_type: raw.source_type || classifySourceType(raw.url),
    query: raw.query,
    discovery_method: raw.discovered_by,
    rank: raw.rank,
    paper_identity: identity,
    duplicate_group: identity,
    discovered_at: input.discovered_at ?? new Date().toISOString(),
    freshness_hint: null,
    authority_hint: source_class,
    relevance_hint: null,
  }
}

export function planResearchDiscovery(input: ResearchDiscoveryInput): ResearchDiscoveryPlan {
  const question = normalizeQuestion(input.question)
  const intent = classifyResearchIntent(question)
  const domain = input.research_domain ?? intent.research_domain
  const queries = constructDomainQueries(question)
  const primary_queries = queries.slice(0, 1)
  const alternate_queries = queries.slice(1)
  const preferred = preferredAuthorities(domain)
  const windowDays = input.freshness_window?.days ?? intent.freshness_window_days
  const candidate_budget = Math.min(Math.max(input.candidate_budget ?? (intent.wants_current ? 8 : 5), 3), 8)
  const stop = decideDiscoveryStop({
    usable_count: input.known_evidence?.length ?? 0,
    independent_count: input.known_sources?.length ?? 0,
    primary_count: 0,
    inspected_count: 0,
    candidate_budget,
    freshness_skips: 0,
    remaining_ms: 60_000,
    min_usable: 1,
    required_freshness: windowDays != null,
  })
  return {
    normalized_question: question,
    domain,
    primary_queries: primary_queries.length ? primary_queries : [question],
    alternate_queries,
    preferred_source_classes: preferred,
    required_freshness: { window_days: windowDays, strict: windowDays != null },
    candidate_budget,
    retry_budget: Math.min(Math.max(input.retry_budget ?? 1, 0), 3),
    stop_conditions: [stop.condition, 'CANDIDATE_BUDGET_EXHAUSTED', 'TOOL_BUDGET_EXHAUSTED', 'PRIMARY_PLUS_CORROBORATION'],
    recovery_strategy: recoveryFor(domain),
    expected_information_gain_hint: input.known_evidence?.length ? 'low' : 'high',
    remaining_evidence_gap: stop.remaining_evidence_gap,
    stop_condition_state: stop.condition,
  }
}

export function materializeDiscoveryCandidates(input: {
  plan: ResearchDiscoveryPlan
  urls: readonly { url: string; title?: string; query?: string }[]
}): EngineSourceCandidate[] {
  const seen = new Set<string>()
  const raw: ResearchSourceCandidate[] = []
  for (const [index, row] of input.urls.entries()) {
    const candidate = toCandidate({
      url: row.url,
      title: row.title,
      discovered_by: 'search',
      query: row.query || input.plan.primary_queries[0] || input.plan.normalized_question,
      rank: index + 1,
    })
    if (candidate) raw.push(candidate)
  }
  const selected = selectResearchCandidates(raw, {
    wantsPrimary: input.plan.preferred_source_classes.includes('PRIMARY_RESEARCH')
      || input.plan.preferred_source_classes.includes('OFFICIAL_GOVERNMENT')
      || input.plan.preferred_source_classes.includes('REGULATORY_FILING'),
    wantsCurrent: input.plan.required_freshness.strict,
    limit: input.plan.candidate_budget,
    prompt: input.plan.normalized_question,
  })
  const out: EngineSourceCandidate[] = []
  for (const row of selected) {
    const engine = toEngineCandidate({
      url: row.url,
      title: row.title,
      query: row.query,
      rank: row.rank,
      discovery_method: row.discovered_by,
    })
    if (!engine) continue
    if (seen.has(engine.duplicate_group)) continue
    seen.add(engine.duplicate_group)
    out.push(engine)
  }
  return out
}

export function runResearchDiscoveryEngine(
  input: ResearchDiscoveryInput,
  urls: readonly { url: string; title?: string; query?: string }[] = [],
): ResearchDiscoveryResult {
  const started = Date.now()
  const plan = planResearchDiscovery(input)
  const candidates = materializeDiscoveryCandidates({ plan, urls })
  const filtered = candidates.filter(row => {
    if (input.excluded_domains?.some(host => row.domain === host || row.domain.endsWith(`.${host}`))) return false
    if (input.preferred_domains?.length && !input.preferred_domains.some(host => row.domain === host || row.domain.endsWith(`.${host}`))) {
      return plan.preferred_source_classes.includes(row.source_class)
    }
    return true
  })
  return {
    plan,
    candidates: filtered,
    receipt: createEngineReceipt({
      engine: 'research-discovery',
      mission_id: input.mission_id,
      input_refs: [input.question.slice(0, 80)],
      output_refs: [plan.domain, ...filtered.map(row => row.candidate_id)],
      started_at: started,
      decision_count: filtered.length,
      failure_state: filtered.length ? 'none' : 'no_candidates',
    }),
  }
}
