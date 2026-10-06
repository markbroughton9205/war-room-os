import { detectRecurringFailures, type FailureFinding } from './analysis'
import { buildDoctrineProposals, buildMemoryCandidates, proposalStatus, type ProposalDraft, type ProposalStatus } from './proposals'
import { recommendRouting, routingProposalDraft, type RoutingRecommendation } from './recommendations'
import { DEFAULT_SCORING, rankWorkflows, scoreMatrix, scoreSubject, type Scorecard } from './scoring'
import { stableEventId } from './ingestion/ids'
import type { LearningLog, LogView } from './store'
import { TASK_CLASSES, type EvaluationEvent, type Proposal, type TaskClass } from './types'

/** Read-only projections for the Commander. Nothing here writes to the log. */

export const TREND_DAYS = 14
const HONEST_NOTE = 'Recommendations are advisory. Nothing here changes routing, policy, memory or doctrine.'

export function explainScore(c: Scorecard): string {
  const s = typeof c.score === 'number' ? c.score.toFixed(2) : 'UNKNOWN'
  const conf = c.confidence >= 0.6 ? 'solid' : c.confidence >= 0.3 ? 'moderate' : 'thin'
  return `score ${s} from ${c.rawSamples} run(s) (${c.effectiveSamples.toFixed(1)} effective after time decay), pulled toward a neutral prior; ` +
    `confidence ${c.confidence.toFixed(2)} (${conf} evidence); contradiction ${c.contradiction.toFixed(2)}; rollbacks ${c.rollbackCount}; ` +
    `latency ${c.latencyMs === 'UNKNOWN' ? 'UNKNOWN' : Math.round(c.latencyMs) + 'ms'}; cost ${c.costUsd === 'UNKNOWN' ? 'UNKNOWN' : '$' + c.costUsd.toFixed(4)}.`
}

export type ScoreRow = { card: Scorecard; trend: number | 'UNKNOWN'; explanation: string; drill: string }

function trendOf(all: EvaluationEvent[], c: Scorecard, now: Date): number | 'UNKNOWN' {
  const then = new Date(now.getTime() - TREND_DAYS * 86_400_000)
  const prior = all.filter((e) => Date.parse(e.occurredAt) <= then.getTime())
  const before = scoreSubject(prior, c.subject, c.taskClass, then, DEFAULT_SCORING)
  return typeof before.score === 'number' && typeof c.score === 'number' ? c.score - before.score : 'UNKNOWN'
}

export type CandidateRow = { key: string; draft: ProposalDraft; state: 'PROPOSED_NOT_RECORDED' }
export type ProposalRow = { proposal: Proposal; status: ProposalStatus; drill: string }
export type Snapshot = {
  generatedAt: string
  governance: { readOnly: true; note: string }
  totals: { events: number; active: number; superseded: number; backfilled: number; live: number; proposals: number; decisions: number }
  scores: ScoreRow[]
  /** Data-source limitation, stated explicitly: Foundry mission records carry no workflow attribution. */
  workflowAttribution: { available: boolean; note: string }
  workflows: { taskClass: TaskClass; ranking: { rank: number; card: Scorecard; explanation: string; drill: string }[] }[]
  recentEvents: EvaluationEvent[]
  failures: (FailureFinding & { drill: string })[]
  recommendations: (RoutingRecommendation & { kind: 'provider' | 'model'; drill: string; caveats: string[] })[]
  memoryCandidates: { recorded: ProposalRow[]; pending: (CandidateRow & { drill: string })[] }
  doctrineProposals: { recorded: ProposalRow[]; pending: (CandidateRow & { drill: string })[] }
}

const candKey = (d: ProposalDraft) => stableEventId('candidate', d.kind, d.scope, String(d.payload.signature ?? d.title))

function deriveCandidates(active: EvaluationEvent[], now: Date) {
  const failures = detectRecurringFailures(active, now)
  const cards = scoreMatrix(active, now)
  const mem: CandidateRow[] = buildMemoryCandidates(failures, cards, now).map((draft) => ({ key: candKey(draft), draft, state: 'PROPOSED_NOT_RECORDED' }))
  const doc: CandidateRow[] = buildDoctrineProposals(failures).map((draft) => ({ key: candKey(draft), draft, state: 'PROPOSED_NOT_RECORDED' }))
  return { failures, cards, mem, doc }
}

function workflowAttribution(active: EvaluationEvent[]) {
  const available = active.some((e) => e.subject.kind === 'workflow')
  return { available, note: available ? 'Workflow rankings come from workflow-attributed evidence only.' : 'No attributable workflow data yet: current mission records do not identify a workflow. Nothing is inferred.' }
}

export function buildSnapshot(log: LearningLog, now: Date, opts: { eventLimit?: number } = {}): Snapshot {
  const view = log.view()
  const active = view.activeEvents
  const { failures, cards, mem, doc } = deriveCandidates(active, now)
  const recKinds = ['provider', 'model'] as const
  const recommendations = recKinds.flatMap((kind) =>
    TASK_CLASSES.map((tc) => ({ kind, tc, rec: recommendRouting(active, tc, now, { kind, weights: { cost: 0.2, latency: 0.1 } }) })).filter((x) => x.rec.ranking.length > 0)
      .map(({ kind, tc, rec }) => ({
        ...rec, kind, drill: `recommendation:${kind}:${tc}`,
        caveats: [
          ...(rec.reason === 'INSUFFICIENT_EVIDENCE' ? ['insufficient evidence: no recommendation made'] : []),
          ...(rec.ranking.some((r) => r.unknownMetrics.length) ? ['some cost/latency data is UNKNOWN (neutral penalty applied, not zero)'] : []),
          ...(rec.contradictoryEventIds.length ? [`${rec.contradictoryEventIds.length} contradicting event(s) on file`] : []),
        ],
      })))
  const proposalRows = (kinds: Proposal['kind'][]): ProposalRow[] => view.proposals.filter((p) => kinds.includes(p.kind)).map((proposal) => ({ proposal, status: proposalStatus(view, proposal.id), drill: `proposal:${proposal.id}` }))
  const recent = [...view.events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, opts.eventLimit ?? 50)
  return {
    generatedAt: now.toISOString(),
    governance: { readOnly: true, note: HONEST_NOTE },
    totals: {
      events: view.events.length, active: active.length, superseded: view.events.length - active.length,
      backfilled: view.events.filter((e) => e.provenance?.backfilled).length, live: view.events.filter((e) => e.provenance && !e.provenance.backfilled).length,
      proposals: view.proposals.length, decisions: view.decisions.length,
    },
    scores: cards.map((card) => ({ card, trend: trendOf(active, card, now), explanation: explainScore(card), drill: `score:${card.subject.kind}:${card.subject.id}:${card.taskClass}` })),
    workflowAttribution: workflowAttribution(active),
    workflows: TASK_CLASSES.map((taskClass) => ({
      taskClass,
      ranking: rankWorkflows(active, taskClass, now).map((r) => ({ ...r, explanation: explainScore(r.card), drill: `score:workflow:${r.card.subject.id}:${taskClass}` })),
    })).filter((w) => w.ranking.length > 0),
    recentEvents: recent,
    failures: failures.map((f) => ({ ...f, drill: `failure:${f.signature}` })),
    recommendations,
    memoryCandidates: { recorded: proposalRows(['MEMORY_PROMOTION']), pending: mem.map((c) => ({ ...c, drill: `candidate:${c.key}` })) },
    doctrineProposals: { recorded: proposalRows(['DOCTRINE_CHANGE', 'ARCHITECTURE_CHANGE']), pending: doc.map((c) => ({ ...c, drill: `candidate:${c.key}` })) },
  }
}

export type EvidenceItem = { event: EvaluationEvent; superseded: boolean; supersededReason?: string; supersededBy?: string }
export type DrillResult = { target: string; title: string; explanation: string; supporting: EvidenceItem[]; contradictory: EvidenceItem[]; missingEventIds: string[]; decisions: LogView['decisions']; status?: ProposalStatus }

function resolve(view: LogView, ids: string[]): { items: EvidenceItem[]; missing: string[] } {
  const byId = new Map(view.events.map((e) => [e.id, e]))
  const sup = new Map(view.supersessions.map((s) => [s.eventId, s]))
  const items: EvidenceItem[] = []
  const missing: string[] = []
  for (const id of ids) {
    const event = byId.get(id)
    if (!event) missing.push(id)
    else items.push({ event, superseded: sup.has(id), supersededReason: sup.get(id)?.reason, supersededBy: sup.get(id)?.supersededBy })
  }
  return { items, missing }
}

/** Drill any displayed score, recommendation, failure, candidate or proposal down to its source events. */
export function resolveDrill(log: LearningLog, target: string, now: Date): DrillResult | null {
  const view = log.view()
  const active = view.activeEvents
  const mk = (title: string, explanation: string, ids: string[], contra: string[], extra: Partial<DrillResult> = {}): DrillResult => {
    const s = resolve(view, ids)
    const c = resolve(view, contra)
    return { target, title, explanation, supporting: s.items, contradictory: c.items, missingEventIds: [...s.missing, ...c.missing], decisions: [], ...extra }
  }
  const [kind, ...rest] = target.split(':')
  if (kind === 'score') {
    const [sk, ...more] = rest
    const taskClass = more[more.length - 1] as TaskClass
    const id = more.slice(0, -1).join(':')
    if (!TASK_CLASSES.includes(taskClass) || !['provider', 'model', 'workflow', 'tool'].includes(sk)) return null
    const card = scoreSubject(active, { kind: sk as 'provider', id }, taskClass, now)
    if (card.rawSamples === 0) return null
    return mk(`${sk} ${id} on ${taskClass}`, explainScore(card), card.evidenceEventIds, card.contradictoryEventIds)
  }
  if (kind === 'recommendation') {
    const [rk, tc] = rest
    if (!['provider', 'model'].includes(rk) || !TASK_CLASSES.includes(tc as TaskClass)) return null
    const rec = recommendRouting(active, tc as TaskClass, now, { kind: rk as 'provider', weights: { cost: 0.2, latency: 0.1 } })
    if (rec.ranking.length === 0) return null
    return mk(rec.recommended ? `Prefer ${rec.recommended.id} for ${tc}` : `No recommendation for ${tc}`, rec.ranking.map((r) => `${r.card.subject.id}: utility ${r.utility.toFixed(3)}`).join('; '), rec.citedEventIds, rec.contradictoryEventIds)
  }
  if (kind === 'failure') {
    const f = detectRecurringFailures(active, now).find((x) => x.signature === rest.join(':'))
    return f ? mk(f.signature, `${f.count} failures; ${f.report.rootCause}. ${f.report.recommendedMitigation}.`, f.evidenceEventIds, f.contradictingSuccessIds) : null
  }
  if (kind === 'candidate') {
    const { mem, doc } = deriveCandidates(active, now)
    const c = [...mem, ...doc].find((x) => x.key === rest.join(':'))
    return c ? mk(c.draft.title, c.draft.summary, c.draft.evidenceEventIds, c.draft.contradictoryEventIds, { status: 'PROPOSED' }) : null
  }
  if (kind === 'proposal') {
    const p = view.proposals.find((x) => x.id === rest.join(':'))
    return p ? mk(p.title, p.summary, p.evidenceEventIds, p.contradictoryEventIds, { decisions: view.decisions.filter((d) => d.proposalId === p.id), status: proposalStatus(view, p.id) }) : null
  }
  return null
}

export { routingProposalDraft }
