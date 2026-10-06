/** P9-O realistic acceptance scenarios, driven through adapter -> log -> read model. Run: pnpm run validate:recursive-learning-integration */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harness, freshLog, missionFixture, tmpDir, NOW } from './testkit'
import { missionToEvents } from './ingestion/missionAdapter'
import { rollbackEvent, commanderDecisionEvent } from './ingestion/signalAdapters'
import { backfillFoundryMissions } from './ingestion/backfill'
import { LearningLog } from './store'
import { scoreSubject } from './scoring'
import { recommendRouting, routingProposalDraft } from './recommendations'
import { detectRecurringFailures } from './analysis'
import { buildDoctrineProposals, buildMemoryCandidates, submitProposal } from './proposals'
import { buildSnapshot, resolveDrill } from './readModel'
import type { EvaluationEventInput } from './types'

const { check, finish } = harness('RECURSIVE_LEARNING_INTEGRATION_VALIDATION')
const DAY = 86_400_000
let n = 0
/** Terminal mission finishing `ageDays` before NOW, attributed to a worker, optionally with cost/validation overrides. */
function mission(worker: string, ok: boolean, ageDays: number, over: Record<string, unknown> = {}) {
  const end = new Date(NOW.getTime() - ageDays * DAY)
  const start = new Date(end.getTime() - 10 * 60_000)
  return missionFixture({
    missionId: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`,
    status: ok ? 'COMPLETE' : 'FAILED', errors: ok ? [] : [{ klass: 'CODE' }],
    modelState: { activeProvider: worker, activeModel: 'ts-worker' },
    createdAt: start.toISOString(), updatedAt: end.toISOString(),
    journal: [{ at: start.toISOString(), kind: 'decision', text: 'c' }, { at: end.toISOString(), kind: 'transition', text: `VERIFYING → ${ok ? 'COMPLETE' : 'FAILED'}: x` }],
    ...over,
  })
}
const ingest = (log: LearningLog, ms: Record<string, unknown>[]) => log.recordEvents(ms.flatMap((m) => missionToEvents(m, { backfilled: false }).events), NOW)
const active = (log: LearningLog) => log.view().activeEvents
const P = (id: string) => ({ kind: 'provider' as const, id })
const sc = (log: LearningLog, id: string) => scoreSubject(active(log), P(id), 'code_modification', NOW)

// 1 worker A beats B over repeated missions
{
  const log = freshLog()
  ingest(log, [...Array.from({ length: 8 }, (_, i) => mission('worker-a', true, i + 1)), ...Array.from({ length: 8 }, (_, i) => mission('worker-b', i % 2 === 0, i + 1))])
  const rec = recommendRouting(active(log), 'code_modification', NOW)
  check('O01_ts_worker_a_beats_b', rec.recommended?.id === 'worker-a' && (sc(log, 'worker-a').score as number) > (sc(log, 'worker-b').score as number) + 0.15)
}
// 2 A later degrades; decay + recent failures move ranking
{
  const log = freshLog()
  ingest(log, [...Array.from({ length: 10 }, (_, i) => mission('worker-a', true, 100 + i)), ...Array.from({ length: 5 }, (_, i) => mission('worker-a', false, i + 1)), ...Array.from({ length: 6 }, (_, i) => mission('worker-b', true, i + 1))])
  const a = sc(log, 'worker-a')
  check('O02_degraded_worker_decays_and_loses_rank', (a.score as number) < 0.45 && recommendRouting(active(log), 'code_modification', NOW).recommended?.id === 'worker-b', `a=${(a.score as number).toFixed(2)}`)
}
// 3 rollback lowers relevant score
{
  const log = freshLog()
  ingest(log, Array.from({ length: 6 }, (_, i) => mission('worker-a', true, i + 1)))
  const before = sc(log, 'worker-a').score as number
  log.recordEvents([rollbackEvent({ subject: P('worker-a'), taskClass: 'code_modification', occurredAt: new Date(NOW.getTime() - DAY / 2).toISOString(), sourceKind: 'rollback-receipt', sourceRef: 'rb-1' })], NOW)
  const after = sc(log, 'worker-a')
  check('O03_rollback_lowers_score', (after.score as number) < before - 0.08 && after.rollbackCount === 1)
}
// 4 commander correction changes evaluation
{
  const log = freshLog()
  ingest(log, Array.from({ length: 6 }, (_, i) => mission('worker-a', true, i + 1)))
  const before = sc(log, 'worker-a').score as number
  log.recordEvents([1, 2, 3].map((k) => commanderDecisionEvent({ subject: P('worker-a'), taskClass: 'code_modification', occurredAt: new Date(NOW.getTime() - k * 3600_000).toISOString(), sourceKind: 'commander', sourceRef: `corr-${k}`, decision: 'correct' })), NOW)
  check('O04_commander_correction_changes_evaluation', (sc(log, 'worker-a').score as number) < before - 0.08)
}
// 5 unknown cost stays UNKNOWN, never free
{
  const log = freshLog()
  ingest(log, [...Array.from({ length: 6 }, (_, i) => mission('worker-a', true, i + 1)), ...Array.from({ length: 6 }, (_, i) => mission('worker-b', true, i + 1))])
  const rec = recommendRouting(active(log), 'code_modification', NOW, { weights: { cost: 0.5 } })
  check('O05_unknown_cost_remains_unknown', sc(log, 'worker-a').costUsd === 'UNKNOWN' && rec.ranking.every((r) => r.unknownMetrics.includes('cost')))
}
// 6/7 cost vs quality (cost is supplied by explicit typed events: the mission records carry none)
const priced = (provider: string, ok: boolean, age: number, cost: number): EvaluationEventInput => ({ id: `pr-${provider}-${age}-${ok}-${cost}`, subject: P(provider), taskClass: 'code_modification', outcome: ok ? 'SUCCESS' : 'FAILURE', occurredAt: new Date(NOW.getTime() - age * DAY).toISOString(), metrics: { costUsd: cost, latencyMs: 1000 }, source: { kind: 'billing-receipt', ref: `bill-${provider}-${age}` } })
{
  const log = freshLog()
  log.recordEvents([...Array.from({ length: 10 }, (_, i) => priced('premium', true, i + 1, 0.5)), ...Array.from({ length: 10 }, (_, i) => priced('budget', i !== 9, i + 1, 0.05))], NOW)
  const r = recommendRouting(active(log), 'code_modification', NOW, { weights: { cost: 0.3 } })
  const q = recommendRouting(active(log), 'code_modification', NOW)
  check('O06_expensive_loses_when_quality_difference_negligible', r.recommended?.id === 'budget' && q.recommended?.id === 'premium', `cost-aware=${r.recommended?.id} quality-only=${q.recommended?.id}`)
}
{
  const log = freshLog()
  log.recordEvents([...Array.from({ length: 10 }, (_, i) => priced('premium', true, i + 1, 0.5)), ...Array.from({ length: 10 }, (_, i) => priced('budget', i < 4, i + 1, 0.05))], NOW)
  const r = recommendRouting(active(log), 'code_modification', NOW, { weights: { cost: 0.3 } })
  check('O07_expensive_wins_when_materially_better', r.recommended?.id === 'premium')
}
// 8 + 9 recurring failure -> mitigation proposal; contradicting successes surfaced and lower confidence
{
  const log = freshLog()
  ingest(log, [...Array.from({ length: 4 }, (_, i) => mission('worker-a', false, i + 1)), ...Array.from({ length: 3 }, (_, i) => mission('worker-a', true, i + 1))])
  const f = detectRecurringFailures(active(log), NOW, { minCount: 3 })
  const doc = buildDoctrineProposals(f, 4)
  const mem = buildMemoryCandidates(f, [], NOW)
  const stored = submitProposal(log, doc[0], NOW)
  check('O08_recurring_failure_yields_mitigation_proposal', f.length >= 1 && f[0].report.recommendedMitigation.length > 10 && stored.summary.includes('mitigation') && stored.applied === false)
  const pure = freshLog()
  ingest(pure, Array.from({ length: 7 }, (_, i) => mission('worker-a', false, i + 1)))
  check('O09_contradicting_successes_lower_confidence_and_are_listed', f[0].contradictingSuccessIds.length === 3 && mem[0].contradictoryEventIds.length === 3 && sc(log, 'worker-a').confidence < sc(pure, 'worker-a').confidence, `mixed=${sc(log, 'worker-a').confidence.toFixed(2)} pure=${sc(pure, 'worker-a').confidence.toFixed(2)}`)
}
// 10 duplicate backfill
{
  const dir = path.join(tmpDir(), 'foundry-missions')
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 5; i++) { const m = mission('worker-a', i % 2 === 0, i + 1); writeFileSync(path.join(dir, `${m.missionId}.json`), JSON.stringify(m)) }
  process.env.WAR_ROOM_LEARNING_DIR = path.join(dir, '..', 'fail')
  const log = freshLog()
  const a = await backfillFoundryMissions({ missionsDir: dir, log, dryRun: false })
  const b = await backfillFoundryMissions({ missionsDir: dir, log, dryRun: false })
  check('O10_duplicate_backfill_adds_nothing', a.inserted > 0 && b.inserted === 0 && b.duplicates === a.inserted && log.view().events.length === a.inserted)
}
// 11 restart reproduces identical evaluation state; 12 drill resolves everything
{
  const log = freshLog()
  ingest(log, [...Array.from({ length: 5 }, (_, i) => mission('worker-a', true, i + 1)), ...Array.from({ length: 5 }, (_, i) => mission('worker-b', i % 2 === 0, i + 1)), ...Array.from({ length: 4 }, (_, i) => mission('worker-b', false, i + 1))])
  const snap1 = JSON.stringify(buildSnapshot(log, NOW))
  const snap2 = JSON.stringify(buildSnapshot(new LearningLog(path.dirname(log.file)), NOW))
  check('O11_restart_reproduces_identical_state', snap1 === snap2 && snap1.length > 1000)
  const snap = buildSnapshot(log, NOW)
  const targets = [...snap.scores.map((s) => s.drill), ...snap.recommendations.map((r) => r.drill), ...snap.failures.map((f) => f.drill), ...snap.memoryCandidates.pending.map((c) => c.drill), ...snap.doctrineProposals.pending.map((c) => c.drill)]
  const drills = targets.map((t) => resolveDrill(log, t, NOW))
  const exact = snap.scores.every((s, i) => { const d = drills[i]!; const ids = new Set(d.supporting.map((x) => x.event.id)); return s.card.evidenceEventIds.every((id) => ids.has(id)) })
  check('O12_drill_resolves_all_contributing_events', drills.every((d) => d !== null && d.missingEventIds.length === 0 && d.supporting.length > 0) && exact, `${targets.length} targets`)
}
// 13 failed validation cannot be success
{
  const log = freshLog()
  ingest(log, [mission('worker-a', true, 1, { testState: { ok: false }, buildState: { ok: true } })])
  const evs = log.view().events.filter((e) => e.signal === 'RUN')
  check('O13_failed_validation_never_recorded_as_success', evs.length === 2 && evs.every((e) => e.outcome === 'FAILURE' && e.validation === 'FAILED' && e.reportedOutcome === 'SUCCESS'))
}
// 14 no recommendation modifies hard policy
{
  const files = ['docs/war-room-constitution.md', 'CLAUDE.md', 'lib/native-builder/foundryWorkerRouting.ts', 'lib/model-router/registry.ts', 'lib/security/commanderSession.ts'].filter(existsSync)
  const h = () => files.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex')).join()
  const before = h()
  const log = freshLog()
  ingest(log, [...Array.from({ length: 8 }, (_, i) => mission('worker-a', true, i + 1)), ...Array.from({ length: 8 }, (_, i) => mission('worker-b', false, i + 1))])
  const rec = recommendRouting(active(log), 'code_modification', NOW)
  const p = submitProposal(log, routingProposalDraft(rec), NOW)
  check('O14_no_recommendation_modifies_hard_policy', h() === before && files.length >= 4 && p.applied === false && rec.applied === false)
}
finish()
