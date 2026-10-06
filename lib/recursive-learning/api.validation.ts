/** P9-L read-only API validation. Run: pnpm run validate:recursive-learning-api */
import { readFileSync } from 'node:fs'
import { harness, freshLog, ev, NOW } from './testkit'
import { handleLearningRead, SECTIONS } from './api'
import { LearningLog } from './store'
import { buildSnapshot } from './readModel'
import { submitProposal, buildDoctrineProposals, decideProposal } from './proposals'
import { detectRecurringFailures } from './analysis'
import { routingProposalDraft, recommendRouting } from './recommendations'

const { check, finish } = harness('RECURSIVE_LEARNING_API_VALIDATION')
const log = freshLog()
for (let i = 1; i <= 6; i++) {
  log.recordEvent(ev('claude', 'architecture_analysis', 'SUCCESS', i, { metrics: { latencyMs: 4000, costUsd: 0.4 } }), NOW)
  log.recordEvent(ev('gpt', 'architecture_analysis', i % 3 ? 'SUCCESS' : 'FAILURE', i, { metrics: { latencyMs: 900 } }), NOW)
  log.recordEvent(ev('wf-a', 'implementation_planning', 'SUCCESS', i, { subject: { kind: 'workflow', id: 'wf-a' } }), NOW)
}
for (let i = 1; i <= 5; i++) log.recordEvent(ev('gpt', 'risk_review', 'FAILURE', i, { errorClass: 'gate_skipped' }), NOW)
const active = log.view().activeEvents
const prop = submitProposal(log, routingProposalDraft(recommendRouting(active, 'architecture_analysis', NOW)), NOW)
const doc = submitProposal(log, buildDoctrineProposals(detectRecurringFailures(active, NOW))[0], NOW)
decideProposal(log, doc.id, 'REJECTED', 'commander:mark', 'not now', NOW)

const get = (q: string) => handleLearningRead(new URL(`http://x/api/foundry/learning?${q}`), new LearningLog(require_dir(), { readOnly: true }), NOW)
function require_dir() { return log.file.replace(/\/[^/]+$/, '') }
const before = readFileSync(log.file, 'utf8')

const summary = get('section=summary')
check('L01_all_sections_serve', SECTIONS.filter((s) => s !== 'evidence').every((s) => get(`section=${s}`).status === 200))
check('L02_unknown_section_400', get('section=bogus').status === 400)
const snap = buildSnapshot(log, NOW)
check('L03_scores_by_task_class_with_explanations', snap.scores.some((s) => s.card.taskClass === 'architecture_analysis') && snap.scores.every((s) => s.explanation.includes('score') && s.drill.startsWith('score:')) && snap.scores.every((s) => s.trend === 'UNKNOWN' || typeof s.trend === 'number'))
check('L04_workflow_rankings', snap.workflows.length === 1 && snap.workflows[0].ranking[0].card.subject.id === 'wf-a')
check('L05_recent_events_bounded', (get('section=events&limit=3').body as { data: unknown[] }).data.length === 3)
check('L06_failures_and_recommendations_present', snap.failures.length === 1 && snap.recommendations.length > 0 && snap.recommendations.every((r) => r.applied === false))
check('L07_candidates_pending_unrecorded_and_proposals_status', snap.memoryCandidates.pending.every((c) => c.state === 'PROPOSED_NOT_RECORDED') && snap.doctrineProposals.recorded.some((r) => r.status === 'REJECTED') && snap.memoryCandidates.recorded.length === 0)
const targets = [snap.scores[0].drill, snap.recommendations[0].drill, snap.failures[0].drill, snap.memoryCandidates.pending[0]?.drill, `proposal:${prop.id}`, `proposal:${doc.id}`].filter(Boolean) as string[]
const drills = targets.map((t) => get(`section=evidence&target=${encodeURIComponent(t)}`))
check('L08_every_displayed_item_drills_to_evidence', drills.every((d) => d.status === 200 && (d.body as { drill: { supporting: unknown[]; missingEventIds: unknown[] } }).drill.supporting.length > 0 && (d.body as { drill: { missingEventIds: unknown[] } }).drill.missingEventIds.length === 0), `${targets.length} targets`)
const rej = (drills[5].body as { drill: { status: string; decisions: { reason: string }[] } }).drill
check('L09_rejected_proposal_drill_shows_decision', rej.status === 'REJECTED' && rej.decisions[0].reason === 'not now')
check('L10_unknown_target_404', get('section=evidence&target=score:provider:nobody:summarization').status === 404 && get('section=evidence').status === 404)
check('L11_requests_do_not_modify_log', readFileSync(log.file, 'utf8') === before)
let writeBlocked = false
try { new LearningLog(require_dir(), { readOnly: true }).recordEvents([ev('x', 'risk_review', 'SUCCESS', 1)]) } catch { writeBlocked = true }
check('L12_read_only_log_refuses_writes', writeBlocked)
const route = readFileSync('app/api/foundry/learning/route.ts', 'utf8')
check('L13_route_is_get_only_and_commander_gated', /export async function GET/.test(route) && !/export (async )?(function|const) (POST|PUT|PATCH|DELETE)/.test(route) && route.includes('requireCommanderSession') && route.includes('readOnly: true') && !/writeFile|appendFile|rm\(|unlink/.test(route))
void summary
finish()
