/**
 * Council ENGINE-04: long-horizon mission, checkpoint/resume, memory retrieval, temporal world-state.
 * Does not replace EBC, ATLAS, CouncilExecutive, or Engine-03.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ENGINE_01_VERSION,
  ENGINE_02_VERSION,
  ENGINE_03_VERSION,
  ENGINE_04_VERSION,
  ENGINE_04_CAPABILITY_MAP,
  compileContext,
  selectTool,
  diagnoseFailure,
  runLiveExecution,
  fingerprintAction,
  createLongHorizonMission,
  pauseMission,
  cancelMission,
  completeMission,
  recordCompletedWork,
  queueAuthorityWait,
  applyAuthorityDecision,
  commanderMissionStatus,
  parseEngine04Command,
  createCheckpoint,
  resumeMission,
  validateCheckpointForResume,
  retrieveMemories,
  evaluateTemporalMemory,
  createTemporalFact,
  supersedeFact,
  classifyTemporalPair,
  getCurrentState,
  getStateAt,
  refreshSignal,
  hashCheckpoint,
  verifyCheckpointIntegrity,
  saveLongHorizonMission,
  loadLongHorizonMission,
  loadLatestCheckpoint,
  bindEngine04ToLive,
} from '@/lib/council/engines'
import { DEFAULT_CHECKPOINT_RETENTION, shouldRetainCheckpoint } from '@/lib/council/engines/long-horizon/retention'
import {
  createSimulatedSessionState,
  historyHydrationRequest,
  sidebarPaneIdentitiesAgree,
  simulateSelectSession,
} from '@/lib/council/commander-chat/sessionSwitchHydration'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function atlasPair() {
  return {
    steps: [
      {
        step_id: 't-a',
        title: 'ORION inspect system health',
        purpose: 'health',
        depends_on: [],
        required_capabilities: ['system.health'],
        required_evidence: [] as string[],
        expected_output: 't-a',
        approval_required: false,
        status: 'PLANNED',
        parallel_group: null,
      },
      {
        step_id: 't-b',
        title: 'ORION inspect ports',
        purpose: 'ports',
        depends_on: ['t-a'],
        required_capabilities: ['wr.ports.list'],
        required_evidence: [] as string[],
        expected_output: 't-b',
        approval_required: false,
        status: 'PLANNED',
        parallel_group: null,
      },
    ],
    parallelizable_groups: [] as string[][],
  }
}

export async function runCouncilEngine04Validation(): Promise<CaseResult[]> {
  const store = mkdtempSync(path.join(tmpdir(), 'engine04-'))
  process.env.WAR_ROOM_ENGINE04_STORE = store
  const results: CaseResult[] = []

  results.push(check(
    'ENGINE04-MAP',
    ENGINE_04_CAPABILITY_MAP.length >= 20 && ENGINE_04_CAPABILITY_MAP.every(row => ['EXISTS', 'PARTIAL', 'MISSING', 'SHOULD_EXTRACT', 'SHOULD_EXTEND', 'DO_NOT_DUPLICATE'].includes(row.status)),
    `${ENGINE_04_CAPABILITY_MAP.length} rows`,
  ))

  const created = await createLongHorizonMission({ mission_id: 'm-lh-1', objective: 'inspect system health', conversation_id: 'conv-1', session_id: 'sess-1' })
  const wave1 = await runLiveExecution({
    mission_id: 'm-lh-1',
    objective: 'inspect system health',
    atlas_plan: { steps: atlasPair().steps.slice(0, 1), parallelizable_groups: [] },
    available_tools: ['system.health', 'wr.ports.list'],
    proof_level: 'UNIT',
  })
  const afterWave = recordCompletedWork(created.mission, {
    task_ids: wave1.tasks.filter(row => row.state === 'SUCCEEDED').map(row => row.task_id),
    dispatch_ids: wave1.dispatches.filter(row => row.ok).map(row => row.receipt_id),
    wave_ids: wave1.waves.map(row => row.wave_id),
    budget: { tool_calls_used: wave1.dispatches.length, retry_count: 0, wall_ms_used: 10, local_model_calls: 0, external_calls: 0 },
  })
  const paused = await pauseMission(afterWave)
  const ckPause = await createCheckpoint(paused, 'manual Commander pause')
  results.push(check('ENGINE04-01', ckPause.mission.mission_state === 'PAUSED' && ckPause.checkpoint.resume_eligible, `state=${ckPause.mission.mission_state}`))
  results.push(check('ENGINE04-06', ckPause.checkpoint.reason.includes('pause') && Boolean(ckPause.checkpoint.integrity_hash), ckPause.checkpoint.reason))

  const loaded = await loadLongHorizonMission('m-lh-1')
  results.push(check('ENGINE04-02', loaded?.mission_id === 'm-lh-1' && loaded.mission_state === 'PAUSED' && loaded.completed_task_ids.includes('t-a'), `state=${loaded?.mission_state} done=${loaded?.completed_task_ids.join(',')}`))

  const resumed = await resumeMission({ mission_id: 'm-lh-1' })
  results.push(check('ENGINE04-07', resumed.ok && resumed.skip_task_ids.includes('t-a') && !resumed.skip_task_ids.includes('t-b'), `skip=${resumed.skip_task_ids.join(',')}`))

  let tA = 0
  let tB = 0
  const wave2 = await runLiveExecution({
    mission_id: 'm-lh-1',
    objective: 'inspect system health',
    atlas_plan: atlasPair(),
    available_tools: ['system.health', 'wr.ports.list'],
    skip_task_ids: resumed.skip_task_ids,
    completed_dispatch_ids: resumed.completed_dispatch_ids,
    proof_level: 'UNIT',
    handlers: {
      'system.health': async () => {
        tA += 1
        return { ok: true, summary: 'health', claims: ['ok'], produces_evidence: true, kind: 'live_telemetry' }
      },
      'wr.ports.list': async () => {
        tB += 1
        return { ok: true, summary: 'ports', claims: ['ok'], produces_evidence: true, kind: 'live_telemetry' }
      },
    },
  })
  results.push(check('ENGINE04-03', tA === 0 && wave2.tasks.find(row => row.task_id === 't-a')?.state === 'SUCCEEDED', `tA=${tA} t-a=${wave2.tasks.find(row => row.task_id === 't-a')?.state}`))
  results.push(check('ENGINE04-28', wave2.receipts.some(row => row.engine === 'live-execution') && !wave2.receipts.some(row => row.engine === 'long-horizon-mission'), `engines=${[...new Set(wave2.receipts.map(row => row.engine))].join(',')}`))

  const integrity = verifyCheckpointIntegrity(ckPause.checkpoint)
  results.push(check('ENGINE04-04', integrity.ok, integrity.reason))
  const corrupt = { ...ckPause.checkpoint, integrity_hash: 'deadbeef' }
  results.push(check('ENGINE04-05', !verifyCheckpointIntegrity(corrupt).ok && validateCheckpointForResume({ checkpoint: corrupt, expected_mission_id: 'm-lh-1' }).ok === false, verifyCheckpointIntegrity(corrupt).reason))
  results.push(check('ENGINE04-14-HASH', hashCheckpoint(ckPause.checkpoint) === ckPause.checkpoint.integrity_hash, 'hash match'))

  const waitingMission = await createLongHorizonMission({ mission_id: 'm-auth', objective: 'commit production change' })
  const queued = queueAuthorityWait(waitingMission.mission, { task_id: 'commit', action: 'git.commit' })
  await saveLongHorizonMission(queued)
  const ckAuth = await createCheckpoint(queued, 'before WAITING_AUTHORITY')
  const afterRestart = await resumeMission({ mission_id: 'm-auth' })
  results.push(check('ENGINE04-08', afterRestart.ok && afterRestart.mission?.mission_state === 'WAITING_AUTHORITY' && afterRestart.reason.includes('WAITING_AUTHORITY'), afterRestart.reason))

  const fpA = fingerprintAction('git.commit', 'commit', 'payload-a')
  const fpB = fingerprintAction('git.commit', 'commit', 'payload-b')
  const mismatch = applyAuthorityDecision(queued, 'approve', fpB)
  const match = applyAuthorityDecision(queued, 'approve', queued.pending_approval_refs[0].action_fingerprint)
  results.push(check('ENGINE04-09', mismatch.failure_state === 'authority fingerprint mismatch' && match.authority_state === 'APPROVED' && fpA !== fpB, `fpA=${fpA} fpB=${fpB}`))

  const spent = await createLongHorizonMission({ mission_id: 'm-budget', objective: 'budget' })
  const spentRec = recordCompletedWork(spent.mission, { budget: { tool_calls_used: 4, retry_count: 1, wall_ms_used: 50, local_model_calls: 1, external_calls: 2 } })
  await saveLongHorizonMission(spentRec)
  const reloadedBudget = await loadLongHorizonMission('m-budget')
  results.push(check('ENGINE04-10', reloadedBudget?.budget_state.tool_calls_used === 4 && reloadedBudget.budget_state.tool_calls_max === 12, JSON.stringify(reloadedBudget?.budget_state)))

  const term = await completeMission((await createLongHorizonMission({ mission_id: 'm-term', objective: 'done' })).mission, 'COMPLETED', 'done')
  await createCheckpoint(term, 'mission completion')
  const termResume = await resumeMission({ mission_id: 'm-term' })
  results.push(check('ENGINE04-11', !termResume.ok && /completion|ineligible/.test(termResume.reason), termResume.reason))

  const mem = await retrieveMemories({
    mission_id: 'm-new',
    objective: 'system health ports 3847',
    entities: ['3847', 'health'],
    seed: [
      { content_summary: 'system health ports 3847 READY', source_mission_id: 'm-prior', memory_type: 'VERIFIED_FACT', truth_state: 'VERIFIED', observed_at: new Date().toISOString(), evidence_refs: ['e-1'] },
      { content_summary: 'unrelated cooking recipe', source_mission_id: 'm-other', memory_type: 'UNVERIFIED_HISTORY', truth_state: 'UNVERIFIED' },
    ],
  })
  const relevant = mem.result.hits.find(h => h.source_mission_id === 'm-prior')
  const noise = mem.result.hits.find(h => h.source_mission_id === 'm-other')
  results.push(check('ENGINE04-12', Boolean(relevant?.selected), `rel=${relevant?.relevance} sel=${relevant?.selected}`))
  results.push(check('ENGINE04-13', !noise?.selected && /contamination|threshold|unrelated/.test(noise?.reason_selected || ''), noise?.reason_selected ?? 'missing'))
  results.push(check('ENGINE04-14', Boolean(relevant?.source_evidence_refs.includes('e-1') && relevant.truth_state === 'VERIFIED'), `truth=${relevant?.truth_state} refs=${relevant?.source_evidence_refs.join(',')}`))

  const unverified = await retrieveMemories({
    mission_id: 'm-uv',
    objective: 'screenshot crash diagnosis',
    seed: [{ content_summary: 'screenshot crash speculative hypothesis', source_mission_id: 'm-old', speculative: true, truth_state: 'UNVERIFIED', memory_type: 'MISSION_EXPERIENCE' }],
  })
  const uv = unverified.result.hits.find(h => h.source_mission_id === 'm-old')
  results.push(check('ENGINE04-15', uv?.memory_type === 'UNVERIFIED_HISTORY' && uv.confidence_state === 'HYPOTHESIS' && uv.truth_state === 'UNVERIFIED', `${uv?.memory_type} ${uv?.confidence_state}`))
  results.push(check('ENGINE04-30', uv?.confidence_state !== 'PROVEN', uv?.confidence_state ?? 'none'))

  const staleEval = evaluateTemporalMemory({ observed_at: '2020-01-01T00:00:00.000Z', truth: 'VERIFIED' })
  results.push(check('ENGINE04-16', staleEval.state === 'STALE' && staleEval.refresh === 'REFRESH_REQUIRED', `${staleEval.state} ${staleEval.refresh}`))

  const noToolMem = selectTool({
    mission_id: 'm-notool',
    objective: 'current verified health',
    available_tools: ['research.web'],
    remaining_evidence_gap: ['need health'],
    current_verified_memory: true,
  })
  results.push(check('ENGINE04-17', noToolMem.decision === 'NO_TOOL_REQUIRED', `${noToolMem.decision} ${noToolMem.reason}`))

  const oldFact = createTemporalFact({ fact_id: 'f-a', statement: 'version 3', entity_ids: ['svc'], observed_at: '2026-01-01T00:00:00.000Z', valid_from: '2026-01-01T00:00:00.000Z', truth_state: 'VERIFIED', freshness_state: 'CURRENT' })
  const newFact = createTemporalFact({ fact_id: 'f-b', statement: 'version 4', entity_ids: ['svc'], observed_at: '2026-09-01T00:00:00.000Z', valid_from: '2026-09-01T00:00:00.000Z', truth_state: 'VERIFIED', freshness_state: 'CURRENT' })
  const pair = supersedeFact(oldFact, newFact)
  results.push(check('ENGINE04-18', pair.previous.statement === 'version 3' && pair.previous.freshness_state === 'SUPERSEDED', pair.previous.freshness_state))
  results.push(check('ENGINE04-19', pair.current.freshness_state === 'CURRENT' && pair.current.supersedes === 'f-a' && pair.previous.superseded_by === 'f-b', `sup=${pair.current.supersedes}`))
  const facts = [pair.previous, pair.current]
  results.push(check('ENGINE04-20', getStateAt(facts, 'svc', '2026-02-01T00:00:00.000Z')?.statement === 'version 3', getStateAt(facts, 'svc', '2026-02-01T00:00:00.000Z')?.statement ?? 'none'))
  results.push(check('ENGINE04-21', getCurrentState(facts, 'svc')?.statement === 'version 4', getCurrentState(facts, 'svc')?.statement ?? 'none'))
  results.push(check('ENGINE04-22', classifyTemporalPair(oldFact, newFact) === 'SUPERSESSION', classifyTemporalPair(oldFact, newFact)))
  const sameTime = createTemporalFact({ fact_id: 'f-c', statement: 'version 9', entity_ids: ['svc'], observed_at: '2026-09-01T00:00:00.000Z', valid_from: '2026-09-01T00:00:00.000Z', valid_to: '2026-10-01T00:00:00.000Z', truth_state: 'VERIFIED' })
  const clash = createTemporalFact({ fact_id: 'f-d', statement: 'version 8', entity_ids: ['svc'], observed_at: '2026-09-01T00:00:00.000Z', valid_from: '2026-09-01T00:00:00.000Z', valid_to: '2026-10-01T00:00:00.000Z', truth_state: 'VERIFIED' })
  results.push(check('ENGINE04-22b', classifyTemporalPair(sameTime, clash) === 'CONTRADICTION', classifyTemporalPair(sameTime, clash)))

  const unknown = evaluateTemporalMemory({ observed_at: null, truth: 'VERIFIED' })
  results.push(check('ENGINE04-23', unknown.state === 'TIME_UNKNOWN', unknown.state))
  const refresh = refreshSignal({ question: 'what is current version now', facts: [{ ...oldFact, freshness_state: 'STALE' }] })
  results.push(check('ENGINE04-24', refresh === 'REFRESH_REQUIRED', refresh))
  const staleTool = selectTool({
    mission_id: 'm-stale-tool',
    objective: 'current version',
    available_tools: ['research.web', 'system.health'],
    remaining_evidence_gap: ['need current version'],
    stale_freshness_gap: true,
  })
  results.push(check('ENGINE04-24b', staleTool.decision === 'SELECT' && staleTool.selected_tool === 'research.web', `${staleTool.decision} ${staleTool.selected_tool}`))

  const qMission = await createLongHorizonMission({ mission_id: 'm-q', objective: 'questions' })
  qMission.mission.question_graph = [{ question_id: 'q1', text: 'open?', answer_state: 'ANSWERED' }]
  qMission.mission.hypotheses = [{ id: 'H1', statement: 'maybe', status: 'OPEN' }]
  await saveLongHorizonMission(qMission.mission)
  await createCheckpoint(qMission.mission, 'end of execution wave')
  const qLoad = await loadLongHorizonMission('m-q')
  results.push(check('ENGINE04-25', qLoad?.question_graph[0]?.answer_state === 'ANSWERED', JSON.stringify(qLoad?.question_graph)))
  results.push(check('ENGINE04-26', qLoad?.hypotheses[0]?.status === 'OPEN' && qLoad.hypotheses[0].statement === 'maybe', JSON.stringify(qLoad?.hypotheses)))
  results.push(check('ENGINE04-27', created.mission.ebc_canonical === true && ckPause.mission.grants_authority === false, `ebc=${created.mission.ebc_canonical}`))

  const labeled = compileContext({
    mission_id: 'm-ctx',
    role: 'LUMEN',
    objective: 'now',
    task_objective: 'fact',
    memory_facts: [{ text: 'old version 3', evidence_ref: 'e-old', state: 'STALE', temporal_label: 'STALE', mission_id: 'm-ctx' }],
    verified_facts: [{ text: 'live health', evidence_ref: 'e-now', state: 'VERIFIED', temporal_label: 'CURRENT', mission_id: 'm-ctx' }],
  })
  results.push(check('ENGINE04-29', labeled.required_facts.some(f => f.temporal_label === 'CURRENT') && labeled.compiler_receipt.engine === 'context-compiler', labeled.required_facts.map(f => f.temporal_label).join(',')))

  const session = createSimulatedSessionState()
  simulateSelectSession(session, 'conv-hist', [{ messageType: 'assistant', content: 'prior research' }])
  const hydrate = historyHydrationRequest('conv-hist')
  results.push(check('ENGINE04-31', hydrate.startsMission === false && session.startedMission === false && sidebarPaneIdentitiesAgree({ sidebarSessionId: session.activeSessionId, paneOwnerId: session.transcriptOwnerId }), `started=${session.startedMission}`))

  const cancel = await cancelMission((await createLongHorizonMission({ mission_id: 'm-cancel', objective: 'x' })).mission)
  await createCheckpoint(cancel, 'cancel')
  const cancelResume = await resumeMission({ mission_id: 'm-cancel' })
  results.push(check('ENGINE04-32', cancel.mission_state === 'CANCELLED' && !cancelResume.ok, `${cancel.mission_state} ${cancelResume.reason}`))

  const declined = applyAuthorityDecision(queued, 'decline', queued.pending_approval_refs[0].action_fingerprint)
  results.push(check('ENGINE04-33', declined.authority_state === 'DECLINED' && declined.mission_state === 'PARTIALLY_COMPLETED', declined.mission_state))

  const ckWave = await createCheckpoint(recordCompletedWork((await createLongHorizonMission({ mission_id: 'm-wave', objective: 'w' })).mission, { task_ids: ['t-a'], dispatch_ids: ['d-1'], wave_ids: ['wave-1'] }), 'end of execution wave')
  results.push(check('ENGINE04-34', ckWave.checkpoint.mission.completed_dispatch_ids.includes('d-1') && ckWave.checkpoint.mission.execution_wave_refs.includes('wave-1'), ckWave.checkpoint.mission.completed_dispatch_ids.join(',')))

  const ckDir = path.join(store, 'checkpoints', 'm-lh-1')
  mkdirSync(ckDir, { recursive: true })
  writeFileSync(path.join(ckDir, 'ck-partial.json.tmp'), '{broken')
  const latest = await loadLatestCheckpoint('m-lh-1')
  results.push(check('ENGINE04-35', Boolean(latest?.integrity_hash) && verifyCheckpointIntegrity(latest!).ok, latest ? 'recovered prior checkpoint' : 'missing'))

  const dup = await runLiveExecution({
    mission_id: 'm-dup',
    objective: 'inspect system health',
    atlas_plan: atlasPair(),
    available_tools: ['system.health', 'wr.ports.list'],
    skip_task_ids: ['t-a', 't-b'],
    proof_level: 'UNIT',
    handlers: {
      'system.health': async () => { tA += 10; return { ok: true, summary: 'x', claims: [], produces_evidence: true, kind: 'live_telemetry' } },
      'wr.ports.list': async () => { tB += 10; return { ok: true, summary: 'x', claims: [], produces_evidence: true, kind: 'live_telemetry' } },
    },
  })
  results.push(check('ENGINE04-36', dup.dispatches.length === 0 && dup.tasks.every(row => row.state === 'SUCCEEDED'), `disp=${dup.dispatches.length}`))

  results.push(check('ENGINE04-37', parseEngine04Command('pause this mission') === 'pause' && commanderMissionStatus(queued).includes('Commander approval'), parseEngine04Command('Approve') ?? 'none'))
  results.push(check('ENGINE04-38', ENGINE_01_VERSION === 'council-engine-01.v1', ENGINE_01_VERSION))
  results.push(check('ENGINE04-39', ENGINE_02_VERSION === 'council-engine-02.v1', ENGINE_02_VERSION))
  results.push(check('ENGINE04-40', ENGINE_03_VERSION === 'council-engine-03.v1' && ENGINE_04_VERSION === 'council-engine-04.v1', `${ENGINE_03_VERSION} ${ENGINE_04_VERSION}`))

  const diag = diagnoseFailure({ mission_id: 'm-d', symptom: 'corrupt checkpoint integrity hash' })
  results.push(check('ENGINE04-DIAG', diag.diagnosis.category === 'CHECKPOINT_CORRUPT', diag.diagnosis.category))
  results.push(check('ENGINE04-RETENTION', shouldRetainCheckpoint('end of execution wave', DEFAULT_CHECKPOINT_RETENTION) === true, 'retain all'))

  const bind = await bindEngine04ToLive({
    mission_id: 'm-bind',
    objective: 'inspect health',
    commanderMessage: 'inspect health',
    conversation_id: 'conv-bind',
  })
  results.push(check('ENGINE04-BIND', bind.mission.mission_id === 'm-bind' && bind.mission.schema === 'long-horizon-mission.v1', bind.mission.mission_state))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runCouncilEngine04Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_ENGINE_04 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
