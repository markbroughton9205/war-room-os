import type { EvalSubject, EvaluationEvent, TaskClass } from './types'
import { TASK_CLASSES } from './types'

export type ScoringParams = {
  /** Evidence weight halves every this many days (stale evidence decays). */
  halfLifeDays: number
  /** Pseudo-observations pulling toward the 0.5 prior, so one bad (or good) run cannot dominate. */
  priorStrength: number
}
export const DEFAULT_SCORING: ScoringParams = { halfLifeDays: 30, priorStrength: 3 }

export type Unknown = 'UNKNOWN'
export type Scorecard = {
  subject: EvalSubject
  taskClass: TaskClass
  /** 0..1, or UNKNOWN when there is no active evidence. */
  score: number | Unknown
  /** 0..1; falls with thin/stale evidence and with contradictory evidence. */
  confidence: number
  /** 0..1; share of evidence pulling in opposite directions. */
  contradiction: number
  effectiveSamples: number
  rawSamples: number
  rollbackCount: number
  /** Decay-weighted means over events that reported the metric; UNKNOWN if none did. */
  latencyMs: number | Unknown
  costUsd: number | Unknown
  lastEvidenceAt?: string
  evidenceEventIds: string[]
  contradictoryEventIds: string[]
}

/** value in [0,1] and a weight multiplier per event. Rollbacks and Commander corrections weigh more than plain runs. */
function valueOf(e: EvaluationEvent): { value: number; weight: number } {
  if (e.outcome === 'ROLLED_BACK') return { value: 0, weight: 1.5 }
  if (e.signal === 'COMMANDER_CORRECTION') return { value: e.outcome === 'SUCCESS' ? 0.5 : 0.25, weight: 1.25 }
  if (e.outcome === 'SUCCESS') return { value: 1, weight: 1 }
  if (e.outcome === 'PARTIAL') return { value: 0.5, weight: 1 }
  return { value: 0, weight: 1 } // FAILURE | REJECTED
}

function decay(e: EvaluationEvent, now: Date, p: ScoringParams): number {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(e.occurredAt)) / 86_400_000)
  return Math.pow(0.5, ageDays / p.halfLifeDays)
}

function wmean(items: { v: number; w: number }[]): number | Unknown {
  const tw = items.reduce((a, b) => a + b.w, 0)
  return items.length === 0 || tw === 0 ? 'UNKNOWN' : items.reduce((a, b) => a + b.v * b.w, 0) / tw
}

export function scoreSubject(
  events: EvaluationEvent[],
  subject: EvalSubject,
  taskClass: TaskClass,
  now: Date,
  params: ScoringParams = DEFAULT_SCORING,
): Scorecard {
  const rel = events.filter((e) => e.subject.kind === subject.kind && e.subject.id === subject.id && e.taskClass === taskClass)
  let n = 0
  let mass = 0
  let pos = 0
  let neg = 0
  const posIds: string[] = []
  const negIds: string[] = []
  for (const e of rel) {
    const { value, weight } = valueOf(e)
    const w = weight * decay(e, now, params)
    n += w
    mass += w * value
    if (value >= 0.75) { pos += w; posIds.push(e.id) }
    if (value <= 0.25) { neg += w; negIds.push(e.id) }
  }
  const score = rel.length === 0 ? 'UNKNOWN' : (mass + params.priorStrength * 0.5) / (n + params.priorStrength)
  const contradiction = pos + neg === 0 ? 0 : (2 * Math.min(pos, neg)) / (pos + neg)
  const confidence = rel.length === 0 ? 0 : (n / (n + params.priorStrength)) * (1 - 0.5 * contradiction)
  const metric = (key: 'latencyMs' | 'costUsd') =>
    wmean(rel.filter((e) => e.metrics[key] !== undefined).map((e) => ({ v: e.metrics[key] as number, w: decay(e, now, params) })))
  const sorted = [...rel].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  return {
    subject,
    taskClass,
    score,
    confidence,
    contradiction,
    effectiveSamples: n,
    rawSamples: rel.length,
    rollbackCount: rel.filter((e) => e.outcome === 'ROLLED_BACK').length,
    latencyMs: metric('latencyMs'),
    costUsd: metric('costUsd'),
    lastEvidenceAt: sorted[0]?.occurredAt,
    evidenceEventIds: rel.map((e) => e.id),
    // contradictory evidence is surfaced from the minority side, never hidden
    contradictoryEventIds: contradiction > 0 ? (pos <= neg ? posIds : negIds) : [],
  }
}

/** Scorecards for every (subject, task class) pair that has evidence. Pass only ACTIVE (non-superseded) events. */
export function scoreMatrix(events: EvaluationEvent[], now: Date, params: ScoringParams = DEFAULT_SCORING, kind?: EvalSubject['kind']): Scorecard[] {
  const seen = new Map<string, EvalSubject>()
  for (const e of events) if (!kind || e.subject.kind === kind) seen.set(`${e.subject.kind}:${e.subject.id}`, e.subject)
  const out: Scorecard[] = []
  for (const subject of seen.values())
    for (const tc of TASK_CLASSES) {
      const card = scoreSubject(events, subject, tc, now, params)
      if (card.rawSamples > 0) out.push(card)
    }
  return out
}

export type WorkflowRanking = { rank: number; card: Scorecard }
/** C — rank workflows from measured outcomes. UNKNOWN-score workflows sort last; ties break on confidence then id. */
export function rankWorkflows(events: EvaluationEvent[], taskClass: TaskClass, now: Date, params: ScoringParams = DEFAULT_SCORING): WorkflowRanking[] {
  const cards = scoreMatrix(events, now, params, 'workflow').filter((c) => c.taskClass === taskClass)
  const num = (c: Scorecard) => (c.score === 'UNKNOWN' ? -1 : c.score)
  cards.sort((a, b) => num(b) - num(a) || b.confidence - a.confidence || a.subject.id.localeCompare(b.subject.id))
  return cards.map((card, i) => ({ rank: i + 1, card }))
}
