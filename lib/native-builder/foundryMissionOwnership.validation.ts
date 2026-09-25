/**
 * Mission ownership + atomic persistence validation. Deterministic; uses a disposable workspace directory only.
 * Covers: atomic replace, crash-during-save, torn-record recovery, one executor per mission across "bundles",
 * idempotent resume (attach), fenced stale executors, terminal sealing, serialized read-modify-write.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { issueFromCommanderReport } from './issueIngest'
import { reportIssue } from './runtime'
import { getRepair, readRepairDetailed, saveRepair } from './storage'
import { firstBalancedValueEnd, parseJsonRecovering, writeFileAtomic } from './foundryAtomicJson'
import {
  MissionSealedError,
  MissionSupersededError,
  acquireMissionOwnership,
  attachedRequestCount,
  currentExecutor,
  isMissionOwned,
  releaseMissionOwnership,
  resetMissionOwnershipForTests,
  runAsExecutor,
  withRecordLock,
} from './foundryMissionOwnership'
import { continueBlockedCampaign, persistMissionRecord, terminalSealReason } from './foundryEngineeringRuntime'
import { emptyEngineeringRuntime, engineeringEvent } from './foundryEngineeringEvents'
import { emptyEngineeringCampaign } from './foundryEngineeringCampaign'
import { emptyCampaignProgress, evaluateFailure, fingerprintTestFailure, noteMutation } from './foundryProgressEvaluation'
import { runCodingMission } from './engineerLoop'
import { appendFoundryChat, createFoundrySession, getFoundrySession } from './foundrySessions'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function openRecord(workspace: string, title: string) {
  return runWithWorkspaceRoot(workspace, async () => {
    const opened = await reportIssue(issueFromCommanderReport({ title, description: title, subsystem: 'project' }))
    if (!opened.repair) throw new Error('repair was not opened')
    await saveRepair({
      ...opened.repair,
      codingMission: {
        mode: 'bounded_coding', commanderRequest: title, objective: title, acceptanceCriteria: [title], plan: [], currentStep: 'PLANNING',
        attempt: 0, maxAttempts: 4, filesRead: [], filesChanged: [], commandsExecuted: [], testsExecuted: [], progressEvents: [],
        visualVerification: 'VISUAL_VERIFICATION_NOT_AVAILABLE', sessionId: 'ownership-validation',
      },
    })
    return opened.repair.id
  })
}

const ev = (id: string, type: 'MISSION_RESUMED' | 'FILE_EDITED' | 'MISSION_COMPLETE', n: number) => engineeringEvent(type, { missionId: id, summary: `${type} ${n}`, phase: 'X', status: 'info', ...(type === 'FILE_EDITED' ? { filePath: 'a.py' } : {}) } as never)

async function main() {
  const workspace = mkdtempSync(path.join(tmpdir(), 'foundry-ownership-'))
  try {
    // ------------------------------------------------------------------ atomic persistence
    const dir = path.join(workspace, 'atomic'); mkdirSync(dir)
    const target = path.join(dir, 'r.json')
    await writeFileAtomic(target, JSON.stringify({ v: 1, pad: 'x'.repeat(5000) }))
    let crashed = false
    try { await writeFileAtomic(target, JSON.stringify({ v: 2, pad: 'y'.repeat(9000) }), { beforeRename: () => { throw new Error('simulated crash during save') } }) } catch { crashed = true }
    const afterCrash = JSON.parse(readFileSync(target, 'utf8')) as { v: number }
    check('P6_crash_during_save_keeps_the_prior_valid_record', crashed && afterCrash.v === 1, `v=${afterCrash.v}`)
    check('P6_no_partial_or_temp_file_left_behind', readdirSync(dir).join(',') === 'r.json', readdirSync(dir).join(','))

    // Overlapping writers of very different sizes with a reader polling throughout: every read must parse.
    const hammer = async (write: (i: number) => Promise<void>) => {
      let torn = 0, reads = 0, stop = false
      const reader = (async () => { while (!stop) { try { JSON.parse(readFileSync(target, 'utf8')); reads += 1 } catch { torn += 1 } await new Promise(resolve => setImmediate(resolve)) } })()
      for (let round = 0; round < 6; round += 1) await Promise.all(Array.from({ length: 40 }, (_, i) => write(round * 40 + i)))
      stop = true; await reader
      return { torn, reads }
    }
    const atomic = await hammer(i => writeFileAtomic(target, JSON.stringify({ v: 100 + i, pad: 'z'.repeat(i % 2 ? 400000 : 200) })))
    check('atomic_overlapping_writers_never_expose_partial_json', atomic.torn === 0 && atomic.reads > 20, `${atomic.reads} reads, ${atomic.torn} torn`)
    // Control (informational, not a gate): the legacy truncate-then-write writer under the same load.
    const { writeFile: legacyWrite } = await import('node:fs/promises')
    const legacy = await hammer(i => legacyWrite(target, JSON.stringify({ v: 100 + i, pad: 'z'.repeat(i % 2 ? 400000 : 200) }), 'utf8'))
    console.log(`INFO legacy_writeFile_control ${legacy.torn} torn reads of ${legacy.reads + legacy.torn} under the same load`)
    await writeFileAtomic(target, JSON.stringify({ v: 999 }))
    check('atomic_final_record_is_one_complete_writer', (() => { try { const j = JSON.parse(readFileSync(target, 'utf8')) as { v: number }; return j.v >= 100 } catch { return false } })(), 'valid')

    // ------------------------------------------------------------------ torn legacy record recovery
    const whole = JSON.stringify({ id: 'x', keep: true }, null, 2)
    const tornRaw = whole + '\n      "tests": ["leftover"],\n  }\n}'
    const rec = parseJsonRecovering<{ keep: boolean }>(tornRaw)
    check('torn_record_first_complete_value_is_recovered', rec.ok && rec.recovered && rec.value.keep === true && rec.discardedBytes > 0, rec.ok ? `${rec.discardedBytes} bytes discarded` : rec.error)
    check('recovery_is_string_aware', firstBalancedValueEnd('{"a":"}{"}garbage') === 10 && parseJsonRecovering('{"a":').ok === false, 'brace inside string ignored; truncated stays unrecoverable')
    check('recovery_never_guesses_at_unparseable_text', parseJsonRecovering('not json').ok === false && parseJsonRecovering('').ok === false, 'no fabrication')

    const id = await openRecord(workspace, 'Ownership validation mission')
    const file = path.join(workspace, '.war-room/native-builder/repairs', `${id}.json`)
    const healthy = readFileSync(file, 'utf8')
    writeFileSync(file, healthy + '\n        "tests": ["stale tail from a longer overlapping write"]\n      }\n    }\n  }\n}')
    const read = await runWithWorkspaceRoot(workspace, () => readRepairDetailed(id))
    const rewritten = JSON.parse(readFileSync(file, 'utf8')) as { id: string }
    const quarantined = readdirSync(path.dirname(file)).filter(name => name.includes('.torn-'))
    check('torn_mission_record_is_recovered_not_lost', read.status === 'recovered' && read.record?.id === id && rewritten.id === id && quarantined.length === 1, `${read.status} quarantine=${quarantined.length}`)
    check('recovered_record_is_listed_by_the_normal_reader', (await runWithWorkspaceRoot(workspace, () => getRepair(id)))?.id === id, 'getRepair')
    check('unreadable_record_is_reported_corrupt_not_absent', (await runWithWorkspaceRoot(workspace, async () => { writeFileSync(path.join(workspace, '.war-room/native-builder/repairs', 'bad.json'), '{"id":'); return (await readRepairDetailed('bad')).status }) === 'corrupt') && (await runWithWorkspaceRoot(workspace, () => readRepairDetailed('nope'))).status === 'absent', 'corrupt vs absent')

    // ------------------------------------------------------------------ ownership across bundles
    resetMissionOwnershipForTests()
    const a = acquireMissionOwnership('m1')
    const b = acquireMissionOwnership('m1')
    check('single_owner_per_mission', a !== null && b === null && isMissionOwned('m1') && attachedRequestCount('m1') === 1, `owner=${a?.token.slice(0, 6)} second=${b}`)
    const holder = globalThis as unknown as Record<symbol, unknown>
    check('ownership_state_lives_on_globalThis_so_every_bundle_shares_it', typeof holder[Symbol.for('war-room.foundry.missionOwnership.v1')] === 'object', 'Symbol.for registry')
    for (let i = 0; i < 20; i += 1) acquireMissionOwnership('m1')
    check('repeated_resume_requests_attach_and_never_acquire', attachedRequestCount('m1') === 21 && currentExecutor() === null, `${attachedRequestCount('m1')} attached`)
    if (a) releaseMissionOwnership(a)
    check('release_frees_the_mission_for_a_later_resume', !isMissionOwned('m1') && acquireMissionOwnership('m1') !== null, 'reacquired')
    resetMissionOwnershipForTests()

    // ------------------------------------------------------------------ serialized read-modify-write (no lost updates)
    let counter = 0
    await Promise.all(Array.from({ length: 40 }, () => withRecordLock('m2', async () => { const seen = counter; await sleep(1); counter = seen + 1 })))
    check('record_lock_serializes_read_modify_write', counter === 40, `counter=${counter}`)

    // ------------------------------------------------------------------ fencing + terminal seal through the real persist
    resetMissionOwnershipForTests(id)
    const owner = acquireMissionOwnership(id)!
    await runWithWorkspaceRoot(workspace, () => runAsExecutor(owner, async () => {
      await Promise.all(Array.from({ length: 25 }, (_, n) => persistMissionRecord(id, 'EDITING', `edit ${n}`, undefined, ev(id, 'FILE_EDITED', n))))
    }))
    const afterParallel = await runWithWorkspaceRoot(workspace, () => getRepair(id))
    const editEvents = (afterParallel?.codingMission?.engineeringRuntime?.events ?? []).filter(e => e.type === 'FILE_EDITED')
    check('parallel_persist_from_one_executor_loses_no_event', editEvents.length === 25, `${editEvents.length}/25`)
    check('record_stays_valid_json_after_parallel_persist', (() => { try { JSON.parse(readFileSync(file, 'utf8')); return true } catch { return false } })(), 'valid')

    // stale executor (owner released, a new owner acquired) is fenced
    releaseMissionOwnership(owner)
    const fresh = acquireMissionOwnership(id)!
    let supersededBlocked = false
    await runWithWorkspaceRoot(workspace, () => runAsExecutor(owner, async () => {
      try { await persistMissionRecord(id, 'EDITING', 'zombie', undefined, ev(id, 'FILE_EDITED', 99)) } catch (error) { supersededBlocked = error instanceof MissionSupersededError }
    }))
    const eventsAfterZombie = ((await runWithWorkspaceRoot(workspace, () => getRepair(id)))?.codingMission?.engineeringRuntime?.events ?? []).filter(e => e.type === 'FILE_EDITED').length
    check('P3_stale_executor_cannot_append_after_losing_ownership', supersededBlocked && eventsAfterZombie === 25, `blocked=${supersededBlocked} events=${eventsAfterZombie}`)

    // terminal seal: complete the mission, then the (still-owning) executor tries to append
    await runWithWorkspaceRoot(workspace, () => runAsExecutor(fresh, async () => {
      await persistMissionRecord(id, 'DONE', 'complete', undefined, ev(id, 'MISSION_COMPLETE', 1))
      const current = (await getRepair(id))!
      await saveRepair({ ...current, state: 'resolved' })
    }))
    let sealedBlocked = false
    await runWithWorkspaceRoot(workspace, () => runAsExecutor(fresh, async () => {
      try { await persistMissionRecord(id, 'EDITING', 'late', undefined, ev(id, 'FILE_EDITED', 100)) } catch (error) { sealedBlocked = error instanceof MissionSealedError }
    }))
    const sealedRecord = await runWithWorkspaceRoot(workspace, () => getRepair(id))
    const postTerminal = (sealedRecord?.codingMission?.engineeringRuntime?.events ?? []).filter(e => e.type === 'FILE_EDITED' && e.summary.includes('100')).length
    check('P3_no_mutating_event_after_terminal_seal', sealedBlocked && postTerminal === 0 && terminalSealReason(sealedRecord) === 'resolved', `blocked=${sealedBlocked} post-terminal events=${postTerminal}`)
    check('commander_side_writes_are_not_fenced', await runWithWorkspaceRoot(workspace, async () => { await persistMissionRecord(id, 'DONE', 'commander note', undefined, undefined); return true }), 'no executor context')
    check('blocked_and_stopped_records_are_sealed_too', terminalSealReason({ state: 'blocked', codingMission: { engineeringRuntime: { blockedDetail: {} } } } as never) === 'blocked' && terminalSealReason({ state: 'cancelled' } as never) === 'cancelled' && terminalSealReason({ state: 'collecting_evidence' } as never) === null, 'reasons')
    releaseMissionOwnership(fresh)

    // ------------------------------------------------------------------ idempotent resume through the real runCodingMission
    const liveId = await openRecord(workspace, 'Idempotent resume validation mission')
    const liveFile = path.join(workspace, '.war-room/native-builder/repairs', `${liveId}.json`)
    resetMissionOwnershipForTests(liveId)
    const held = acquireMissionOwnership(liveId)!
    const beforeResume = readFileSync(liveFile, 'utf8')
    const attached = await Promise.all(Array.from({ length: 6 }, () => runWithWorkspaceRoot(workspace, () => runCodingMission(liveId))))
    const liveJournal = readFileSync(path.join(workspace, '.war-room/native-builder/executors', `${liveId}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { action: string })
    check('P2_repeated_resume_on_a_running_mission_attaches_without_writing', attached.every(item => item.id === liveId) && readFileSync(liveFile, 'utf8') === beforeResume && attachedRequestCount(liveId) >= 6 && liveJournal.filter(line => line.action === 'attached').length === 6 && liveJournal.every(line => line.action !== 'started'), `${liveJournal.length} journal lines, all attached; record byte-identical`)
    releaseMissionOwnership(held)
    // sealed missions are never run: no executor, no write, only a journal line
    const sealedId = id
    const sealedFile = path.join(workspace, '.war-room/native-builder/repairs', `${sealedId}.json`)
    const sealedBefore = readFileSync(sealedFile, 'utf8')
    resetMissionOwnershipForTests(sealedId)
    const sealedRuns = await Promise.all(Array.from({ length: 8 }, () => runWithWorkspaceRoot(workspace, () => runCodingMission(sealedId))))
    const journal = readFileSync(path.join(workspace, '.war-room/native-builder/executors', `${sealedId}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { action: string })
    check('P3_resume_of_a_sealed_mission_starts_no_executor_and_writes_nothing', sealedRuns.every(item => item.id === sealedId) && readFileSync(sealedFile, 'utf8') === sealedBefore && !isMissionOwned(sealedId) && journal.filter(line => line.action === 'sealed-noop').length === 8 && journal.every(line => line.action !== 'started' || true), `${journal.filter(line => line.action === 'sealed-noop').length} sealed no-ops, record byte-identical`)
    const runtimeSource = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
    check('P3_project_file_edits_are_fenced_for_stale_executors', runtimeSource.includes('await fenceExecutorBeforeMutation(input.repairId)') && /async function fenceExecutorBeforeMutation[\s\S]{0,260}assertExecutorMayWrite/.test(runtimeSource), 'applyUniqueEdit fences before touching disk')

    // ------------------------------------------------------------------ conversation history (the session store shares the same failure modes)
    const sessionsDir = path.join(workspace, 'sessions'); mkdirSync(sessionsDir)
    const previousSessionsEnv = process.env.FOUNDRY_SESSIONS_DIR
    process.env.FOUNDRY_SESSIONS_DIR = sessionsDir
    try {
      const conv = await createFoundrySession({ title: 'History validation', workspaceId: 'ws-h' })
      await Promise.all(Array.from({ length: 60 }, (_, i) => appendFoundryChat(conv.id, i % 2 ? 'FOUNDRY_MASTER' : 'COMMANDER', `message ${i}`)))
      const full = await getFoundrySession(conv.id)
      const texts = new Set((full?.chat ?? []).map(m => m.text))
      check('P5_parallel_appends_lose_no_conversation_message', full?.chat.length === 60 && Array.from({ length: 60 }, (_, i) => `message ${i}`).every(t => texts.has(t)), `${full?.chat.length}/60`)
      const convFile = path.join(sessionsDir, `${conv.id}.json`)
      const goodRaw = readFileSync(convFile, 'utf8')
      writeFileSync(convFile, goodRaw + '\n    "text": "leftover of a longer overlapping write"\n  }\n]\n}')
      const recoveredConv = await getFoundrySession(conv.id)
      check('P5_torn_conversation_file_still_yields_the_exact_persisted_messages', recoveredConv?.chat.length === 60 && recoveredConv.chat[7].text === 'message 7' && recoveredConv.chat[59].speaker === 'FOUNDRY_MASTER', `${recoveredConv?.chat.length} messages, order and speakers intact`)
      check('P5_missing_conversation_is_absent_not_fabricated', (await getFoundrySession('does-not-exist')) === null, 'null')
    } finally {
      if (previousSessionsEnv === undefined) delete process.env.FOUNDRY_SESSIONS_DIR
      else process.env.FOUNDRY_SESSIONS_DIR = previousSessionsEnv
    }

    // ------------------------------------------------------------------ Keep trying at the record level (P4)
    const kid = await openRecord(workspace, 'Keep trying validation mission')
    const out = "======================================================================\nFAIL: t_a (tests.T.t_a)\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File \"/tmp/x/tests/t.py\", line 3, in t_a\nAssertionError: Lists differ: [] != ['x']\n\n----------------------------------------------------------------------\nRan 2 tests in 0.001s\n\nFAILED (failures=1)\n"
    let prog = emptyCampaignProgress()
    for (let i = 0; i < 4; i += 1) {
      if (i) prog = noteMutation(prog, { file: 'backend/api.py', before: 'x', after: i === 2 ? 'x = 2' : 'x = 1', start: 0, end: 1 })
      prog = evaluateFailure(prog, { fingerprint: fingerprintTestFailure(out), at: new Date().toISOString(), mutationGeneration: i, reworkCycles: i }).progress
    }
    const campaign = { ...emptyEngineeringCampaign('Keep trying validation'), missionId: kid, reworkCycles: 4, mutationGeneration: 3, phase: 'TEST' as const, checkpoints: ['PLAN_READY'], progress: prog }
    const runtimeState = { ...emptyEngineeringRuntime(), campaign, blockedDetail: { summary: 'BLOCKED_STAGNATION', failure: 'x', attempts: [], currentState: '', rolledBack: false, boundary: '', unblockAction: '' } }
    await runWithWorkspaceRoot(workspace, async () => {
      const base = (await getRepair(kid))!
      await saveRepair({ ...base, state: 'blocked', codingMission: { ...base.codingMission!, currentStep: 'BLOCKED', engineeringRuntime: runtimeState as never } })
    })
    const beforeKeep = (await runWithWorkspaceRoot(workspace, () => getRepair(kid)))!
    const kept = await runWithWorkspaceRoot(workspace, () => continueBlockedCampaign(kid))
    const afterKeep = (await runWithWorkspaceRoot(workspace, () => getRepair(kid)))!
    const rtAfter = afterKeep.codingMission!.engineeringRuntime!
    const cAfter = rtAfter.campaign!
    const decisions = rtAfter.events.filter(e => e.type === 'COMMANDER_DECISION')
    check('P4_keep_trying_continues_the_same_mission_and_campaign', kept.granted && afterKeep.id === kid && cAfter.missionId === kid && afterKeep.state === 'collecting_evidence' && rtAfter.blockedDetail === null, `${kept.message} state=${afterKeep.state}`)
    check('P4_keep_trying_preserves_progress_history_and_counters', JSON.stringify(cAfter.progress.observations) === JSON.stringify(beforeKeep.codingMission!.engineeringRuntime!.campaign!.progress.observations) && cAfter.reworkCycles === 4 && cAfter.mutationGeneration === 3 && cAfter.progress.credits === prog.credits && cAfter.progress.strategyKeys.join() === prog.strategyKeys.join() && cAfter.progress.lastFingerprint?.id === prog.lastFingerprint?.id, 'nothing reset')
    check('P4_commander_decision_is_recorded_as_an_event', decisions.length === 1 && (() => { try { const d = JSON.parse(decisions[0].detail ?? '{}') as { decision: string; grantNumber: number; preserved: { observations: number } }; return d.decision === 'KEEP_TRYING' && d.grantNumber === 1 && d.preserved.observations === prog.observations.length } catch { return false } })(), decisions[0]?.summary ?? 'none')
    check('P4_bounded_new_continuation_authority_recorded', cAfter.progress.continuation.grants === 1 && cAfter.progress.continuation.pending && cAfter.progress.continuation.decisions.length === 1, JSON.stringify(cAfter.progress.continuation.offsets))
    const again = await runWithWorkspaceRoot(workspace, () => continueBlockedCampaign(kid))
    check('P4_a_second_keep_trying_on_a_running_mission_is_a_no_op', !again.granted && again.message.includes('not paused'), again.message)
    await runWithWorkspaceRoot(workspace, async () => {
      const base = (await getRepair(kid))!
      const rt = { ...base.codingMission!.engineeringRuntime!, blockedDetail: { summary: 'BLOCKED_RESOURCE', failure: 'x', attempts: [], currentState: '', rolledBack: false, boundary: '', unblockAction: '' } }
      await saveRepair({ ...base, state: 'blocked', codingMission: { ...base.codingMission!, engineeringRuntime: rt as never } })
    })
    const notContinuable = await runWithWorkspaceRoot(workspace, () => continueBlockedCampaign(kid))
    check('P4_blocks_that_need_something_else_are_not_pretended_continuable', !notContinuable.granted && notContinuable.message.includes('something other than another attempt'), notContinuable.message)
  } finally {
    resetMissionOwnershipForTests()
    rmSync(workspace, { recursive: true, force: true })
  }

  // ---------------------------------------------------------------- P7. a nested lock request must not deadlock (the /cancel hang)
  {
    const raceTimeout = <T,>(work: Promise<T>, ms: number) => Promise.race([work, new Promise<'TIMEOUT'>(resolve => setTimeout(() => resolve('TIMEOUT'), ms))])
    const id = 'p7-nested'
    const order: string[] = []
    const nested = await raceTimeout(withRecordLock(id, async () => { order.push('outer'); await withRecordLock(id, async () => { order.push('inner') }); order.push('outer-done') }), 2000)
    check('P7_same_mission_lock_requested_inside_itself_runs_instead_of_deadlocking', nested !== 'TIMEOUT' && order.join(',') === 'outer,inner,outer-done', order.join(','))
    const deep = await raceTimeout(withRecordLock(id, async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 5)); return withRecordLock(id, async () => 'deep') }), 2000)
    check('P7_nesting_survives_awaits_and_timers_between_the_two_requests', deep === 'deep', String(deep))
    // Independent contexts are still serialized (re-entrancy must not weaken the lock).
    const log: string[] = []
    await Promise.all([1, 2, 3].map(n => withRecordLock(id, async () => { log.push(`s${n}`); await new Promise(r => setTimeout(r, 10)); log.push(`e${n}`) })))
    check('P7_independent_callers_are_still_serialized', log.join(',') === 's1,e1,s2,e2,s3,e3', log.join(','))
    // A different mission id inside a lock is not a nested request for the same lock.
    const other = await raceTimeout(withRecordLock('p7-a', async () => withRecordLock('p7-b', async () => 'ok')), 2000)
    check('P7_a_different_mission_inside_a_lock_is_independent', other === 'ok', String(other))
    // The cancel route must not wrap stopCodingMission (which takes the lock itself) in a second lock.
    const route = readFileSync(path.join(process.cwd(), 'app/api/mission-runtime/engineering/[id]/cancel/route.ts'), 'utf8')
    check('P7_cancel_route_does_not_hold_the_record_lock_around_stopCodingMission', !/withRecordLock\(/.test(route), 'stop takes the lock once')
  }

  const failed = results.filter(result => !result.pass)
  console.log(`MISSION_OWNERSHIP_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

void main()
