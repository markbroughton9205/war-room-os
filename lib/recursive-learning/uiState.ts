import type { Snapshot, DrillResult } from './readModel'

/** Pure view-model for the Commander learning surface. All text is derived from API data; no score is shown without its explanation. */
export type LoadState<T> = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: T }

export type ApiEnvelope = { readOnly: boolean; generatedAt: string; totals: Snapshot['totals']; governance: Snapshot['governance']; data: Snapshot }

const fmt = (v: number | 'UNKNOWN', d = 2) => (typeof v === 'number' ? v.toFixed(d) : 'UNKNOWN')
const trendLabel = (t: number | 'UNKNOWN') => (t === 'UNKNOWN' ? 'trend UNKNOWN' : Math.abs(t) < 0.02 ? 'steady' : t > 0 ? `up ${t.toFixed(2)}` : `down ${Math.abs(t).toFixed(2)}`)

export type Row = { id: string; title: string; detail: string; explanation: string; drill: string; flags: string[] }
export type Section = { key: string; title: string; empty: string; rows: Row[] }

export function buildLearningViewModel(env: ApiEnvelope) {
  const s = env.data
  const sections: Section[] = [
    {
      key: 'provider-performance', title: 'Provider Performance', empty: 'No provider/model evidence yet.',
      rows: s.scores.filter((r) => r.card.subject.kind !== 'workflow').map((r) => ({
        id: r.drill, title: `${r.card.subject.id} · ${r.card.taskClass}`,
        detail: `score ${fmt(r.card.score)} · confidence ${fmt(r.card.confidence)} · ${r.card.rawSamples} evidence · ${trendLabel(r.trend)}`,
        explanation: r.explanation, drill: r.drill,
        flags: [...(r.card.contradiction > 0.3 ? ['contradicting evidence'] : []), ...(r.card.confidence < 0.3 ? ['thin evidence'] : []), ...(r.card.rollbackCount ? [`${r.card.rollbackCount} rollback(s)`] : [])],
      })),
    },
    {
      key: 'workflow-performance', title: 'Workflow Performance', empty: s.workflowAttribution.note,
      rows: s.workflows.flatMap((w) => w.ranking.map((r) => ({
        id: r.drill, title: `#${r.rank} ${r.card.subject.id} · ${w.taskClass}`,
        detail: `reliability ${fmt(r.card.score)} · latency ${fmt(r.card.latencyMs, 0)} · cost ${fmt(r.card.costUsd, 4)} · rollbacks ${r.card.rollbackCount}`,
        explanation: r.explanation, drill: r.drill, flags: r.card.contradiction > 0.3 ? ['contradicting evidence'] : [],
      }))),
    },
    {
      key: 'recurring-failures', title: 'Recurring Failures', empty: 'No recurring failures in the window.',
      rows: s.failures.map((f) => ({
        id: f.drill, title: f.signature, detail: `${f.count} failures · ${f.firstSeen.slice(0, 10)} → ${f.lastSeen.slice(0, 10)}`,
        explanation: `${f.report.rootCause}. Proposed mitigation: ${f.report.recommendedMitigation}.`, drill: f.drill,
        flags: f.contradictingSuccessIds.length ? [`${f.contradictingSuccessIds.length} contradicting success(es)`] : [],
      })),
    },
    {
      key: 'routing-recommendations', title: 'Routing Recommendations', empty: 'No routing candidates yet.',
      rows: s.recommendations.map((r) => ({
        id: r.drill, title: `${r.kind} · ${r.taskClass}: ${r.recommended ? r.recommended.id : 'no recommendation'}`,
        detail: r.ranking.length ? `confidence ${fmt(r.ranking[0].card.confidence)} · alternatives: ${r.ranking.slice(1).map((a) => a.card.subject.id).join(', ') || 'none'}` : 'no candidates',
        explanation: `Advisory only (applied=false). Utility = quality weighted by confidence, minus cost ${r.weights.cost} and latency ${r.weights.latency} weights. ${r.caveats.join('; ')}`.trim(),
        drill: r.drill, flags: r.caveats,
      })),
    },
    {
      key: 'memory-candidates', title: 'Strategic Memory Candidates', empty: 'No memory candidates.',
      rows: [
        ...s.memoryCandidates.pending.map((c) => ({ id: c.drill, title: c.draft.title, detail: 'state PROPOSED (not recorded) · never auto-promoted', explanation: c.draft.summary, drill: c.drill, flags: c.draft.contradictoryEventIds.length ? [`${c.draft.contradictoryEventIds.length} contradiction(s)`] : [] })),
        ...s.memoryCandidates.recorded.map((p) => ({ id: p.drill, title: p.proposal.title, detail: `state ${p.status} · promotion requires Commander approval`, explanation: p.proposal.summary, drill: p.drill, flags: p.proposal.contradictoryEventIds.length ? [`${p.proposal.contradictoryEventIds.length} contradiction(s)`] : [] })),
      ],
    },
    {
      key: 'doctrine-proposals', title: 'Doctrine / Architecture Proposals', empty: 'No doctrine or architecture proposals.',
      rows: [
        ...s.doctrineProposals.pending.map((c) => ({ id: c.drill, title: c.draft.title, detail: 'status PROPOSED (not recorded) · requires Commander approval', explanation: c.draft.summary, drill: c.drill, flags: ['protected: governance'] })),
        ...s.doctrineProposals.recorded.map((p) => ({ id: p.drill, title: p.proposal.title, detail: `status ${p.status} · requires Commander approval`, explanation: p.proposal.summary, drill: p.drill, flags: ['protected: governance'] })),
      ],
    },
  ]
  return {
    header: `${env.totals.active} active evidence events (${env.totals.backfilled} backfilled, ${env.totals.live} live, ${env.totals.superseded} superseded)`,
    banner: env.governance.note,
    sections,
  }
}

export function describeDrill(d: DrillResult) {
  const line = (i: DrillResult['supporting'][number]) =>
    `${i.event.occurredAt.slice(0, 10)} ${i.event.subject.id} ${i.event.taskClass} ${i.event.outcome}/${i.event.signal}` +
    `${i.event.validation !== 'UNKNOWN' ? ' validation ' + i.event.validation : ''} · source ${i.event.source.ref}${i.event.provenance?.backfilled ? ' (backfilled)' : ''}${i.superseded ? ` · SUPERSEDED: ${i.supersededReason}` : ''}`
  return { title: d.title, explanation: d.explanation, supporting: d.supporting.map(line), contradictory: d.contradictory.map(line), missing: d.missingEventIds, decisions: d.decisions.map((x) => `${x.status} by ${x.decidedBy}: ${x.reason}`), status: d.status }
}
