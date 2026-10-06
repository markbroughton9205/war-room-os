import { DEFAULT_SCORING, scoreSubject, type Scorecard, type ScoringParams } from './scoring'
import type { ProposalDraft } from './proposals'
import type { EvalSubject, EvaluationEvent, TaskClass } from './types'

export type RoutingWeights = { cost: number; latency: number }
export type RankedCandidate = {
  card: Scorecard
  utility: number
  /** Metrics that were UNKNOWN and therefore given a neutral (not zero) penalty. */
  unknownMetrics: ('cost' | 'latency')[]
}
export type RoutingRecommendation = {
  taskClass: TaskClass
  recommended: EvalSubject | null
  reason: 'RECOMMENDED' | 'INSUFFICIENT_EVIDENCE'
  ranking: RankedCandidate[]
  citedEventIds: string[]
  contradictoryEventIds: string[]
  weights: RoutingWeights
  /** This layer only recommends. */
  applied: false
}

function normalize(values: (number | 'UNKNOWN')[]): (number | 'UNKNOWN')[] {
  const known = values.filter((v): v is number => v !== 'UNKNOWN')
  if (known.length === 0) return values.map(() => 'UNKNOWN')
  const lo = Math.min(...known)
  const hi = Math.max(...known)
  return values.map((v) => (v === 'UNKNOWN' ? 'UNKNOWN' : hi === lo ? 0.5 : (v - lo) / (hi - lo)))
}

/**
 * F — recommend a provider/model for a task class from measured outcomes. Utility = score − w_cost·cost − w_latency·latency
 * (min-max normalized across candidates). UNKNOWN cost/latency takes a neutral 0.5 penalty, never 0. Abstains below minConfidence.
 */
export function recommendRouting(
  events: EvaluationEvent[],
  taskClass: TaskClass,
  now: Date,
  opts: { weights?: Partial<RoutingWeights>; minConfidence?: number; params?: ScoringParams; kind?: EvalSubject['kind'] } = {},
): RoutingRecommendation {
  const weights: RoutingWeights = { cost: 0, latency: 0, ...opts.weights }
  const kind = opts.kind ?? 'provider'
  const subjects = new Map<string, EvalSubject>()
  for (const e of events) if (e.subject.kind === kind && e.taskClass === taskClass) subjects.set(e.subject.id, e.subject)
  const cards = [...subjects.values()].map((s) => scoreSubject(events, s, taskClass, now, opts.params ?? DEFAULT_SCORING))
  const cost = normalize(cards.map((c) => c.costUsd))
  const lat = normalize(cards.map((c) => c.latencyMs))
  const ranking: RankedCandidate[] = cards
    .map((card, i) => {
      const unknownMetrics: RankedCandidate['unknownMetrics'] = []
      const cn = cost[i] === 'UNKNOWN' ? (unknownMetrics.push('cost'), 0.5) : (cost[i] as number)
      const ln = lat[i] === 'UNKNOWN' ? (unknownMetrics.push('latency'), 0.5) : (lat[i] as number)
      const base = card.score === 'UNKNOWN' ? 0 : card.score
      // confidence-weighted quality so a thin-evidence candidate cannot beat a well-evidenced one on luck
      return { card, utility: base * (0.5 + 0.5 * card.confidence) - weights.cost * cn - weights.latency * ln, unknownMetrics }
    })
    .sort((a, b) => b.utility - a.utility || a.card.subject.id.localeCompare(b.card.subject.id))
  const top = ranking[0]
  const ok = !!top && top.card.confidence >= (opts.minConfidence ?? 0.4)
  const cited = ranking.slice(0, 2)
  return {
    taskClass,
    recommended: ok ? top.card.subject : null,
    reason: ok ? 'RECOMMENDED' : 'INSUFFICIENT_EVIDENCE',
    ranking,
    citedEventIds: [...new Set(cited.flatMap((r) => r.card.evidenceEventIds))],
    contradictoryEventIds: [...new Set(ranking.flatMap((r) => r.card.contradictoryEventIds))],
    weights,
    applied: false,
  }
}

/** Converts a recommendation into a reviewable proposal draft (persist via submitProposal). */
export function routingProposalDraft(rec: RoutingRecommendation): ProposalDraft {
  if (!rec.recommended) throw new Error('no recommendation to propose: insufficient evidence')
  const top = rec.ranking[0]
  return {
    kind: 'ROUTING_RECOMMENDATION',
    title: `Prefer ${rec.recommended.id} for ${rec.taskClass}`,
    summary: `utility ${top.utility.toFixed(3)}, score ${typeof top.card.score === 'number' ? top.card.score.toFixed(2) : 'UNKNOWN'}, confidence ${top.card.confidence.toFixed(2)} over ${top.card.rawSamples} runs; cost weight ${rec.weights.cost}, latency weight ${rec.weights.latency}.`,
    evidenceEventIds: rec.citedEventIds,
    contradictoryEventIds: rec.contradictoryEventIds,
    confidence: top.card.confidence,
    scope: `routing/${rec.taskClass}`,
    reviewBy: undefined,
    payload: { recommended: rec.recommended, ranking: rec.ranking.map((r) => ({ id: r.card.subject.id, utility: r.utility, unknownMetrics: r.unknownMetrics })) },
  }
}
