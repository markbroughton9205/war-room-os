/**
 * Council ENGINE-02: tool selection, hierarchical planning, context compiler, failure diagnosis.
 * Wraps toolValue / ATLAS / context packets / receipts. Does not replace EBC or ENGINE-01.
 */
import { pathToFileURL } from 'node:url'
import {
  ENGINE_01_VERSION,
  ENGINE_02_CAPABILITY_MAP,
  ENGINE_02_VERSION,
  attachCouncilEngine02Public,
  auroraCompileContext,
  auroraFacingFromEngines02,
  buildHierarchicalPlan,
  classifyToolFailure,
  compileContext,
  contextWouldUpgradeTruth,
  contextsDiffer,
  dependentWouldRace,
  diagnoseFailure,
  janusConsumeHierarchicalPlan,
  lumenCompileContext,
  mayExecutePlanNode,
  mayPersistFailurePattern,
  measureParallelOverlap,
  persistProvenFailureExperience,
  phoenixCompileContext,
  planResearchDiscovery,
  pulsarCompileContext,
  selectTool,
  sentinelInspectPlan,
  shouldRetryTool,
} from '@/lib/council/engines'
import { attachCouncilEnginePublic } from '@/lib/council/engines/integration/ebc'
import { createEvidenceBoard, boardSnapshot } from '@/lib/council/evidence-board/board'
import { synthesizeAurora } from '@/lib/council/evidence-board/verify'
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

const OBJECTIVE = 'Research current mixture-of-experts inference methods using primary sources.'

function fact(mission_id: string, text: string, state: 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED' | 'CONFLICTING' | 'STALE', evidence_ref: string | null = 'e1') {
  return { text, evidence_ref, state, mission_id, freshness: 'CURRENT' as const }
}

export function runCouncilEngine02Validation(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    'ENGINE02-MAP',
    ENGINE_02_CAPABILITY_MAP.length >= 20 && ENGINE_02_CAPABILITY_MAP.every(row => row.status === 'EXISTS' || row.status === 'PARTIAL' || row.status === 'MISSING' || row.status === 'SHOULD-EXTRACT-INTO-ENGINE'),
    `${ENGINE_02_CAPABILITY_MAP.length} rows`,
  ))

  const noTool = selectTool({
    mission_id: 'm-sat',
    objective: OBJECTIVE,
    available_tools: ['research.web', 'browser.fetch'],
    remaining_evidence_gap: ['primary source'],
    ebc_satisfied: true,
  })
  results.push(check(
    'ENGINE02-01',
    noTool.decision === 'NO_TOOL_REQUIRED' && noTool.selected_tool === null && noTool.receipt.failure_state === 'no_tool_required',
    `${noTool.decision} ${noTool.reason}`,
  ))

  const dead = selectTool({
    mission_id: 'm-dead',
    objective: OBJECTIVE,
    available_tools: ['research.web', 'browser.fetch'],
    remaining_evidence_gap: ['need independent primary source'],
    tool_health: { 'research.web': 'DEAD', 'browser.fetch': 'READY' },
  })
  results.push(check(
    'ENGINE02-02',
    dead.selected_tool === 'browser.fetch' && dead.avoid.some(row => row.tool_id === 'research.web' && /DEAD/.test(row.avoid_reason)),
    `${dead.selected_tool} avoid=${dead.avoid.map(row => row.tool_id).join(',')}`,
  ))

  const gain = selectTool({
    mission_id: 'm-gain',
    objective: OBJECTIVE,
    available_tools: ['system.health', 'research.web'],
    remaining_evidence_gap: ['need independent primary source'],
    expected_information_gain_hint: 'high',
  })
  results.push(check(
    'ENGINE02-03',
    gain.selected_tool === 'research.web' && gain.expected_information_gain === 'HIGH' && gain.candidates.every(row => row.economics.expected_information_gain && row.economics.latency && row.economics.cost),
    `${gain.selected_tool} ${gain.expected_information_gain}`,
  ))

  const transient = selectTool({
    mission_id: 'm-retry',
    objective: OBJECTIVE,
    available_tools: ['research.web', 'browser.fetch'],
    remaining_evidence_gap: ['need independent primary source'],
    previous_attempts: [{ tool_id: 'research.web', failure_class: 'TRANSIENT', error: 'timeout 503' }],
  })
  results.push(check(
    'ENGINE02-04',
    shouldRetryTool({ failure_class: 'TRANSIENT', attempts: 1 })
      && transient.retry.allowed
      && classifyToolFailure('timeout 503') === 'TRANSIENT',
    `retry=${transient.retry.allowed} remaining=${transient.retry.remaining} selected=${transient.selected_tool}`,
  ))

  const deterministic = selectTool({
    mission_id: 'm-det',
    objective: OBJECTIVE,
    available_tools: ['research.web', 'browser.fetch'],
    remaining_evidence_gap: ['need independent primary source'],
    previous_attempts: [{ tool_id: 'research.web', failure_class: 'DETERMINISTIC', error: '401 authentication missing' }],
    known_failures: ['research.web'],
  })
  results.push(check(
    'ENGINE02-05',
    !shouldRetryTool({ failure_class: 'DETERMINISTIC', attempts: 1 })
      && classifyToolFailure('401 authentication missing') === 'DETERMINISTIC'
      && deterministic.selected_tool !== 'research.web'
      && !deterministic.retry.allowed,
    `selected=${deterministic.selected_tool} retry=${deterministic.retry.allowed}`,
  ))

  const planned = buildHierarchicalPlan({
    mission_id: 'm-plan',
    objective: OBJECTIVE,
  })
  const taskIds = planned.plan.nodes.filter(node => node.kind === 'TASK').map(node => node.id)
  const s3 = planned.plan.nodes.find(node => node.id === 's3')
  results.push(check(
    'ENGINE02-06',
    planned.plan.nodes.some(node => node.kind === 'MISSION')
      && planned.plan.nodes.some(node => node.kind === 'PHASE')
      && planned.plan.nodes.some(node => node.kind === 'TASK')
      && planned.plan.nodes.some(node => node.kind === 'TOOL_ACTION')
      && planned.plan.edges.some(edge => edge.kind === 'requires' && edge.from === 's1' && edge.to === 's2a')
      && (s3?.dependencies.includes('s2a') ?? false)
      && planned.plan.atlas_role === 'ATLAS',
    `nodes=${planned.plan.nodes.map(node => node.kind).join(',')} tasks=${taskIds.join(',')}`,
  ))

  const s2a = planned.plan.nodes.find(node => node.id === 's2a')
  const s2b = planned.plan.nodes.find(node => node.id === 's2b')
  results.push(check(
    'ENGINE02-07',
    Boolean(s2a?.parallelizable && s2b?.parallelizable)
      && planned.plan.edges.some(edge => edge.kind === 'can_parallelize_with' && ((edge.from === 's2a' && edge.to === 's2b') || (edge.from === 's2b' && edge.to === 's2a')))
      && planned.parallelism.max_local_model === 1,
    `s2a=${s2a?.parallelizable} s2b=${s2b?.parallelizable} groups=${JSON.stringify(planned.plan.parallel_groups)}`,
  ))

  results.push(check(
    'ENGINE02-08',
    dependentWouldRace(planned.plan, 's3')
      && planned.plan.edges.some(edge => edge.kind === 'requires' && edge.to === 's3' && (edge.from === 's2a' || edge.from === 's2b'))
      && !planned.plan.edges.some(edge => edge.kind === 'requires' && ((edge.from === 's2a' && edge.to === 's2b') || (edge.from === 's2b' && edge.to === 's2a'))),
    's3 waits on collect; s2a/s2b have no requires-between race',
  ))

  const replanned = buildHierarchicalPlan({
    mission_id: 'm-plan',
    objective: OBJECTIVE,
    failed_task_id: 's2a',
    previous_plan_hash: planned.plan_hash,
  })
  const unchanged = replanned.plan.nodes.filter(node => node.kind === 'TASK' && node.id !== 's2a' && node.id !== 's3' && node.id !== 's4')
  results.push(check(
    'ENGINE02-09',
    replanned.receipt.decision === 'LOCAL_REPLAN'
      && replanned.plan.nodes.find(node => node.id === 's2a')?.status === 'FAILED'
      && unchanged.every(node => node.status === 'PLANNED')
      && Boolean(replanned.plan.change_reason?.includes('localized')),
    `${replanned.receipt.decision} ${replanned.plan.change_reason}`,
  ))

  const stopped = buildHierarchicalPlan({
    mission_id: 'm-done',
    objective: OBJECTIVE,
    ebc_satisfied: true,
  })
  results.push(check(
    'ENGINE02-10',
    stopped.plan.stopped_for_completion
      && stopped.plan.nodes.every(node => node.kind === 'MISSION')
      && stopped.receipt.decision === 'STOP',
    `${stopped.plan.change_reason}`,
  ))

  const compiled = compileContext({
    mission_id: 'm-ctx',
    role: 'LUMEN',
    objective: OBJECTIVE,
    task_objective: 'bind evidence',
    token_budget: 256,
    verified_facts: [fact('m-ctx', 'MoE routes tokens to experts', 'VERIFIED', 'e-ver')],
    supported_facts: [fact('m-ctx', 'Mixtral is sparse', 'SUPPORTED', 'e-sup')],
    unverified_facts: [fact('m-ctx', 'maybe 12 experts', 'UNVERIFIED', null)],
    foreign_mission_facts: [fact('other-mission', 'unrelated tax filing from prior mission', 'VERIFIED', 'e-old')],
    history: ['previous mission: Tesla 10-K summary'],
    questions: ['how many experts?'],
    conflicts: ['source dates disagree'],
    hypotheses: ['routing is learned'],
  })
  results.push(check(
    'ENGINE02-11',
    compiled.excluded_context.some(row => /foreign:other-mission/.test(row))
      && !compiled.required_facts.some(row => /tax filing/.test(row.text))
      && !compiled.required_facts.some(row => row.mission_id !== 'm-ctx'),
    `excluded=${compiled.excluded_context.join('|')}`,
  ))

  const tight = compileContext({
    mission_id: 'm-ctx',
    role: 'AURORA',
    objective: 'Research MoE',
    task_objective: 'synthesize',
    token_budget: 90,
    verified_facts: [fact('m-ctx', 'MoE routes tokens', 'VERIFIED', 'e-ver')],
    unverified_facts: [
      fact('m-ctx', 'long background rumor padding '.repeat(20), 'UNVERIFIED', null),
    ],
  })
  results.push(check(
    'ENGINE02-12',
    tight.required_facts.some(row => row.state === 'VERIFIED' && /MoE routes/.test(row.text))
      && tight.excluded_context.some(row => /budget:unverified/.test(row) || /budget:/.test(row)),
    `facts=${tight.required_facts.map(row => row.state).join(',')} excluded=${tight.excluded_context.length}`,
  ))

  const unverified = compiled.required_facts.find(row => /maybe 12/.test(row.text)) ?? compiled.required_facts.find(row => row.state === 'UNVERIFIED')
  results.push(check(
    'ENGINE02-13',
    !contextWouldUpgradeTruth(fact('m-ctx', 'maybe 12 experts', 'UNVERIFIED', null), { ...fact('m-ctx', 'maybe 12 experts', 'UNVERIFIED', null), state: 'UNVERIFIED' })
      && (unverified ? unverified.state === 'UNVERIFIED' : compiled.required_facts.every(row => row.state !== 'VERIFIED' || row.evidence_ref !== null))
      && lumenCompileContext({
        mission_id: 'm-ctx',
        role: 'ATLAS',
        objective: OBJECTIVE,
        task_objective: 'verify',
        unverified_facts: [fact('m-ctx', 'rumor', 'UNVERIFIED', null)],
      }).required_facts.every(row => row.state !== 'VERIFIED' || Boolean(row.evidence_ref)),
    'uncertainty preserved; no UNVERIFIED→VERIFIED',
  ))

  const ctxInput = {
    mission_id: 'm-role',
    objective: OBJECTIVE,
    task_objective: 'next action',
    token_budget: 400,
    verified_facts: [fact('m-role', 'primary paper exists', 'VERIFIED', 'e1')],
    unverified_facts: [fact('m-role', 'weak claim', 'UNVERIFIED', null)],
    questions: ['what is the live source?'],
    conflicts: ['dates disagree'],
    hypotheses: ['the filing is stale'],
    tool_state: ['broker READY'],
    work_products: ['plan tree internals', 'tool economics table', 'failure graph'],
  }
  const pulsar = pulsarCompileContext({ ...ctxInput, role: 'PULSAR' })
  const lumen = lumenCompileContext({ ...ctxInput, role: 'LUMEN' })
  const phoenix = phoenixCompileContext({ ...ctxInput, role: 'PHOENIX' })
  const aurora = auroraCompileContext({ ...ctxInput, role: 'AURORA' })
  results.push(check(
    'ENGINE02-14',
    contextsDiffer(pulsar, aurora)
      && contextsDiffer(phoenix, lumen)
      && phoenix.hypotheses.length > 0
      && aurora.hypotheses.length === 0
      && pulsar.tool_state.length > 0
      && aurora.tool_state.length === 0
      && aurora.excluded_context.some(row => /aurora_internal/.test(row)),
    `pulsarQ=${pulsar.open_questions.length} auroraH=${aurora.hypotheses.length} phoenixH=${phoenix.hypotheses.length}`,
  ))

  results.push(check(
    'ENGINE02-15',
    tight.tokens_used <= tight.token_budget && compiled.tokens_used <= compiled.token_budget && pulsar.tokens_used <= pulsar.token_budget,
    `tight=${tight.tokens_used}/${tight.token_budget} compiled=${compiled.tokens_used}/${compiled.token_budget}`,
  ))

  const render = diagnoseFailure({
    mission_id: 'm-fail',
    symptom: 'PAGEERROR cannot read properties of undefined',
    receipts: [{ receipt_id: 'r-render', capability: 'ui.render', success: false, error: 'PAGEERROR' }],
  })
  const retrieval = diagnoseFailure({
    mission_id: 'm-fail',
    symptom: 'broker.fetch NAVIGATE_FAILED retrieval',
    receipts: [{ receipt_id: 'r-fetch', capability: 'broker.fetch', success: false, error: 'NAVIGATE_FAILED' }],
  })
  results.push(check(
    'ENGINE02-16',
    render.diagnosis.category === 'RENDER_FAILURE' && retrieval.diagnosis.category === 'RETRIEVAL_FAILURE',
    `render=${render.diagnosis.category} retrieval=${retrieval.diagnosis.category}`,
  ))

  const session = diagnoseFailure({
    mission_id: 'm-fail',
    symptom: 'session identity sidebar pane owner mismatch',
    session_identity: { sidebar: 'a', pane: 'b' },
  })
  const synthesis = diagnoseFailure({
    mission_id: 'm-fail',
    symptom: 'aurora final synthesis failed',
    session_identity: { sidebar: 'a', pane: 'a' },
  })
  results.push(check(
    'ENGINE02-17',
    session.diagnosis.category === 'SESSION_IDENTITY_FAILURE' && synthesis.diagnosis.category === 'SYNTHESIS_FAILURE',
    `session=${session.diagnosis.category} synthesis=${synthesis.diagnosis.category}`,
  ))

  const uncertain = diagnoseFailure({
    mission_id: 'm-amb',
    symptom: 'AURORA missing',
  })
  results.push(check(
    'ENGINE02-18',
    uncertain.diagnosis.confidence_state === 'UNCERTAIN'
      && /capture one existing stream/.test(uncertain.diagnosis.next_discriminating_check)
      && uncertain.diagnosis.remaining.length > 1
      && !uncertain.diagnosis.persist_as_proven,
    `${uncertain.diagnosis.confidence_state} ${uncertain.diagnosis.next_discriminating_check}`,
  ))

  const proven = diagnoseFailure({
    mission_id: 'm-proven',
    symptom: 'CHROMIUM_DISCONNECTED DEAD unavailable',
    receipts: [{ receipt_id: 'r-dead', capability: 'browser.fetch', success: false, error: 'CHROMIUM_DISCONNECTED' }],
  })
  const stored = persistProvenFailureExperience({ diagnosis: proven.diagnosis, mission_id: 'm-proven' })
  results.push(check(
    'ENGINE02-19',
    mayPersistFailurePattern(proven.diagnosis)
      && proven.diagnosis.confidence_state === 'PROVEN'
      && stored !== null
      && stored.failure_modes.some(row => /TOOL_UNAVAILABLE/.test(row))
      && stored.hidden_cot === false,
    `${proven.diagnosis.confidence_state} modes=${stored?.failure_modes.join(',')}`,
  ))

  const speculative = persistProvenFailureExperience({ diagnosis: uncertain.diagnosis, mission_id: 'm-amb' })
  results.push(check(
    'ENGINE02-20',
    !mayPersistFailurePattern(uncertain.diagnosis) && speculative === null && uncertain.diagnosis.persist_as_proven === false,
    'speculative diagnosis not persisted as proven',
  ))

  const authNode = planned.plan.nodes.find(node => node.authority_requirement === 'COMMANDER')
    ?? buildHierarchicalPlan({
      mission_id: 'm-auth',
      objective: 'commit production change',
      atlas_plan: {
        steps: [{
          step_id: 'auth-1',
          title: 'git commit',
          purpose: 'record change',
          depends_on: [],
          required_capabilities: ['git.commit'],
          required_evidence: [],
          expected_output: 'commit',
          approval_required: true,
          status: 'BLOCKED_BY_AUTHORITY',
          parallel_group: null,
        }],
      },
    }).plan.nodes.find(node => node.authority_requirement === 'COMMANDER')
  results.push(check(
    'ENGINE02-21',
    Boolean(authNode) && !mayExecutePlanNode(authNode!, false) && mayExecutePlanNode(authNode!, true)
      && planned.plan.grants_authority === false
      && sentinelInspectPlan(planned.plan).grants_authority === false
      && janusConsumeHierarchicalPlan(planned.plan).execution_authority === false,
    `auth=${authNode?.id} execute=${authNode ? mayExecutePlanNode(authNode, false) : 'missing'}`,
  ))

  const board = createEvidenceBoard({
    mission_id: 'm-ebc',
    mission_class: 'DEEP_RESEARCH',
    question: OBJECTIVE,
    agents: ['PULSAR', 'LUMEN', 'AURORA'],
    ttl_seconds: 60,
    budget_tokens: 1000,
    budget_ms: 1000,
  })
  const ebcPublic = attachCouncilEnginePublic({
    board,
    lumen: [],
    aurora: synthesizeAurora(boardSnapshot(board), 'UNVERIFIED', 0),
    mission_class: 'DEEP_RESEARCH',
  })
  const overlay = attachCouncilEngine02Public({
    mission_id: 'm-ebc',
    objective: OBJECTIVE,
    ebc_satisfied: false,
    remaining_evidence_gap: ['primary source'],
  })
  results.push(check(
    'ENGINE02-22',
    ebcPublic.ebc_canonical === true && overlay.ebc_canonical === true && overlay.grants_authority === false && overlay.atlas_role === 'ATLAS',
    `ebc=${ebcPublic.schema} e02=${overlay.schema}`,
  ))

  const discovery = planResearchDiscovery({ mission_id: 'm-e01', question: OBJECTIVE })
  results.push(check(
    'ENGINE02-23',
    ENGINE_01_VERSION === 'council-engine-01.v1'
      && ENGINE_02_VERSION === 'council-engine-02.v1'
      && discovery.domain === 'ai_ml_research'
      && overlay.receipts.every(row => row.version === ENGINE_02_VERSION),
    `e01=${ENGINE_01_VERSION} domain=${discovery.domain} receipts=${overlay.receipts.map(row => row.engine).join(',')}`,
  ))

  const hist = createSimulatedSessionState()
  simulateSelectSession(hist, 'sess-hist', [{ messageType: 'user', content: 'old research' }])
  const hydrate = historyHydrationRequest('sess-hist')
  results.push(check(
    'ENGINE02-24',
    hydrate.startsMission === false
      && hydrate.method === 'GET'
      && hist.startedMission === false
      && sidebarPaneIdentitiesAgree({ sidebarSessionId: hist.activeSessionId, paneOwnerId: hist.transcriptOwnerId }),
    `mission=${hist.startedMission} method=${hydrate.method}`,
  ))

  const overlap = measureParallelOverlap([
    { task_id: 's2a', started_at: '2026-09-23T11:00:00.000Z', completed_at: '2026-09-23T11:00:08.000Z', depends_on: ['s1'] },
    { task_id: 's2b', started_at: '2026-09-23T11:00:01.000Z', completed_at: '2026-09-23T11:00:09.000Z', depends_on: ['s1'] },
  ])
  results.push(check(
    'ENGINE02-PARALLEL-MEASURED',
    overlap.overlap_ms > 0 && overlap.max_local_model === 1 && overlap.claimed_parallel,
    `overlap_ms=${overlap.overlap_ms}`,
  ))

  const facing = auroraFacingFromEngines02({ evidence_state: 'verified facts with remaining uncertainty', tool_selection: gain })
  results.push(check(
    'ENGINE02-AURORA-HIDE',
    facing.hides_engine_internals && facing.commander_authority === 'REQUIRED_FOR_ACTION' && !/information.gain|plan tree/i.test(facing.commander_facing.join(' ')),
    facing.commander_facing.join(' | '),
  ))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCouncilEngine02Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_ENGINE_02 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
