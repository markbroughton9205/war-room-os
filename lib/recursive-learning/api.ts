import type { LearningLog } from './store'
import { buildSnapshot, resolveDrill } from './readModel'

export const SECTIONS = ['summary', 'scores', 'workflows', 'events', 'failures', 'recommendations', 'memory-candidates', 'proposals', 'evidence'] as const
export type Section = (typeof SECTIONS)[number]

/** Pure, read-only handler behind GET /api/foundry/learning. Never writes to the log. */
export function handleLearningRead(url: URL, log: LearningLog, now: Date = new Date()): { status: number; body: unknown } {
  const section = (url.searchParams.get('section') ?? 'summary') as Section
  if (!SECTIONS.includes(section)) return { status: 400, body: { error: 'unknown section', sections: SECTIONS } }
  if (section === 'evidence') {
    const target = url.searchParams.get('target') ?? ''
    const drill = target ? resolveDrill(log, target, now) : null
    return drill ? { status: 200, body: { readOnly: true, drill } } : { status: 404, body: { error: 'no evidence for target', target } }
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)
  const snap = buildSnapshot(log, now, { eventLimit: limit })
  const pick: Record<Exclude<Section, 'evidence'>, unknown> = {
    summary: snap,
    scores: snap.scores,
    workflows: snap.workflows,
    events: snap.recentEvents,
    failures: snap.failures,
    recommendations: snap.recommendations,
    'memory-candidates': snap.memoryCandidates,
    proposals: snap.doctrineProposals,
  }
  return { status: 200, body: { readOnly: true, generatedAt: snap.generatedAt, totals: snap.totals, governance: snap.governance, data: pick[section] } }
}
