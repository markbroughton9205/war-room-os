import { sourcesForRegionalResolution, resolveRegionalSources, type RegionalResolution } from '@/lib/intelligence/sources/regionalSourceResolver'
import { planSourceFallbacks, type SourceFallbackPlan } from '@/lib/intelligence/sources/sourceFallbackPlanner'
import { buildSourceHealthRecord, summarizeSourceHealth, type SourceHealthRecord } from '@/lib/intelligence/sources/sourceHealthMonitor'
import type { SourceNetworkTier } from '@/lib/intelligence/sources/sourceCategoryRegistry'

export type MandatoryRetrievalReason =
  | 'current_events'
  | 'weather'
  | 'politics'
  | 'crime_public_safety'
  | 'business_economics'
  | 'local_conditions'
  | 'public_sentiment'
  | 'breaking_developments'
  | 'explicit_live_retrieval'
  | 'relocation_planning'

export type RetrievalRequirement = {
  required: boolean
  reasons: MandatoryRetrievalReason[]
  confidence: number
}

export type RetrievalSourceMix = Partial<Record<SourceNetworkTier, number>>

export type RetrievalOrchestration = {
  required: boolean
  retrieval_required: boolean
  retrieval_started: boolean
  retrieval_complete: boolean
  retrieval_failed: boolean
  synthesis_allowed: boolean
  reasons: MandatoryRetrievalReason[]
  generated_at: string
  regional_resolution: RegionalResolution
  planned_source_ids: string[]
  source_mix: RetrievalSourceMix
  health: SourceHealthRecord[]
  health_summary: ReturnType<typeof summarizeSourceHealth>
  fallback_plan: SourceFallbackPlan
  retrieval_success: boolean
  retrieval_gaps: string[]
}

const MANDATORY_PATTERNS: { reason: MandatoryRetrievalReason; pattern: RegExp }[] = [
  { reason: 'explicit_live_retrieval', pattern: /\b(live|current|latest|today|right\s+now|as\s+of|use\s+sources?|retrieve|search)\b/i },
  { reason: 'current_events', pattern: /\b(news|headlines?|current\s+events?|what\s+happened|developing)\b/i },
  { reason: 'weather', pattern: /\b(weather|storm|rain|snow|heat|temperature|forecast|air\s+quality)\b/i },
  { reason: 'politics', pattern: /\b(election|polling|congress|senate|white\s+house|governor|mayor|policy|legislation|bill)\b/i },
  { reason: 'crime_public_safety', pattern: /\b(crime|shooting|robbery|police|public\s+safety|incident|sirens?|fire|crash|accident)\b/i },
  { reason: 'business_economics', pattern: /\b(stock|market|earnings|inflation|jobs?|unemployment|business|company|closure|opening|economy|recession)\b/i },
  { reason: 'local_conditions', pattern: /\b(local|nearby|around\s+me|in\s+akron|cleveland|summit\s+county|neighborhood|traffic|road\s+closure)\b/i },
  { reason: 'public_sentiment', pattern: /\b(people\s+talking|sentiment|chatter|reddit|twitter|x\.com|community\s+discussion|rumor)\b/i },
  { reason: 'breaking_developments', pattern: /\b(breaking|developing|ongoing|live\s+updates?|just\s+happened)\b/i },
  // Suffixes are deliberately restricted to (?:e|ion|ing) rather than \w* — aligned with
  // lib/research/researchIntent.ts's PLANNING_LOGISTICS_TRIGGERS so the two files behave
  // consistently. A looser \w* previously matched "emigrated" (past tense) here while the
  // narrower researchIntent.ts pattern correctly did not, an inconsistency an independent review
  // surfaced as a confirmed false positive ("our fictional character emigrated").
  { reason: 'relocation_planning', pattern: /\b(relocat(?:e|ion|ing)|immigrat(?:e|ion|ing)|emigrat(?:e|ion|ing)|move\s+to|moving\s+to|plan(?:ning)?\s+(?:our|my|the|a)\s+(?:move|relocation|trip)|visa\s+requirements?|travel\s+(?:plan(?:ning)?|logistics|requirements?)|housing\s+logistics|transportation\s+logistics|how\s+(?:can|do|would|could)\s+we\s+(?:get\s+to|relocate|move|accomplish|achieve))\b/i },
]

/**
 * Code/meta-discussion nouns that indicate a relocation-shaped word is being used about code or
 * the word itself, not a real-world planning request — mirrors
 * lib/research/researchIntent.ts's PLANNING_CODE_OR_META_CONTEXT (kept as a separate local
 * constant rather than a shared import to avoid a circular dependency: researchIntent.ts already
 * imports `evaluateMandatoryLiveRetrieval` from this file). Scoped to the `relocation_planning`
 * reason only — it must not suppress the other, unrelated mandatory-retrieval reasons.
 */
const RELOCATION_CODE_OR_META_CONTEXT =
  /\b(?:function|file|variable|method|class|module|component|regex|code|script|directory|folder|word|document|constant|property|parameter|argument)\b/i

export function evaluateMandatoryLiveRetrieval(decree: string): RetrievalRequirement {
  const reasons = MANDATORY_PATTERNS
    .filter(item => item.pattern.test(decree))
    .filter(item => item.reason !== 'relocation_planning' || !RELOCATION_CODE_OR_META_CONTEXT.test(decree))
    .map(item => item.reason)
  const unique = [...new Set(reasons)]
  return {
    required: unique.length > 0,
    reasons: unique,
    confidence: unique.length ? Math.min(1, 0.45 + unique.length * 0.12) : 0,
  }
}

function sourceMix(sourceIds: string[]): RetrievalSourceMix {
  const sources = sourcesForRegionalResolution({
    locality: 'unknown',
    localFirst: false,
    sourceIds,
  })
  return sources.reduce<RetrievalSourceMix>((acc, source) => {
    acc[source.tier] = (acc[source.tier] ?? 0) + 1
    return acc
  }, {})
}

export function buildRetrievalOrchestration(args: {
  decree: string
  generatedAt: string
  tavilyOk: boolean
  tavilyLatencyMs?: number | null
  tavilyError?: string
  grokOk: boolean
  grokError?: string
  directOk: boolean
  directError?: string
}): RetrievalOrchestration {
  const requirement = evaluateMandatoryLiveRetrieval(args.decree)
  const regional = resolveRegionalSources(args.decree)
  const planned = sourcesForRegionalResolution(regional)
  const health = planned.map(source => {
    const searchBacked = source.retrieval_mode === 'search_discovery'
    const framingBacked = source.source_id === 'x_twitter_discussions'
    const directBacked = source.retrieval_mode === 'direct_fetch' || source.retrieval_mode === 'direct_feed'
    const success = searchBacked ? args.tavilyOk : framingBacked ? args.grokOk : directBacked ? args.directOk : false
    const error = success
      ? undefined
      : !source.configured
        ? 'source adapter not configured'
        : searchBacked
          ? args.tavilyError ?? 'search discovery returned no usable result'
          : framingBacked
            ? args.grokError ?? 'signal framing unavailable'
            : args.directError ?? 'direct feed/fetch unavailable'
    return buildSourceHealthRecord({
      source,
      checkedAt: args.generatedAt,
      success,
      latencyMs: searchBacked ? args.tavilyLatencyMs ?? null : null,
      error,
    })
  })
  const fallbackPlan = planSourceFallbacks({ plannedSources: planned, health })
  const healthSummary = summarizeSourceHealth(health)
  const retrievalSuccess = !requirement.required || health.some(record => record.success)
  const retrievalFailed = requirement.required && !retrievalSuccess

  return {
    required: requirement.required,
    retrieval_required: requirement.required,
    retrieval_started: true,
    retrieval_complete: true,
    retrieval_failed: retrievalFailed,
    synthesis_allowed: !retrievalFailed,
    reasons: requirement.reasons,
    generated_at: args.generatedAt,
    regional_resolution: regional,
    planned_source_ids: regional.sourceIds,
    source_mix: sourceMix(regional.sourceIds),
    health,
    health_summary: healthSummary,
    fallback_plan: fallbackPlan,
    retrieval_success: retrievalSuccess,
    retrieval_gaps: [
      ...fallbackPlan.gaps,
      ...(retrievalFailed ? ['Mandatory retrieval failed; current/live answer must disclose failure and avoid current-event claims.'] : []),
    ],
  }
}
