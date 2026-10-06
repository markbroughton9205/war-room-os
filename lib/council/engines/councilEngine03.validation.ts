/**
 * Council ENGINE-03: live execution, dispatch, parallel waves, governor.
 * Consumes ENGINE-02 decisions. Does not replace EBC, ATLAS, or CouncilExecutive.
 */
import { pathToFileURL } from 'node:url'
import {
  ENGINE_01_VERSION,
  ENGINE_02_VERSION,
  ENGINE_03_CAPABILITY_MAP,
  ENGINE_03_VERSION,
  attachCouncilEngine03Public,
  attachCouncilEnginePublic,
  classifyAuthorityGate,
  compileContext,
  dispatchCapability,
  maybeUpgradeAuthority,
  runLiveExecution,
  selectTool,
} from '@/lib/council/engines'
import { runCouncilEngine02Validation } from '@/lib/council/engines/councilEngine02.validation'
import { createEvidenceBoard, boardSnapshot } from '@/lib/council/evidence-board/board'
import { synthesizeAurora } from '@/lib/council/evidence-board/verify'
import {
  createSimulatedSessionState,
  historyHydrationRequest,
  sidebarPaneIdentitiesAgree,
  simulateSelectSession,
} from '@/lib/council/commander-chat/sessionSwitchHydration'
import { concurrencyPolicy as liveConcurrencyPolicy } from '@/lib/council/intelligence/adaptiveIntelligence'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function atlasStep(
  id: string,
  title: string,
  caps: string[],
  depends_on: string[] = [],
  extra: { parallel_group?: string | null; approval_required?: boolean } = {},
) {
  return {
    step_id: id,
    title,
    purpose: title,
    depends_on,
    required_capabilities: caps,
    required_evidence: [] as string[],
    expected_output: id,
    approval_required: extra.approval_required ?? false,
    status: 'PLANNED',
    parallel_group: extra.parallel_group ?? null,
  }
}

function twoIndependent() {
  return {
    steps: [
      atlasStep('t-a', 'ORION inspect system health', ['system.health'], [], { parallel_group: 'probe' }),
      atlasStep('t-b', 'ORION inspect ports', ['wr.ports.list'], [], { parallel_group: 'probe' }),
    ],
    parallelizable_groups: [['t-a', 't-b']],
  }
}

function board(mission_id: string) {
  return createEvidenceBoard({
    mission_id,
    mission_class: 'SYSTEM_STATUS',
    question: 'runtime health probe',
    agents: ['ORION', 'PULSAR', 'LUMEN', 'AURORA'],
    ttl_seconds: 60,
    budget_tokens: 2000,
    budget_ms: 30_000,
  })
}

const HEALTH_GAP = ['runtime health 3847'] as const
const HEALTH_TOOLS = ['system.health', 'wr.ports.list', 'wr.ui.health'] as const

export async function runCouncilEngine03Validation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  results.push(check(
    'ENGINE03-MAP',
    ENGINE_03_CAPABILITY_MAP.length >= 20 && ENGINE_03_CAPABILITY_MAP.every(row => row.status === 'EXISTS' || row.status === 'PARTIAL' || row.status === 'MISSING' || row.status === 'SHOULD-EXTRACT-INTO-ENGINE'),
    `${ENGINE_03_CAPABILITY_MAP.length} rows version=${ENGINE_03_VERSION}`,
  ))

  const mismatchCtx = compileContext({
    mission_id: 'm-mismatch',
    role: 'ORION',
    objective: 'probe',
    task_objective: 'probe',
    token_budget: 128,
  })
  const mismatch = await dispatchCapability({
    mission_id: 'm-mismatch',
    wave_id: 'w0',
    task_id: 't0',
    selected_tool: 'system.health',
    requested_tool: 'research.web',
    role: 'ORION',
    objective: 'probe',
    context: mismatchCtx,
  })
  const bound = await runLiveExecution({
    mission_id: 'm-01',
    objective: 'Inspect runtime health and listeners',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    board: board('m-01'),
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-01',
    mismatch.ok === false
      && mismatch.status === 'BLOCKED'
      && mismatch.decision_honored === false
      && bound.dispatches.length >= 2
      && bound.dispatches.every(row => row.decision_honored && row.tool_id === bound.tasks.find(task => task.task_id === row.task_id)?.selected_tool),
    `mismatch=${mismatch.status} dispatches=${bound.dispatches.map(row => row.tool_id).join(',')}`,
  ))

  const noTool = await runLiveExecution({
    mission_id: 'm-02',
    objective: 'Inspect runtime health and listeners',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    ebc_satisfied: true,
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-02',
    noTool.dispatches.length === 0
      && noTool.tasks.every(row => row.decision === 'NO_TOOL_REQUIRED' && row.state === 'SKIPPED')
      && selectTool({
        mission_id: 'm-02s',
        objective: 'Inspect runtime',
        available_tools: [...HEALTH_TOOLS],
        remaining_evidence_gap: [...HEALTH_GAP],
        ebc_satisfied: true,
      }).decision === 'NO_TOOL_REQUIRED',
    `dispatches=${noTool.dispatches.length} avoided=${noTool.avoided_tool_calls}`,
  ))

  const blocked = await runLiveExecution({
    mission_id: 'm-03',
    objective: 'Research current mixture-of-experts inference methods using primary sources.',
    remaining_evidence_gap: ['need independent primary source'],
    available_tools: ['research.web', 'browser.fetch'],
    tool_health: { 'research.web': 'DEAD', 'browser.fetch': 'DEAD' },
    atlas_plan: {
      steps: [atlasStep('collect', 'PULSAR retrieve primary', ['research.web', 'browser.fetch'])],
    },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-03',
    blocked.dispatches.length === 0
      && blocked.tasks.every(row => row.state === 'BLOCKED' && row.decision === 'TOOL_BLOCKED')
      && !blocked.dispatches.some(row => row.ok),
    `dispatches=${blocked.dispatches.length} states=${blocked.tasks.map(row => row.state).join(',')}`,
  ))

  const parallel = await runLiveExecution({
    mission_id: 'm-04',
    objective: 'Inspect runtime health and listeners',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    proof_level: 'UNIT',
  })
  const a = parallel.dispatches.find(row => row.task_id === 't-a')
  const b = parallel.dispatches.find(row => row.task_id === 't-b')
  const overlapFromIntervals = a && b
    ? Math.max(0, Math.min(Date.parse(a.completed_at), Date.parse(b.completed_at)) - Math.max(Date.parse(a.started_at), Date.parse(b.started_at)))
    : 0
  results.push(check(
    'ENGINE03-04',
    Boolean(a && b && a.ok && b.ok)
      && parallel.overlap_ms > 0
      && parallel.parallelism === 'PARALLEL'
      && overlapFromIntervals > 0,
    `overlap_ms=${parallel.overlap_ms} interval=${overlapFromIntervals} parallelism=${parallel.parallelism}`,
  ))

  const dependent = await runLiveExecution({
    mission_id: 'm-05',
    objective: 'Inspect then verify',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS, 'verification'],
    optional_task_ids: [],
    atlas_plan: {
      steps: [
        atlasStep('discover', 'ORION inspect system health', ['system.health']),
        atlasStep('retrieve-a', 'ORION inspect ports A', ['wr.ports.list'], ['discover'], { parallel_group: 'collect' }),
        atlasStep('retrieve-b', 'ORION inspect UI health', ['wr.ui.health'], ['discover'], { parallel_group: 'collect' }),
        atlasStep('verify', 'LUMEN verification', ['verification'], ['retrieve-a', 'retrieve-b']),
      ],
      parallelizable_groups: [['retrieve-a', 'retrieve-b']],
    },
    proof_level: 'UNIT',
  })
  const disc = dependent.dispatches.find(row => row.task_id === 'discover')
  const ra = dependent.dispatches.find(row => row.task_id === 'retrieve-a')
  const rb = dependent.dispatches.find(row => row.task_id === 'retrieve-b')
  const ver = dependent.dispatches.find(row => row.task_id === 'verify')
  const verifyWaited = Boolean(
    disc && ra && rb && ver
    && Date.parse(ra.started_at) >= Date.parse(disc.completed_at)
    && Date.parse(rb.started_at) >= Date.parse(disc.completed_at)
    && Date.parse(ver.started_at) >= Date.parse(ra.completed_at)
    && Date.parse(ver.started_at) >= Date.parse(rb.completed_at),
  )
  results.push(check(
    'ENGINE03-05',
    verifyWaited && dependent.tasks.find(row => row.task_id === 'verify')?.state === 'SUCCEEDED',
    `starts discover=${disc?.started_at} ra=${ra?.started_at} verify=${ver?.started_at}`,
  ))

  const localCap = liveConcurrencyPolicy({ localGeneralReady: true, browserReady: true })
  const localPair = await runLiveExecution({
    mission_id: 'm-06',
    objective: 'Two local-model inspections',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: ['synthesis'],
    atlas_plan: {
      steps: [
        atlasStep('lm-a', 'ORION LOCAL qwen probe A', ['synthesis'], [], { parallel_group: 'local' }),
        atlasStep('lm-b', 'ORION LOCAL qwen probe B', ['synthesis'], [], { parallel_group: 'local' }),
      ],
      parallelizable_groups: [['lm-a', 'lm-b']],
    },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-06',
    localCap.max_local_model === 1
      && localPair.waves.every(wave => wave.max_local_model === 1)
      && localPair.governor.budget.max_local_model === 1
      && (localPair.overlap_ms === 0 || localPair.parallelism === 'SERIAL' || localPair.dispatches.length < 2),
    `max_local_model=${localCap.max_local_model} overlap=${localPair.overlap_ms} parallelism=${localPair.parallelism}`,
  ))

  results.push(check(
    'ENGINE03-07',
    parallel.overlap_ms > 0 && overlapFromIntervals > 0 && parallel.parallelism === 'PARALLEL',
    `reported=${parallel.overlap_ms} intervals=${overlapFromIntervals}`,
  ))

  const transient = await runLiveExecution({
    mission_id: 'm-08',
    objective: 'Inspect runtime health',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: ['system.health'],
    atlas_plan: { steps: [atlasStep('probe', 'ORION inspect system health', ['system.health'])] },
    force_attempts: { 'system.health': { failure_class: 'TRANSIENT', error: 'timeout 503', times: 1 } },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-08',
    transient.dispatches.length === 1
      && transient.dispatches[0]?.ok === true
      && transient.dispatches[0]?.retry_number === 1
      && transient.governor.retry_count === 1
      && transient.governor.tool_calls === 2,
    `retry=${transient.dispatches[0]?.retry_number} calls=${transient.governor.tool_calls} ok=${transient.dispatches[0]?.ok}`,
  ))

  const deterministic = await runLiveExecution({
    mission_id: 'm-09',
    objective: 'Inspect runtime health',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: ['system.health'],
    atlas_plan: { steps: [atlasStep('probe', 'ORION inspect system health', ['system.health'])] },
    force_attempts: { 'system.health': { failure_class: 'DETERMINISTIC', error: '401 authentication missing', times: 5 } },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-09',
    deterministic.governor.retry_count === 0
      && deterministic.governor.tool_calls === 1
      && deterministic.dispatches[0]?.ok === false
      && deterministic.dispatches[0]?.retry_number === 0
      && deterministic.dispatches[0]?.failure_class === 'DETERMINISTIC',
    `retries=${deterministic.governor.retry_count} class=${deterministic.dispatches[0]?.failure_class}`,
  ))

  const health = await runLiveExecution({
    mission_id: 'm-10',
    objective: 'Research current mixture-of-experts inference methods using primary sources.',
    remaining_evidence_gap: ['need independent primary source'],
    available_tools: ['research.web', 'browser.fetch'],
    tool_health: { 'research.web': 'DEAD', 'browser.fetch': 'READY' },
    atlas_plan: { steps: [atlasStep('collect', 'PULSAR retrieve primary', ['research.web', 'browser.fetch'])] },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-10',
    health.dispatches.length === 1
      && health.dispatches[0]?.tool_id === 'browser.fetch'
      && health.dispatches.every(row => row.tool_id !== 'research.web'),
    `tools=${health.dispatches.map(row => row.tool_id).join(',')}`,
  ))

  const replan = await runLiveExecution({
    mission_id: 'm-11',
    objective: 'Inspect runtime health and listeners',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    force_attempts: { 'wr.ports.list': { failure_class: 'DETERMINISTIC', error: '401 authentication missing', times: 5 } },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-11',
    replan.replans >= 1
      && replan.tasks.find(row => row.task_id === 't-a')?.state === 'SUCCEEDED'
      && replan.tasks.find(row => row.task_id === 't-b')?.state === 'REPLANNED',
    `replans=${replan.replans} t-a=${replan.tasks.find(row => row.task_id === 't-a')?.state} t-b=${replan.tasks.find(row => row.task_id === 't-b')?.state}`,
  ))

  results.push(check(
    'ENGINE03-12',
    bound.dispatches.every(row => row.context_tokens > 0 && Boolean(row.context_owner))
      && bound.receipts.some(row => row.engine === 'context-compiler')
      && mismatchCtx.tokens_used <= mismatchCtx.token_budget
      && mismatchCtx.excluded_context.length >= 0,
    `tokens=${bound.dispatches.map(row => row.context_tokens).join(',')} owners=${bound.dispatches.map(row => row.context_owner).join(',')}`,
  ))

  const intoEbc = board('m-13')
  const produced = await runLiveExecution({
    mission_id: 'm-13',
    objective: 'Inspect runtime health',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: ['system.health'],
    atlas_plan: { steps: [atlasStep('probe', 'ORION inspect system health', ['system.health'])] },
    board: intoEbc,
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-13',
    produced.dispatches[0]?.ok === true
      && produced.dispatches[0]?.produces_evidence === true
      && intoEbc.evidence.length >= 1
      && produced.ebc_evidence_ids.length >= 1
      && intoEbc.evidence.some(row => row.tool_name === 'system.health'),
    `evidence=${intoEbc.evidence.length} ids=${produced.ebc_evidence_ids.join(',')}`,
  ))

  results.push(check(
    'ENGINE03-14',
    produced.receipt_ids.length >= 1
      && intoEbc.evidence.every(row => !produced.receipt_ids.includes(row.evidence_id ?? ''))
      && intoEbc.evidence.every(row => row.evidence_id !== produced.dispatches[0]?.receipt_id),
    `receipts=${produced.receipt_ids.join(',')} evidence=${intoEbc.evidence.map(row => row.evidence_id).join(',')}`,
  ))

  const early = await runLiveExecution({
    mission_id: 'm-15',
    objective: 'Inspect then optional extra',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    optional_task_ids: ['extra'],
    stop_when_complete: true,
    atlas_plan: {
      steps: [
        atlasStep('probe', 'ORION inspect system health', ['system.health']),
        atlasStep('extra', 'ORION inspect ports optional', ['wr.ports.list'], ['probe']),
      ],
    },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-15',
    early.dispatches.length === 1
      && early.cancelled_tasks.includes('extra')
      && early.tasks.find(row => row.task_id === 'extra')?.state === 'CANCELLED',
    `dispatches=${early.dispatches.length} cancelled=${early.cancelled_tasks.join(',')}`,
  ))

  const budgeted = await runLiveExecution({
    mission_id: 'm-16',
    objective: 'Inspect runtime health and listeners',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    budget: { max_tool_calls: 1 },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-16',
    budgeted.dispatches.length === 1
      && budgeted.cancelled_tasks.length >= 1
      && budgeted.governor.tool_calls <= 1,
    `dispatches=${budgeted.dispatches.length} cancelled=${budgeted.cancelled_tasks.join(',')} calls=${budgeted.governor.tool_calls}`,
  ))

  const waiting = await runLiveExecution({
    mission_id: 'm-17',
    objective: 'commit production change',
    remaining_evidence_gap: ['need a recorded commit'],
    available_tools: ['git.commit'],
    atlas_plan: {
      steps: [atlasStep('commit', 'git commit', ['git.commit'], [], { approval_required: true })],
    },
    proof_level: 'UNIT',
  })
  results.push(check(
    'ENGINE03-17',
    waiting.dispatches.length === 0
      && waiting.completion === 'WAITING_AUTHORITY'
      && waiting.tasks.every(row => row.state === 'WAITING_AUTHORITY')
      && classifyAuthorityGate('git.commit').class === 'COMMANDER_REQUIRED'
      && classifyAuthorityGate('git.commit').execute === false,
    `completion=${waiting.completion} dispatches=${waiting.dispatches.length} gate=${classifyAuthorityGate('git.commit').class}`,
  ))

  const gate = classifyAuthorityGate('git.commit')
  const upgraded = maybeUpgradeAuthority(gate, true)
  const safeDispatch = await dispatchCapability({
    mission_id: 'm-18',
    wave_id: 'w',
    task_id: 'commit',
    selected_tool: 'git.commit',
    requested_tool: 'git.commit',
    role: 'ATLAS',
    objective: 'commit',
    context: mismatchCtx,
    seems_safe: true,
  })
  results.push(check(
    'ENGINE03-18',
    upgraded.class === 'COMMANDER_REQUIRED'
      && upgraded.execute === false
      && safeDispatch.status === 'WAITING_AUTHORITY'
      && safeDispatch.ok === false,
    `upgrade=${upgraded.class} dispatch=${safeDispatch.status}`,
  ))

  results.push(check(
    'ENGINE03-19',
    deterministic.diagnoses.length >= 1
      && deterministic.receipts.some(row => row.engine === 'failure-diagnosis')
      && Boolean(deterministic.diagnoses[0]?.category)
      && deterministic.diagnoses[0].supporting_receipts.length >= 1,
    `diagnoses=${deterministic.diagnoses.map(row => row.category).join(',')}`,
  ))

  const aurora = await runLiveExecution({
    mission_id: 'm-20',
    objective: 'Inspect then synthesize',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS, 'verification', 'synthesis'],
    optional_task_ids: [],
    atlas_plan: {
      steps: [
        atlasStep('collect', 'ORION inspect system health', ['system.health']),
        atlasStep('verify', 'LUMEN verification', ['verification'], ['collect']),
        atlasStep('s4', 'AURORA response', ['synthesis'], ['verify']),
      ],
    },
    proof_level: 'UNIT',
  })
  const collect = aurora.dispatches.find(row => row.task_id === 'collect')
  const lumen = aurora.dispatches.find(row => row.task_id === 'verify')
  const synth = aurora.dispatches.find(row => row.task_id === 's4')
  results.push(check(
    'ENGINE03-20',
    Boolean(collect && lumen && synth)
      && Date.parse(lumen!.started_at) >= Date.parse(collect!.completed_at)
      && Date.parse(synth!.started_at) >= Date.parse(lumen!.completed_at)
      && synth!.tool_id === 'synthesis',
    `collect→verify→s4 ${collect?.completed_at} ${lumen?.started_at} ${synth?.started_at}`,
  ))

  const engine02 = runCouncilEngine02Validation()
  results.push(check(
    'ENGINE03-21',
    ENGINE_02_VERSION === 'council-engine-02.v1' && engine02.every(row => row.pass),
    `engine02 ${engine02.filter(row => row.pass).length}/${engine02.length}`,
  ))

  results.push(check(
    'ENGINE03-22',
    ENGINE_01_VERSION === 'council-engine-01.v1' && ENGINE_03_VERSION === 'council-engine-03.v1',
    `01=${ENGINE_01_VERSION} 03=${ENGINE_03_VERSION}`,
  ))

  const ebcBoard = board('m-23')
  const ebcLive = await runLiveExecution({
    mission_id: 'm-23',
    objective: 'Inspect runtime health',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: ['system.health'],
    atlas_plan: { steps: [atlasStep('probe', 'ORION inspect system health', ['system.health'])] },
    board: ebcBoard,
    proof_level: 'UNIT',
  })
  const pub = attachCouncilEngine03Public({ live: ebcLive })
  const ebcPublic = attachCouncilEnginePublic({
    board: ebcBoard,
    lumen: [],
    aurora: synthesizeAurora(boardSnapshot(ebcBoard), 'UNVERIFIED', 0),
  })
  results.push(check(
    'ENGINE03-23',
    ebcLive.ebc_canonical === true
      && ebcLive.grants_authority === false
      && pub.grants_authority === false
      && pub.ebc_canonical === true
      && Boolean(ebcPublic),
    `canonical=${ebcLive.ebc_canonical} grants=${ebcLive.grants_authority}`,
  ))

  const hist = createSimulatedSessionState()
  simulateSelectSession(hist, 'hist-e03', [{ messageType: 'assistant', content: 'prior research' }])
  const hydrate = historyHydrationRequest('hist-e03')
  results.push(check(
    'ENGINE03-24',
    hydrate.method === 'GET'
      && hist.startedMission === false
      && sidebarPaneIdentitiesAgree({ sidebarSessionId: hist.activeSessionId, paneOwnerId: hist.transcriptOwnerId }),
    `mission=${hist.startedMission} method=${hydrate.method}`,
  ))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runCouncilEngine03Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_ENGINE_03 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
