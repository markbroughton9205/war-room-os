import type { EconomicFamily, EconomicOperationalDomainId } from '@/lib/economic/types'
import { runFirecrawlScout, type FirecrawlScoutResult } from '@/lib/economic/scout/firecrawlScout'
import {
  buildDecreeFallbackCandidate,
  normalizeScoutResults,
  type NormalizedScoutCandidate,
} from '@/lib/economic/scout/normalizeScoutResults'
import { runTavilyScout, type TavilyScoutResult } from '@/lib/economic/scout/tavilyScout'

export type LiveOpportunityScoutPipelineResult = {
  ok: boolean
  candidates: NormalizedScoutCandidate[]
  rankedCandidates: NormalizedScoutCandidate[]
  fallbackCreated: boolean
  fallbackReason: string | null
  tavily: TavilyScoutResult
  firecrawl: FirecrawlScoutResult
  diagnostics: {
    tavily_enabled: boolean
    tavily_query_count: number
    tavily_results_count: number
    firecrawl_enabled: boolean
    firecrawl_targets_count: number
    normalized_candidates_count: number
    ranked_candidates_count: number
    fallback_triggered: boolean
    fallback_reason: string | null
    ranked_preview: { title: string; score: number }[]
  }
  telemetry: {
    scout_queries: number
    scout_success: number
    scout_failure: number
    candidates_generated: number
    candidates_ranked: number
    family_scores_created: number
  }
}

export async function runLiveOpportunityScoutPipeline(input: {
  decree: string
  domainId: EconomicOperationalDomainId
  fallbackFamily: EconomicFamily
}): Promise<LiveOpportunityScoutPipelineResult> {
  const tavily = await runTavilyScout({
    decree: input.decree,
    domainId: input.domainId,
  })
  const tavilyCandidates = normalizeScoutResults({
    rawResults: tavily.results,
    domainId: input.domainId,
    fallbackFamily: input.fallbackFamily,
  }).slice(0, 8)

  const firecrawl = await runFirecrawlScout({ candidates: tavilyCandidates })
  const enrichedCandidates = normalizeScoutResults({
    rawResults: firecrawl.results,
    domainId: input.domainId,
    fallbackFamily: input.fallbackFamily,
  })

  const candidatesByKey = new Map<string, NormalizedScoutCandidate>()
  for (const candidate of [...tavilyCandidates, ...enrichedCandidates]) {
    const key = candidate.url ?? `${candidate.source}:${candidate.title}`
    const previous = candidatesByKey.get(key)
    if (!previous || candidate.rank_score > previous.rank_score) candidatesByKey.set(key, candidate)
  }

  let candidates = Array.from(candidatesByKey.values())
  const normalizedCandidateCount = candidates.length
  let fallbackCreated = false
  let fallbackReason: string | null = null
  if (!candidates.length) {
    fallbackCreated = true
    fallbackReason = tavily.error ?? firecrawl.error ?? 'live_scout_empty'
    candidates = [buildDecreeFallbackCandidate({
      decree: input.decree,
      domainId: input.domainId,
      fallbackFamily: input.fallbackFamily,
      reason: fallbackReason,
    })]
  }

  const rankedCandidates = candidates
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, 3)
  const diagnostics = {
    tavily_enabled: tavily.enabled,
    tavily_query_count: tavily.queries.length,
    tavily_results_count: tavily.results.length,
    firecrawl_enabled: firecrawl.enabled,
    firecrawl_targets_count: firecrawl.attempted,
    normalized_candidates_count: normalizedCandidateCount,
    ranked_candidates_count: rankedCandidates.length,
    fallback_triggered: fallbackCreated,
    fallback_reason: fallbackReason,
    ranked_preview: rankedCandidates.map(candidate => ({
      title: candidate.title,
      score: candidate.rank_score,
    })),
  }

  console.info('[economic-scout]', diagnostics)

  return {
    ok: !fallbackCreated && rankedCandidates.length > 0,
    candidates,
    rankedCandidates,
    fallbackCreated,
    fallbackReason,
    tavily,
    firecrawl,
    diagnostics,
    telemetry: {
      scout_queries: tavily.queries.length,
      scout_success: tavily.ok || firecrawl.ok ? 1 : 0,
      scout_failure: tavily.ok || firecrawl.ok ? 0 : 1,
      candidates_generated: candidates.length,
      candidates_ranked: rankedCandidates.length,
      family_scores_created: rankedCandidates.length * 5,
    },
  }
}
