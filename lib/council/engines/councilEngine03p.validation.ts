/**
 * Council ENGINE-03P: production invocation of Engine-03 from the intelligence pipeline.
 * Does not overlay ENGINE-03. Does not replace EBC, ATLAS, or CouncilExecutive.
 */
import { pathToFileURL } from 'node:url'
import {
  ENGINE03P_LEGACY_PATHS,
  ENGINE03_PRODUCTION_PHASES,
  formatCommanderApprovalRequest,
  invokeEngine03ForProduction,
} from '@/lib/council/engines'
import { runCouncilEngine01Validation } from '@/lib/council/engines/councilEngine01.validation'
import { runCouncilEngine02Validation } from '@/lib/council/engines/councilEngine02.validation'
import { runCouncilEngine03Validation } from '@/lib/council/engines/councilEngine03.validation'
import { toolFingerprint } from '@/lib/council/evidence-board/board'
import type { ToolCallRecord } from '@/lib/council/evidence-board/types'
import type { ToolRunner } from '@/lib/council/evidence-board/tools'
import { runCouncilIntelligenceMission } from '@/lib/council/intelligence'
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

function fixtureTools(opts?: { fail?: string[]; calls?: string[] }): ToolRunner {
  const now = new Date().toISOString()
  const cache = new Map<string, ToolCallRecord>()
  const payloads: Record<string, Partial<ToolCallRecord>> = {
    'wr.core.health': { ok: true, status_code: 200, summary: 'Core health 200', pointer: 'http://127.0.0.1:3847/api/local/health', kind: 'live_telemetry' },
    'wr.ui.health': { ok: true, status_code: 200, summary: 'UI health 200', pointer: 'http://127.0.0.1:3848/api/health', kind: 'live_telemetry' },
    'wr.ports.list': { ok: true, summary: 'listeners=2 critical=3847:11,3848:22', pointer: 'ss:-ltnp', kind: 'live_telemetry' },
    'wr.council.backend': { ok: true, summary: 'Council local backend READY_LOCAL', pointer: 'http://127.0.0.1:11434', kind: 'live_telemetry' },
    'wr.broker.status': { ok: true, summary: 'Browser Broker READY', pointer: 'broker:status', kind: 'live_telemetry' },
    'broker.fetch': { ok: true, summary: 'MoE docs — https://arxiv.org/abs/2401.0001', pointer: 'https://arxiv.org/abs/2401.0001', url: 'https://arxiv.org/abs/2401.0001', kind: 'primary_external' },
  }
  return async (toolName, args = {}) => {
    opts?.calls?.push(toolName)
    const fingerprint = toolFingerprint(toolName, args)
    const cached = cache.get(fingerprint)
    if (cached) return cached
    const forcedFail = opts?.fail?.includes(toolName)
    const seed = payloads[toolName]
    const record: ToolCallRecord = {
      tool_name: toolName,
      args_fingerprint: fingerprint,
      ok: forcedFail ? false : seed?.ok ?? false,
      blocked: forcedFail || seed?.ok === false,
      denied: false,
      summary: forcedFail ? `TOOL_BLOCKED: ${toolName} unavailable` : seed?.summary ?? `Unknown tool ${toolName}`,
      pointer: seed?.pointer ?? toolName,
      url: seed?.url ?? null,
      kind: seed?.kind ?? 'tool_result',
      retrieved_at: now,
      temporal_layer: 'CURRENT_LIVE',
      status_code: seed?.status_code ?? null,
    }
    cache.set(fingerprint, record)
    return record
  }
}

const RESEARCH = 'Research current mixture-of-experts inference methods using primary sources.'
const HEALTH_GAP = ['runtime health 3847'] as const
const HEALTH_TOOLS = ['system.health', 'wr.ports.list', 'wr.ui.health'] as const

export async function runCouncilEngine03pValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const innerCalls: string[] = []

  const research = await runCouncilIntelligenceMission({
    commanderMessage: RESEARCH,
    tools: fixtureTools({ calls: innerCalls }),
    skipLiveAwareness: true,
  })
  const e03 = research.public.orchestration?.engines03
  results.push(check(
    'ENGINE03P-01',
    e03?.production_invoked === true
      && (e03.phases ?? []).includes('PLANNING')
      && (e03.phases ?? []).includes('EXECUTING')
      && (e03.phases ?? []).includes('SYNTHESIZING')
      && ENGINE03_PRODUCTION_PHASES.every(phase => (e03.phases ?? []).includes(phase)),
    `invoked=${e03?.production_invoked} phases=${(e03?.phases ?? []).join('→')}`,
  ))
  results.push(check(
    'ENGINE03P-02',
    e03?.production_invoked === true && e03?.injection === false && research.public.orchestration?.engines03?.receipts != null,
    `injection=${e03?.injection} proof=${e03?.proof_level}`,
  ))
  results.push(check(
    'ENGINE03P-03',
    (e03?.dispatches ?? 0) >= 1
      && (e03?.tasks ?? []).some(row => row.selected_tool != null)
      && research.ebc != null,
    `dispatches=${e03?.dispatches} tools=${(e03?.tasks ?? []).map(row => row.selected_tool).join(',')}`,
  ))

  const social = await runCouncilIntelligenceMission({
    commanderMessage: 'Hi Council',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  const socialE03 = social.public.orchestration?.engines03
  results.push(check(
    'ENGINE03P-04',
    socialE03?.production_invoked === true
      && (socialE03.dispatches ?? 0) === 0
      && (socialE03.decision === 'NO_TOOL_REQUIRED' || (socialE03.tasks ?? []).every(row => row.state === 'SKIPPED' || !socialE03.tasks?.length)),
    `dispatches=${socialE03?.dispatches} decision=${socialE03?.decision} completion=${socialE03?.completion}`,
  ))

  const blocked = await invokeEngine03ForProduction({
    mission_id: 'p-05',
    objective: RESEARCH,
    mission_class: 'DEEP_RESEARCH',
    remaining_evidence_gap: ['need independent primary source'],
    available_tools: ['research.web', 'browser.fetch'],
    tool_health: { 'research.web': 'DEAD', 'browser.fetch': 'DEAD' },
    atlas_plan: { steps: [atlasStep('collect', 'PULSAR retrieve primary', ['research.web', 'browser.fetch'])] },
    proof_level: 'UNIT',
    tools: fixtureTools(),
  })
  results.push(check(
    'ENGINE03P-05',
    blocked.live.dispatches.length === 0
      && blocked.live.tasks.every(row => row.decision === 'TOOL_BLOCKED' || row.state === 'BLOCKED')
      && !blocked.live.dispatches.some(row => row.ok),
    `dispatches=${blocked.live.dispatches.length} states=${blocked.live.tasks.map(row => row.state).join(',')}`,
  ))

  const parallel = await invokeEngine03ForProduction({
    mission_id: 'p-06',
    objective: 'Inspect runtime health and listeners',
    mission_class: 'SYSTEM_STATUS',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    proof_level: 'UNIT',
  })
  const pa = parallel.live.dispatches.find(row => row.task_id === 't-a')
  const pb = parallel.live.dispatches.find(row => row.task_id === 't-b')
  const interval = pa && pb
    ? Math.max(0, Math.min(Date.parse(pa.completed_at), Date.parse(pb.completed_at)) - Math.max(Date.parse(pa.started_at), Date.parse(pb.started_at)))
    : 0
  results.push(check(
    'ENGINE03P-06',
    Boolean(pa && pb && pa.ok && pb.ok) && parallel.live.overlap_ms > 0 && interval > 0 && parallel.live.parallelism === 'PARALLEL',
    `overlap_ms=${parallel.live.overlap_ms} interval=${interval} parallelism=${parallel.live.parallelism}`,
  ))

  const dependent = await invokeEngine03ForProduction({
    mission_id: 'p-07',
    objective: 'Inspect then verify',
    mission_class: 'SYSTEM_STATUS',
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS, 'verification'],
    atlas_plan: {
      steps: [
        atlasStep('discover', 'ORION inspect system health', ['system.health']),
        atlasStep('retrieve-a', 'ORION inspect ports A', ['wr.ports.list'], ['discover'], { parallel_group: 'collect' }),
        atlasStep('retrieve-b', 'ORION inspect UI health', ['wr.ui.health'], ['discover'], { parallel_group: 'collect' }),
        atlasStep('verify', 'LUMEN verification', ['verification'], ['retrieve-a', 'retrieve-b']),
        atlasStep('synth', 'AURORA board-only synthesis', ['synthesis'], ['verify']),
      ],
      parallelizable_groups: [['retrieve-a', 'retrieve-b']],
    },
    proof_level: 'UNIT',
  })
  const disc = dependent.live.dispatches.find(row => row.task_id === 'discover')
  const ra = dependent.live.dispatches.find(row => row.task_id === 'retrieve-a')
  const rb = dependent.live.dispatches.find(row => row.task_id === 'retrieve-b')
  const ver = dependent.live.dispatches.find(row => row.task_id === 'verify')
  const synth = dependent.live.dispatches.find(row => row.task_id === 'synth')
  const barrier = Boolean(
    disc && ra && rb && ver
    && Date.parse(ra.started_at) >= Date.parse(disc.completed_at)
    && Date.parse(rb.started_at) >= Date.parse(disc.completed_at)
    && Date.parse(ver.started_at) >= Date.parse(ra.completed_at)
    && Date.parse(ver.started_at) >= Date.parse(rb.completed_at),
  )
  results.push(check(
    'ENGINE03P-07',
    barrier && dependent.live.tasks.find(row => row.task_id === 'verify')?.state === 'SUCCEEDED',
    `verify_start=${ver?.started_at} ra_end=${ra?.completed_at}`,
  ))

  const replan = await invokeEngine03ForProduction({
    mission_id: 'p-08',
    objective: 'Inspect runtime health and listeners',
    mission_class: 'SYSTEM_STATUS',
    atlas_plan: twoIndependent(),
    remaining_evidence_gap: [...HEALTH_GAP],
    available_tools: [...HEALTH_TOOLS],
    proof_level: 'UNIT',
    force_attempts: { 'wr.ports.list': { failure_class: 'DETERMINISTIC', error: '401 authentication missing', times: 5 } },
  })
  results.push(check(
    'ENGINE03P-08',
    replan.live.replans >= 1
      && replan.live.tasks.find(row => row.task_id === 't-a')?.state === 'SUCCEEDED'
      && replan.live.diagnoses.length >= 1,
    `replans=${replan.live.replans} t-a=${replan.live.tasks.find(row => row.task_id === 't-a')?.state} t-b=${replan.live.tasks.find(row => row.task_id === 't-b')?.state}`,
  ))

  results.push(check(
    'ENGINE03P-09',
    (parallel.live.receipts.some(row => row.engine === 'context-compiler') || (e03?.context_tokens ?? 0) > 0)
      && (pa?.context_tokens ?? 0) > 0,
    `compiler=${parallel.live.receipts.filter(row => row.engine === 'context-compiler').length} tokens=${pa?.context_tokens}`,
  ))

  const ebcIds = research.ebc?.board.evidence.map(row => row.evidence_id) ?? []
  const workProductEntered = ebcIds.length >= 1 || (e03?.dispatches ?? 0) >= 1
  results.push(check(
    'ENGINE03P-10',
    workProductEntered && research.public.ebc_truth_spine === true && e03?.ebc_canonical === true,
    `ebc_evidence=${ebcIds.length} dispatches=${e03?.dispatches}`,
  ))
  results.push(check(
    'ENGINE03P-11',
    (research.ebc?.board.evidence ?? []).every(row => row.tool_name !== 'live-execution' && !row.evidence_id.startsWith('receipt-'))
      && (e03?.receipts.length ?? 0) > 0,
    `evidence_tools=${(research.ebc?.board.evidence ?? []).map(row => row.tool_name).join(',')} receipts=${e03?.receipts.length ?? 0}`,
  ))

  const commit = await runCouncilIntelligenceMission({
    commanderMessage: 'Commit the current uncommitted files to git now',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  const commitE03 = commit.public.orchestration?.engines03
  const approval = formatCommanderApprovalRequest(commitE03?.tasks?.find(row => row.state === 'WAITING_AUTHORITY')?.selected_tool || 'git.commit')
  results.push(check(
    'ENGINE03P-12',
    (commitE03?.completion === 'WAITING_AUTHORITY' || (commitE03?.authority_waits ?? []).length > 0)
      && Boolean(commitE03?.approval_request || commit.commander_brief.includes('Authority required: Commander'))
      && !(commitE03?.tasks ?? []).some(row => row.selected_tool === 'git.commit' && row.state === 'SUCCEEDED')
      && !commit.ebc?.snapshot.tool_calls.some(row => row.tool_name === 'git.commit' && row.ok)
      && approval.includes('Approve / Decline'),
    `completion=${commitE03?.completion} waits=${(commitE03?.authority_waits ?? []).join(',')} brief=${commit.commander_brief.includes('Approve / Decline')}`,
  ))

  const fetchCalls = innerCalls.filter(name => name === 'broker.fetch')
  results.push(check(
    'ENGINE03P-13',
    fetchCalls.length <= 1 || (e03?.dispatches ?? 0) >= 1,
    `inner_broker.fetch=${fetchCalls.length} engine_dispatches=${e03?.dispatches}`,
  ))

  const routed = ENGINE03P_LEGACY_PATHS.filter(row => row.classification === 'ROUTE_THROUGH_ENGINE03')
  results.push(check(
    'ENGINE03P-14',
    Boolean(research.public.mission_id)
      && e03?.production_invoked === true
      && routed.length >= 1
      && ENGINE03P_LEGACY_PATHS.some(row => row.classification === 'KEEP')
      && ENGINE03P_LEGACY_PATHS.some(row => row.classification === 'DEPRECATE')
      && ENGINE03P_LEGACY_PATHS.some(row => row.classification === 'TEST_ONLY'),
    `mission=${research.public.mission_id} paths=${ENGINE03P_LEGACY_PATHS.length}`,
  ))

  const auroraWaited = Boolean(
    synth
    && ver
    && Date.parse(synth.started_at) >= Date.parse(ver.completed_at)
    && !dependent.live.cancelled_tasks.includes('synth'),
  )
  results.push(check(
    'ENGINE03P-15',
    auroraWaited && dependent.live.tasks.find(row => row.task_id === 'synth')?.state === 'SUCCEEDED',
    `synth_start=${synth?.started_at} verify_end=${ver?.completed_at} cancelled=${dependent.live.cancelled_tasks.join(',')}`,
  ))

  const suite03 = await runCouncilEngine03Validation()
  results.push(check('ENGINE03P-16', suite03.every(row => row.pass), `${suite03.filter(row => row.pass).length}/${suite03.length}`))
  const suite02 = runCouncilEngine02Validation()
  results.push(check('ENGINE03P-17', suite02.every(row => row.pass), `${suite02.filter(row => row.pass).length}/${suite02.length}`))
  const suite01 = runCouncilEngine01Validation()
  results.push(check('ENGINE03P-18', suite01.every(row => row.pass), `${suite01.filter(row => row.pass).length}/${suite01.length}`))

  const hist = createSimulatedSessionState()
  simulateSelectSession(hist, 'hist-e03p', [{ messageType: 'assistant', content: 'prior research' }])
  const hydrate = historyHydrationRequest('hist-e03p')
  results.push(check(
    'ENGINE03P-HYDRATION',
    hydrate.method === 'GET'
      && hist.startedMission === false
      && sidebarPaneIdentitiesAgree({ sidebarSessionId: hist.activeSessionId, paneOwnerId: hist.transcriptOwnerId }),
    `mission=${hist.startedMission} method=${hydrate.method}`,
  ))

  const skipped = await runCouncilIntelligenceMission({
    commanderMessage: RESEARCH,
    tools: fixtureTools(),
    skipLiveAwareness: true,
    skipEbc: true,
    engine03: { skip: true },
  })
  results.push(check(
    'ENGINE03P-SKIP-EBC',
    skipped.public.orchestration?.engines03?.production_invoked !== true,
    `invoked=${skipped.public.orchestration?.engines03?.production_invoked}`,
  ))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runCouncilEngine03pValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_ENGINE_03P ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
