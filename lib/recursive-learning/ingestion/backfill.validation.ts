/** P9-K backfill validation. Run: pnpm run validate:recursive-learning-backfill */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harness, freshLog, missionFixture, tmpDir } from '../testkit'
import { backfillFoundryMissions } from './backfill'
import { LearningLog } from '../store'

const { check, finish } = harness('RECURSIVE_LEARNING_BACKFILL_VALIDATION')
const dir = path.join(tmpDir(), 'foundry-missions')
mkdirSync(dir, { recursive: true })
const put = (rec: Record<string, unknown>) => writeFileSync(path.join(dir, `${rec.missionId}.json`), JSON.stringify(rec))
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
put(missionFixture({ missionId: U(1) }))
put(missionFixture({ missionId: U(2), status: 'FAILED', errors: [{ klass: 'CODE' }], journal: [{ at: '2026-09-20T10:00:00.000Z', kind: 'decision', text: 'c' }, { at: '2026-09-20T10:10:00.000Z', kind: 'transition', text: 'BUILDING → FAILED: x' }] }))
put(missionFixture({ missionId: U(3), status: 'CANCELLED' }))
put(missionFixture({ missionId: U(4), classification: 'ACCEPTANCE_FIXTURE' }))
put(missionFixture({ missionId: U(5), installState: { ok: true }, authorization: { approvalState: 'approved', requestedAt: '2026-09-20T10:01:00.000Z', action: 'X' } }))
writeFileSync(path.join(dir, `${U(6)}.json`), '{not json')
writeFileSync(path.join(dir, `${U(1)}.journal.jsonl`), 'ignored')
writeFileSync(path.join(dir, 'notes.json'), '{}')
const audit = path.join(dir, '..', 'audit.jsonl')
writeFileSync(audit, '{"message":"engineer: deploy.rollback","metadata":{"restored":"v1"}}\n{"message":"other"}\n')
const hashDir = () => readdirSync(dir).sort().map((n) => createHash('sha256').update(readFileSync(path.join(dir, n))).digest('hex')).join()
process.env.WAR_ROOM_LEARNING_DIR = path.join(dir, '..', 'failures')

const log = freshLog()
const before = hashDir()
const dry = await backfillFoundryMissions({ missionsDir: dir, log, auditFile: audit })
check('K01_dry_run_default_writes_nothing', dry.dryRun && dry.eventsProposed > 0 && dry.inserted === 0 && log.view().events.length === 0)
check('K02_report_counts_skips_and_unreadable', dry.filesExamined === 6 && dry.skippedByReason['cancelled_not_outcome_evidence'] === 1 && dry.skippedByReason['classification_excluded:ACCEPTANCE_FIXTURE'] === 1 && dry.unreadable === 1 && dry.unattributableRollbackReceipts === 1, JSON.stringify(dry))
const run1 = await backfillFoundryMissions({ missionsDir: dir, log, dryRun: false })
const evs = log.view().events
check('K03_apply_inserts_with_backfill_provenance', run1.inserted === evs.length && evs.length > 0 && evs.every((e) => e.provenance?.backfilled === true && e.provenance.sourcePath?.startsWith('foundry-missions/') && !!e.recordedAt && !!e.occurredAt))
const bytes = readFileSync(log.file, 'utf8')
const run2 = await backfillFoundryMissions({ missionsDir: dir, log, dryRun: false })
check('K04_rerun_duplicates_nothing', run2.inserted === 0 && run2.duplicates === run1.inserted && readFileSync(log.file, 'utf8') === bytes && new LearningLog(path.dirname(log.file)).view().events.length === evs.length)
check('K05_source_evidence_never_modified', hashDir() === before)
const bounded = await backfillFoundryMissions({ missionsDir: dir, log: freshLog(), limit: 2, dryRun: false })
check('K06_bounded_by_limit', bounded.filesExamined === 2 && bounded.limitReached)
// stale supersession after an attribution correction
{
  const dir2 = path.join(tmpDir(), 'foundry-missions')
  mkdirSync(dir2, { recursive: true })
  const rec = missionFixture({ missionId: U(50), modelState: {}, pinnedModel: { provider: 'cursor-agent', modelId: 'g' }, actualWorker: { provider: 'ollama', model: 'q', source: 'CAPABILITY' } })
  writeFileSync(path.join(dir2, `${U(50)}.json`), JSON.stringify(rec))
  const l2 = freshLog()
  // simulate the old buggy attribution already in the log
  l2.recordEvents([{ id: 'old-wrong', subject: { kind: 'provider', id: 'cursor-agent' }, taskClass: 'code_modification', outcome: 'SUCCESS', occurredAt: '2026-09-20T10:30:00.000Z', source: { kind: 'foundry-mission', ref: `mission:${U(50)}` }, provenance: { adapter: 'foundry-mission', backfilled: true, sourcePath: `foundry-missions/${U(50)}.json` } }])
  const withoutFlag = await backfillFoundryMissions({ missionsDir: dir2, log: l2, dryRun: false })
  check('K09_stale_not_touched_without_flag', withoutFlag.staleSuperseded === 0 && l2.view().activeEvents.some((e) => e.id === 'old-wrong'))
  const fixed = await backfillFoundryMissions({ missionsDir: dir2, log: l2, dryRun: false, supersedeStale: true })
  const v = l2.view()
  check('K10_stale_superseded_not_deleted', fixed.staleSuperseded === 1 && v.events.some((e) => e.id === 'old-wrong') && !v.activeEvents.some((e) => e.id === 'old-wrong') && v.activeEvents.every((e) => e.subject.id.startsWith('ollama')))
  const again = await backfillFoundryMissions({ missionsDir: dir2, log: l2, dryRun: false, supersedeStale: true })
  check('K11_reconciliation_rerunnable', again.staleSuperseded === 0 && again.inserted === 0)
}
check('K07_rollback_receipts_not_converted_to_events', !evs.some((e) => e.outcome === 'ROLLED_BACK'))
check('K08_approval_signal_backfilled_install_folded', !evs.some((e) => e.signal === 'INSTALLED_OUTCOME') && evs.some((e) => e.signal === 'COMMANDER_APPROVAL'))
finish()
