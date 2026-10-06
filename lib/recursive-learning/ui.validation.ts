/** P9-M UI/state validation. Run: pnpm run validate:recursive-learning-ui */
import { readFileSync } from 'node:fs'
import { harness, freshLog, ev, NOW } from './testkit'
import { buildSnapshot, resolveDrill } from './readModel'
import { buildLearningViewModel, describeDrill, type ApiEnvelope } from './uiState'
import { submitProposal, buildDoctrineProposals } from './proposals'
import { detectRecurringFailures } from './analysis'

const { check, finish } = harness('RECURSIVE_LEARNING_UI_VALIDATION')
const log = freshLog()
for (let i = 1; i <= 6; i++) {
  log.recordEvent(ev('claude', 'architecture_analysis', 'SUCCESS', i), NOW)
  log.recordEvent(ev('gpt', 'architecture_analysis', i % 2 ? 'SUCCESS' : 'FAILURE', i), NOW)
  log.recordEvent(ev('wf-a', 'implementation_planning', 'SUCCESS', i, { subject: { kind: 'workflow', id: 'wf-a' }, metrics: { latencyMs: 500 } }), NOW)
}
for (let i = 1; i <= 5; i++) log.recordEvent(ev('gpt', 'risk_review', 'FAILURE', i, { errorClass: 'gate_skipped' }), NOW)
const active = log.view().activeEvents
submitProposal(log, buildDoctrineProposals(detectRecurringFailures(active, NOW))[0], NOW)
const snap = buildSnapshot(log, NOW)
const env: ApiEnvelope = { readOnly: true, generatedAt: NOW.toISOString(), totals: snap.totals, governance: snap.governance, data: snap }
const vm = buildLearningViewModel(env)
const sec = (k: string) => vm.sections.find((s) => s.key === k)!

check('M01_six_required_sections', vm.sections.map((s) => s.key).join() === 'provider-performance,workflow-performance,recurring-failures,routing-recommendations,memory-candidates,doctrine-proposals')
const pp = sec('provider-performance').rows
check('M02_provider_rows_show_task_class_confidence_evidence_trend', pp.length > 0 && pp.every((r) => r.detail.includes('confidence') && r.detail.includes('evidence') && r.detail.includes('trend') || r.detail.includes('steady') || r.detail.includes('up ') || r.detail.includes('down ')) && pp.every((r) => r.title.includes('·')))
check('M03_no_opaque_score_every_row_explained_and_drillable', vm.sections.flatMap((s) => s.rows).every((r) => r.explanation.length > 20 && r.drill.includes(':')))
check('M04_workflows_rank_with_latency_cost_rollbacks', sec('workflow-performance').rows[0]?.detail.includes('latency 500') && sec('workflow-performance').rows[0].detail.includes('cost UNKNOWN') && sec('workflow-performance').rows[0].detail.includes('rollbacks'))
check('M05_failures_show_signature_count_mitigation', sec('recurring-failures').rows[0].title.includes('gate_skipped') && sec('recurring-failures').rows[0].detail.includes('5 failures') && sec('recurring-failures').rows[0].explanation.includes('mitigation'))
check('M06_recommendations_confidence_alternatives_caveats', sec('routing-recommendations').rows.every((r) => r.detail.includes('alternatives') || r.detail === 'no candidates') && sec('routing-recommendations').rows.some((r) => r.explanation.includes('applied=false')))
check('M07_memory_candidates_never_auto_promoted', sec('memory-candidates').rows.length > 0 && sec('memory-candidates').rows.every((r) => !/PROMOTED/.test(r.detail) && (r.detail.includes('never auto-promoted') || r.detail.includes('requires Commander approval'))))
check('M08_doctrine_requires_commander_approval', sec('doctrine-proposals').rows.length === 2 && sec('doctrine-proposals').rows.every((r) => r.detail.includes('requires Commander approval') && r.flags.includes('protected: governance')))
check('M09_empty_state_honest', buildLearningViewModel({ ...env, data: buildSnapshot(freshLog(), NOW) }).sections.every((s) => s.rows.length === 0 && s.empty.length > 10))
const d = resolveDrill(log, sec('provider-performance').rows[0].drill, NOW)!
const dd = describeDrill(d)
check('M10_drill_lists_source_events_with_provenance', dd.supporting.length > 0 && dd.supporting.every((l) => l.includes('source fixture-')) && dd.missing.length === 0)
const gpt = resolveDrill(log, 'score:provider:gpt:architecture_analysis', NOW)!
check('M11_drill_shows_contradicting_evidence', describeDrill(gpt).contradictory.length > 0)
const src = readFileSync('components/war-room/foundry/FoundryLearningPanel.tsx', 'utf8')
const fetches = [...src.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[0])
check('M12_panel_only_issues_gets', fetches.length === 2 && fetches.every((f) => !/method\s*:/.test(f)) && !/<form|onSubmit|method="post"/i.test(src) && !/approve|promote|apply/i.test(src.replace(/never auto-promoted/g, '')))
check('M13_panel_has_loading_and_error_states', src.includes('learning-loading') && src.includes('learning-error'))
finish()
