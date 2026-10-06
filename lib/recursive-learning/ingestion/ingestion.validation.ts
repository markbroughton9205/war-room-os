/** P9-J ingestion validation. Run: pnpm run validate:recursive-learning-ingestion */
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { harness, freshLog, missionFixture, tmpDir, NOW } from '../testkit'
import { missionToEvents } from './missionAdapter'
import { commanderDecisionEvent, installedAcceptanceEvent, rollbackEvent, reviewFindingEvent, validationResultEvent } from './signalAdapters'
import { ingestMissionOutcomeSafe } from './live'
import { containsSecret, redactText } from './redact'
import { scoreSubject } from '../scoring'

const { check, finish } = harness('RECURSIVE_LEARNING_INGESTION_VALIDATION')
const opts = { backfilled: false }

// outcome mapping + UNKNOWN discipline
{
  const ok = missionToEvents(missionFixture(), opts)
  const run = ok.events.filter((e) => e.signal === 'RUN')
  check('J01_complete_mission_to_provider_and_model_events', run.length === 2 && run.every((e) => e.outcome === 'SUCCESS' && e.taskClass === 'code_modification') && run.map((e) => e.subject.kind).sort().join() === 'model,provider')
  check('J02_latency_from_clean_journal_retries_known_cost_tokens_absent', run[0].metrics?.latencyMs === 1_800_000 && run[0].metrics?.retries === 0 && run[0].metrics?.costUsd === undefined && run[0].metrics?.tokensIn === undefined)
  const paused = missionToEvents(missionFixture({ journal: [
    { at: '2026-09-20T10:00:00.000Z', kind: 'decision', text: 'c' },
    { at: '2026-09-20T10:05:00.000Z', kind: 'transition', text: 'EXECUTING → PAUSED: x' },
    { at: '2026-09-22T10:30:00.000Z', kind: 'transition', text: 'VERIFYING → COMPLETE: done' }] }), opts)
  check('J03_interrupted_mission_latency_unknown', paused.events[0].metrics?.latencyMs === undefined)
  const failed = missionToEvents(missionFixture({ status: 'FAILED', errors: [{ klass: 'CODE', message: 'sk-abcdefghijklmnopqrstuvwxyz' }], journal: [{ at: '2026-09-20T10:00:00.000Z', kind: 'decision', text: 'c' }, { at: '2026-09-20T10:10:00.000Z', kind: 'transition', text: 'BUILDING → FAILED: x' }] }), opts)
  check('J04_failed_mission_class_only_no_message_copied', failed.events[0].outcome === 'FAILURE' && failed.events[0].errorClass === 'CODE' && !JSON.stringify(failed.events).includes('sk-abc'))
  const skip = (over: Record<string, unknown>) => missionToEvents(missionFixture(over), opts).skipped
  check('J05_skips_cancelled_nonterminal_fixture_unattributed_unmapped',
    skip({ status: 'CANCELLED' }) === 'cancelled_not_outcome_evidence' && skip({ status: 'EXECUTING' }) === 'non_terminal' && skip({ classification: 'ACCEPTANCE_FIXTURE' })?.startsWith('classification_excluded') === true &&
    skip({ modelState: {}, pinnedModel: { provider: 'cursor-agent', modelId: 'm' } }) === 'no_provider_attribution' && skip({ kind: 'research' }) === 'no_task_class_mapping')
  const vf = missionToEvents(missionFixture({ testState: { ok: false }, buildState: { ok: true } }), opts).events[0]
  check('J06_failed_test_state_marks_validation_failed', vf.validation === 'FAILED')
  const unk = missionToEvents(missionFixture({ testState: { ok: null }, buildState: { ok: null } }), opts).events[0]
  check('J07_no_validation_data_is_unknown', unk.validation === 'UNKNOWN')
}

// attribution truth (review finding 1): pinned is a preference, actualWorker is execution
{
  const aw = missionToEvents(missionFixture({ modelState: {}, pinnedModel: { provider: 'cursor-agent', modelId: 'gpt' }, actualWorker: { provider: 'ollama', model: 'qwen', source: 'CAPABILITY' } }), opts).events.filter((e) => e.signal === 'RUN')
  check('J21_actual_worker_beats_pinned_model', aw.length === 2 && aw.every((e) => e.subject.id.startsWith('ollama')))
  const empty = missionToEvents(missionFixture({ modelState: { activeProvider: 'cursor-agent', activeModel: 'x' }, actualWorker: { provider: null, model: null, source: 'NONE' } }), opts)
  check('J22_empty_actual_worker_is_unattributed_not_guessed', empty.events.length === 0 && empty.skipped === 'no_provider_attribution')
  const long = missionToEvents(missionFixture({ journal: [{ at: '2026-09-20T00:00:00.000Z', kind: 'decision', text: 'c' }, { at: '2026-09-20T12:00:00.000Z', kind: 'transition', text: 'VERIFYING → COMPLETE: x' }] }), opts).events[0]
  check('J23_implausible_wall_clock_latency_is_unknown', long.metrics?.latencyMs === undefined)
  const inst = missionToEvents(missionFixture({ installState: { ok: true } }), opts).events
  check('J24_install_state_folds_into_run_no_extra_event', inst.length === 2 && inst.every((e) => e.signal === 'RUN'))
}

// log robustness (review findings 2, 3, 8)
{
  const log = freshLog()
  const evs = missionToEvents(missionFixture({ missionId: 'r-1' }), opts).events
  log.recordEvents(evs, NOW)
  appendFileSync(log.file, '{"t":"event","event":{"id":"torn')
  const v1 = log.view()
  check('J25_torn_line_skipped_and_counted_not_fatal', v1.corruptLines === 1 && v1.events.length === 2)
  const r = log.recordEvents(missionToEvents(missionFixture({ missionId: 'r-2' }), opts).events, NOW)
  const v2 = log.view()
  check('J26_append_after_torn_write_starts_new_line', r.inserted.length === 2 && v2.events.length === 4 && v2.corruptLines === 1)
  const dupLine = readFileSync(log.file, 'utf8').split('\n').find((l) => l.includes('"t":"event"') && l.includes(evs[0].id!))!
  appendFileSync(log.file, dupLine + '\n')
  const v3 = log.view()
  check('J27_duplicate_event_lines_ignored_in_view', v3.events.length === 4 && v3.duplicateEventLines === 1 && v3.activeEvents.length === 4)
  let futureRejected = false
  futureRejected = log.recordEvents([{ ...evs[0], id: 'fut', occurredAt: '2027-01-01T00:00:00.000Z' }], NOW).rejected.length === 1
  check('J28_future_dated_event_rejected', futureRejected)
}

// secrets
{
  check('J08_secret_detector', containsSecret('Bearer abcdefghijklmnopqrstuvwxyz0123') && containsSecret('api_key = abcdefgh12345678') && !containsSecret('mission:abc code_modification') && redactText('x sk-abcdefghijklmnopqrstuvwxyz y') === 'x [REDACTED] y')
  const leaky = missionToEvents(missionFixture({ modelState: { activeProvider: 'sk-abcdefghijklmnopqrstuvwxyz1234', activeModel: 'm' } }), opts)
  check('J09_secret_in_attribution_blocks_event', leaky.events.length === 0)
}

// signal adapters
{
  const c = { subject: { kind: 'provider' as const, id: 'p' }, taskClass: 'risk_review' as const, occurredAt: '2026-10-01T00:00:00.000Z', sourceKind: 'x', sourceRef: 'r1' }
  const corr = commanderDecisionEvent({ ...c, decision: 'correct' })
  const ovr = commanderDecisionEvent({ ...c, decision: 'override' })
  const rej = commanderDecisionEvent({ ...c, decision: 'reject' })
  const app = commanderDecisionEvent({ ...c, decision: 'approve' })
  check('J10_commander_decisions_map', corr.signal === 'COMMANDER_CORRECTION' && ovr.signal === 'COMMANDER_CORRECTION' && rej.outcome === 'REJECTED' && app.outcome === 'SUCCESS' && corr.id !== ovr.id)
  check('J11_rollback_install_validation_review_events', rollbackEvent(c).outcome === 'ROLLED_BACK' && installedAcceptanceEvent({ ...c, pass: false }).validation === 'FAILED' && validationResultEvent({ ...c, pass: true, validationId: 'tsc' }).validation === 'PASSED' && reviewFindingEvent({ ...c, reviewer: 'independent', status: 'FAIL' }).signal === 'REVIEWER_FINDING')
  const log = freshLog()
  const bad = validationResultEvent({ ...c, pass: false, validationId: 'tsc' })
  const stored = log.recordEvents([{ ...bad, outcome: 'SUCCESS' }], NOW).inserted[0]
  check('J12_failed_validation_cannot_be_success_through_adapter', stored.outcome === 'FAILURE')
}

// idempotency + store
{
  const log = freshLog()
  const inputs = [...missionToEvents(missionFixture({ missionId: 'm-1' }), opts).events, ...missionToEvents(missionFixture({ missionId: 'm-2', status: 'FAILED', journal: [{ at: '2026-09-20T10:00:00.000Z', kind: 'decision', text: 'c' }, { at: '2026-09-20T10:10:00.000Z', kind: 'transition', text: 'BUILDING → FAILED: x' }] }), opts).events]
  const a = log.recordEvents(inputs, NOW)
  const b = log.recordEvents(inputs, NOW)
  check('J13_reingestion_is_idempotent', a.inserted.length === 4 && b.inserted.length === 0 && b.duplicates === 4 && log.view().events.length === 4)
  const bytes = readFileSync(log.file, 'utf8')
  log.recordEvents(inputs, NOW)
  check('J14_append_oriented_no_rewrite_on_duplicates', readFileSync(log.file, 'utf8') === bytes)
  const mixed = log.recordEvents([{ ...inputs[0], id: 'zzz', taskClass: 'nope' as never }, { ...inputs[0], id: 'ok-new' }], NOW)
  check('J15_bad_event_rejected_without_aborting_batch', mixed.rejected.length === 1 && mixed.inserted.length === 1)
  check('J16_provenance_preserved', log.view().events[0].provenance?.adapter === 'foundry-mission' && log.view().events[0].provenance?.backfilled === false && log.view().events[0].source.ref === 'mission:m-1')
}

// failure-safety: live hook never throws, records honestly, no fake event
{
  const dir = tmpDir()
  process.env.WAR_ROOM_LEARNING_DIR = dir
  let threw = false
  try { ingestMissionOutcomeSafe(null); ingestMissionOutcomeSafe({ missionId: 'x' }) } catch { threw = true }
  const leaky = missionFixture({ missionId: 'm-leak', modelState: { activeProvider: 'sk-abcdefghijklmnopqrstuvwxyz1234', activeModel: 'm' } })
  ingestMissionOutcomeSafe(leaky)
  const f = path.join(dir, 'ingestion-failures.jsonl')
  check('J17_live_hook_failure_safe_and_honest', !threw && existsSync(f) && readFileSync(f, 'utf8').includes('secret_detected') && !readFileSync(f, 'utf8').includes('sk-abc') && !existsSync(path.join(dir, 'recursive-learning.jsonl')))
  ingestMissionOutcomeSafe(missionFixture({ missionId: 'm-live' }))
  ingestMissionOutcomeSafe(missionFixture({ missionId: 'm-live' }))
  const lines = readFileSync(path.join(dir, 'recursive-learning.jsonl'), 'utf8').trim().split('\n')
  check('J18_live_hook_ingests_once', lines.length === 2)
  process.env.WAR_ROOM_LEARNING_INGEST = 'off'
  ingestMissionOutcomeSafe(missionFixture({ missionId: 'm-off' }))
  check('J19_ingest_can_be_disabled', readFileSync(path.join(dir, 'recursive-learning.jsonl'), 'utf8').trim().split('\n').length === 2)
}

// scoring consumes ingested events end to end
{
  const log = freshLog()
  const evs: ReturnType<typeof missionToEvents>['events'] = []
  for (let i = 0; i < 4; i++) evs.push(...missionToEvents(missionFixture({ missionId: `ok-${i}`, modelState: { activeProvider: 'ollama', activeModel: 'qwen' } }), opts).events)
  log.recordEvents(evs, NOW)
  const card = scoreSubject(log.view().activeEvents, { kind: 'provider', id: 'ollama' }, 'code_modification', new Date('2026-09-21T00:00:00Z'))
  check('J20_ingested_events_score', typeof card.score === 'number' && card.rawSamples === 4 && card.costUsd === 'UNKNOWN')
}
finish()
