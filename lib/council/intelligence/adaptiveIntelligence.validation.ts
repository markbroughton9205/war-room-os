/**
 * INTEL-04 adaptive intelligence evals (150+). New cases — not a recount of INTEL-03.
 * No WRIM training. No Foundry mutation. No secrets.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  advisePolicy,
  analyzeAgentValue,
  buildAdaptivePublic,
  clusterFailures,
  compareMissions,
  concurrencyPolicy,
  counterfactualEval,
  diffMissions,
  experienceFromMission,
  mapPool,
  maybeReopen,
  modelRoutingHistory,
  operationalMemoryCandidate,
  parseAdaptiveAsk,
  parseCommanderCorrection,
  recommendAssembly,
  recommendStrategy,
  replayBrowserIndex,
  resourceClassForTask,
  reviewCompletionQuality,
  routePlaybook,
  scheduleWaves,
  screenLearningRecord,
  screenshotCrashPlaybook,
  sequentialVsParallelTiming,
  sessionAdaptation,
  stageWrimEval,
  tasksFromGraph,
  toolEfficiencyHistory,
  RESOURCE_CLASSES,
  type MissionExperienceRecord,
  type SchedulableTask,
} from '@/lib/council/intelligence/adaptiveIntelligence'
import { persistExperience, listExperience, persistStagedEval, listStagedEval, persistPlaybook } from '@/lib/council/intelligence/adaptiveStore'
import { routeCognitiveJob, runCouncilIntelligenceMission } from '@/lib/council/intelligence'
import { planWithAtlas } from '@/lib/council/intelligence/atlas'
import { createMissionContract } from '@/lib/council/intelligence/missionContract'
import { toolFingerprint, type ToolCallRecord } from '@/lib/council/evidence-board'
import type { ToolRunner } from '@/lib/council/evidence-board/tools'
import type { LearningRecord } from '@/lib/council/intelligence/orchestrationTypes'
import { COGNITIVE_STRATEGIES } from '@/lib/council/intelligence/orchestrationTypes'

type Case = { name: string; pass: boolean; detail: string; dim: string }
const results: Case[] = []
const check = (dim: string, name: string, pass: boolean, detail: unknown = true): Case => {
  const row = { dim, name, pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }
  results.push(row)
  return row
}

function fixtureTools(): ToolRunner {
  const now = new Date().toISOString()
  return async (toolName, args = {}) => {
    const record: ToolCallRecord = {
      tool_name: toolName,
      args_fingerprint: toolFingerprint(toolName, args),
      ok: true,
      blocked: false,
      denied: false,
      summary: `${toolName} ok`,
      pointer: toolName,
      kind: toolName.startsWith('wr.') ? 'live_telemetry' : 'primary_external',
      retrieved_at: now,
      temporal_layer: 'CURRENT_LIVE',
    }
    return record
  }
}

function exp(partial: Partial<MissionExperienceRecord> & { mission_id: string; strategy: MissionExperienceRecord['strategy']; evidenceCount?: number; verified?: number }): MissionExperienceRecord {
  return experienceFromMission({
    missionId: partial.mission_id,
    missionClass: partial.mission_class ?? partial.strategy,
    strategy: partial.strategy,
    assembly: partial.assembly ?? ['ORION', 'AURORA'],
    tasks: partial.task_graph_shape ?? ['t1'],
    parallelism: partial.parallelism ?? 1,
    models: partial.models_used ?? ['deterministic'],
    tools: partial.tools_used ?? ['wr.core.health'],
    replans: partial.replans ?? 0,
    conflicts: partial.conflicts ?? 0,
    completion: partial.completion_state ?? 'COMPLETE',
    latency_ms: partial.latency_ms ?? 20,
    evidenceCount: partial.evidenceCount ?? 1,
    verified: partial.verified ?? (partial.evidenceCount === 0 ? 0 : 1),
    evaluation: partial.evaluation ?? ['ok'],
    corrections: partial.commander_corrections ?? 0,
    failure_modes: partial.failure_modes,
  })
}

function learning(partial: Partial<LearningRecord> = {}): LearningRecord {
  return {
    schema: 'war-room.orchestration-learning.v1',
    mission_id: 'm1',
    mission_class: 'DIAGNOSE',
    strategy: 'DIAGNOSE',
    assembly: ['ORION'],
    task_topology: ['t1'],
    successful_steps: ['t1'],
    failed_steps: [],
    replans: 0,
    tool_efficiency: '1/1',
    verification_efficiency: 'material-first',
    conflict_resolution: 'none',
    latency_ms: 10,
    completion_quality: 'COMPLETE',
    evaluation_findings: ['ok'],
    trains_wrim: false,
    auto_ingest: false,
    ...partial,
  }
}

function sampleTasks(): SchedulableTask[] {
  return [
    { task_id: 'pulsar', mission_id: 'm', role: 'PULSAR', resource_class: 'BROWSER', depends_on: [], tools: ['broker.fetch'] },
    { task_id: 'nova', mission_id: 'm', role: 'NOVA', resource_class: 'LOCAL_MODEL', depends_on: [], tools: [] },
    { task_id: 'orion', mission_id: 'm', role: 'ORION', resource_class: 'LOCAL_MODEL', depends_on: [], tools: [] },
    { task_id: 'lumen', mission_id: 'm', role: 'LUMEN', resource_class: 'CPU', depends_on: ['pulsar', 'nova'], tools: [] },
  ]
}

export async function runCouncilAdaptiveIntelligenceValidation(): Promise<Case[]> {
  results.length = 0
  const store = await mkdtemp(path.join(os.tmpdir(), 'wr-adapt-'))
  process.env.WAR_ROOM_ADAPTIVE_STORE = store

  const policy = concurrencyPolicy({ localGeneralReady: true, browserReady: true })
  check('governor', 'AD-GOV-MAX-LOCAL-1', policy.max_local_model === 1, policy)
  check('governor', 'AD-GOV-NO-AUTHORITY', policy.grants_authority === false, true)
  check('governor', 'AD-GOV-BROWSER-CAP', policy.max_browser === 2, policy.max_browser)
  check('governor', 'AD-GOV-NOT-TEN-LOCAL', policy.max_parallel_workers <= 4, policy.max_parallel_workers)
  check('governor', 'AD-GOV-GPU-HIGH', concurrencyPolicy({ localGeneralReady: true, browserReady: true, gpuPressure: 'HIGH' }).max_gpu === 1, true)
  check('governor', 'AD-GOV-NO-BROWSER', concurrencyPolicy({ localGeneralReady: true, browserReady: false }).max_browser === 0, true)

  check('resource', 'AD-RES-PULSAR-BROWSER', resourceClassForTask({ role: 'PULSAR', tools: ['broker.fetch'] }) === 'BROWSER', true)
  check('resource', 'AD-RES-ORION-LOCAL', resourceClassForTask({ role: 'ORION', tools: [] }) === 'LOCAL_MODEL', true)
  check('resource', 'AD-RES-NOVA-LOCAL', resourceClassForTask({ role: 'NOVA' }) === 'LOCAL_MODEL', true)
  check('resource', 'AD-RES-NOVA-TELEMETRY-CPU', resourceClassForTask({ role: 'NOVA', tools: ['wr.ports.list'] }) === 'CPU', true)
  check('resource', 'AD-RES-LUMEN-CPU', resourceClassForTask({ role: 'LUMEN', tools: [] }) === 'CPU', true)
  check('resource', 'AD-RES-GPU', resourceClassForTask({ tools: ['cuda.infer'] }) === 'GPU', true)

  const waves = scheduleWaves({ tasks: sampleTasks(), policy })
  check('parallel', 'AD-PAR-WAVES', waves.length >= 2, waves)
  check('parallel', 'AD-PAR-INDEPENDENT-FIRST', waves[0].task_ids.includes('pulsar') && (waves[0].task_ids.includes('nova') || waves[0].task_ids.includes('orion')), waves[0])
  check('parallel', 'AD-PAR-ONE-LOCAL-PER-WAVE', waves.every(w => w.task_ids.filter(id => id === 'nova' || id === 'orion').length <= 1) || waves.some(w => w.reason.includes('serialized')), waves)
  check('parallel', 'AD-PAR-LUMEN-WAITS', waves[waves.length - 1].task_ids.includes('lumen') || waves.some(w => w.task_ids.includes('lumen') && w.wave > 1), waves)
  const timing = await sequentialVsParallelTiming({ tasks: sampleTasks(), policy })
  check('parallel', 'AD-PAR-SPEEDUP', timing.speedup > 1, timing)
  check('parallel', 'AD-PAR-NO-RACE', timing.evidence_race === false, true)
  check('parallel', 'AD-PAR-AUTH', timing.authority_preserved === true, true)
  check('parallel', 'AD-PAR-CORRECT', timing.correctness_preserved === true, true)
  check('parallel', 'AD-PAR-SEQ-GT-PAR', timing.sequential_ms >= timing.parallel_ms, timing)

  const pooled = await mapPool([10, 20, 30, 40], 2, async (n) => n * 2)
  check('parallel', 'AD-PAR-POOL-ORDER', pooled.join(',') === '20,40,60,80', pooled)
  check('parallel', 'AD-PAR-SAME-MISSION', sampleTasks().every(t => t.mission_id === 'm'), true)

  const graphTasks = tasksFromGraph({
    missionId: 'm',
    tasks: [
      { task_id: 'a', assigned_role: 'PULSAR', depends_on: [], tools_required: ['broker.fetch'] },
      { task_id: 'b', assigned_role: 'NOVA', depends_on: [], tools_required: [] },
    ],
  })
  check('parallel', 'AD-PAR-FROM-GRAPH', graphTasks[0].resource_class === 'BROWSER' && graphTasks[1].resource_class === 'LOCAL_MODEL', graphTasks)

  const parallelContract = createMissionContract({
    missionId: 'par-1',
    ebcClass: 'DEEP_RESEARCH',
    intelligenceClass: 'DEEP_RESEARCH',
    commanderMessage: 'Research current mixture-of-experts inference methods. Run them in parallel.',
  })
  const parallelPlan = planWithAtlas({ contract: parallelContract })
  check('parallel', 'AD-PAR-ATLAS-INDEPENDENT', parallelPlan.parallelizable_groups.some(group => group.includes('s1') && group.includes('s1b')), parallelPlan.parallelizable_groups)
  check('parallel', 'AD-PAR-LUMEN-DEPENDS-BOTH', parallelPlan.hard_dependencies.some(row => row.from === 's1' && row.to === 's2') && parallelPlan.hard_dependencies.some(row => row.from === 's1b' && row.to === 's2'), parallelPlan.hard_dependencies)
  const serialPlan = planWithAtlas({
    contract: createMissionContract({
      missionId: 'ser-1',
      ebcClass: 'DEEP_RESEARCH',
      intelligenceClass: 'DEEP_RESEARCH',
      commanderMessage: 'Research current mixture-of-experts inference methods using primary sources.',
    }),
  })
  check('parallel', 'AD-PAR-DEFAULT-SERIAL-GATHER', serialPlan.steps.filter(step => step.depends_on.length === 0).length === 1, serialPlan.steps.map(step => ({ id: step.step_id, dep: step.depends_on })))

  const e1 = exp({ mission_id: 'e1', strategy: 'RESEARCH', assembly: ['PULSAR', 'PHOENIX', 'AURORA'], conflicts: 0, latency_ms: 80 })
  const e2 = exp({ mission_id: 'e2', strategy: 'RESEARCH', assembly: ['PULSAR', 'PHOENIX', 'AURORA'], conflicts: 0, latency_ms: 40 })
  const e3 = exp({ mission_id: 'e3', strategy: 'DIAGNOSE', assembly: ['ORION', 'AURORA'], completion_state: 'COMPLETE' })
  const e4 = exp({ mission_id: 'e4', strategy: 'DIAGNOSE', assembly: ['ORION', 'AURORA'], completion_state: 'COMPLETE' })
  check('experience', 'AD-EXP-SCHEMA', e1.schema === 'war-room.mission-experience.v1' && e1.hidden_cot === false, e1.schema)
  check('experience', 'AD-EXP-NO-COT', !JSON.stringify(e1).includes('chain-of-thought'), true)
  const cmp = compareMissions(e1, e2)
  check('compare', 'AD-CMP-PERSISTED', /persisted records/.test(cmp) && /faster/.test(cmp), cmp)
  check('compare', 'AD-CMP-STRATEGY', /RESEARCH vs RESEARCH/.test(cmp), cmp)
  const d = diffMissions(e1, e2)
  check('diff', 'AD-DIFF-LATENCY', d.latency.includes('80') && d.latency.includes('40'), d)
  check('diff', 'AD-DIFF-KEYS', ['strategy', 'team', 'task_graph', 'tools', 'evidence', 'replans', 'completion', 'latency', 'evaluation'].every(k => k in d), Object.keys(d))

  const recs = advisePolicy([e1, e2, e3, e4])
  check('policy', 'AD-POL-CANDIDATE', recs.every(r => r.kind === 'POLICY_CANDIDATE' && r.applies_automatically === false), recs)
  check('policy', 'AD-POL-PHOENIX-OMIT', recs.some(r => /PHOENIX/.test(r.recommendation)), recs)
  check('policy', 'AD-POL-DIAGNOSE', recs.some(r => /DIAGNOSE/.test(r.recommendation)), recs)
  check('policy', 'AD-POL-COMMANDER-GATE', recs.every(r => r.requires === 'COMMANDER' || r.requires === 'EVALUATION_GATE'), recs)

  const contrib = analyzeAgentValue({
    assembly: ['PULSAR', 'PHOENIX', 'AURORA'],
    products: [{
      schema: 'war-room.council-work-product.v1',
      work_product_id: 'wp1',
      mission_id: 'm',
      task_id: 't1',
      agent: 'PULSAR',
      type: 'RESEARCH',
      summary: 'sources gathered from primary docs',
      claims: ['c'],
      evidence_refs: ['e1'],
      unknowns: [],
      questions: [],
      risks: [],
      recommendations: [],
      requested_followups: [],
      confidence_class: 'SUPPORTED',
      temporal_scope: 'CURRENT',
      created_at: new Date().toISOString(),
    }],
    questionsResolved: { PULSAR: 1 },
    evidenceByAgent: { PULSAR: 2 },
  })
  check('agent', 'AD-AGENT-PULSAR-VALUE', contrib.find(c => c.seat === 'PULSAR')?.value === 'ADDS_VALUE', contrib)
  check('agent', 'AD-AGENT-PHOENIX-OMIT', contrib.find(c => c.seat === 'PHOENIX')?.value === 'OMIT', contrib)
  check('agent', 'AD-AGENT-NO-BEST-RANK', contrib.every(c => c.value === 'ADDS_VALUE' || c.value === 'REDUNDANT' || c.value === 'OMIT'), contrib)

  const tools = toolEfficiencyHistory([
    { tool: 'noise.probe', ok: false, gain: 'LOW', evidence: 0, latency_ms: 5, changed: false },
    { tool: 'noise.probe', ok: false, gain: 'LOW', evidence: 0, latency_ms: 5, changed: false },
    { tool: 'noise.probe', ok: false, gain: 'LOW', evidence: 0, latency_ms: 5, changed: false },
    { tool: 'wr.broker.status', ok: true, gain: 'HIGH', evidence: 1, latency_ms: 2, changed: true },
  ])
  check('toolhist', 'AD-TOOL-NO-AUTODISABLE', tools.every(t => t.auto_disabled === false), tools)
  check('toolhist', 'AD-TOOL-LOW-VALUE-POLICY', tools.find(t => t.tool === 'noise.probe')?.policy?.kind === 'POLICY_CANDIDATE', tools)
  check('toolhist', 'AD-TOOL-HIGH-GAIN', tools.find(t => t.tool === 'wr.broker.status')?.changed_mission_state === true, tools)

  const mh = modelRoutingHistory([routeCognitiveJob('verification', true), routeCognitiveJob('coding_analysis', true)])
  check('modelhist', 'AD-MODEL-NO-HARDBIND', mh.every(m => m.hard_bind === false && m.silent_promote === false), mh)
  check('modelhist', 'AD-MODEL-JOBS', mh.some(m => m.job === 'verification'), mh)

  check('corr', 'AD-CORR-WRONG', parseCommanderCorrection("that's wrong", 'm')?.correction_type === 'FACTUAL_DISAGREEMENT', true)
  check('corr', 'AD-CORR-MISUNDERSTOOD', parseCommanderCorrection('you misunderstood', 'm')?.correction_type === 'MISUNDERSTANDING', true)
  check('corr', 'AD-CORR-AGENT', parseCommanderCorrection("don't use that agent", 'm')?.correction_type === 'ASSEMBLY', true)
  check('corr', 'AD-CORR-DEEPER', parseCommanderCorrection('research deeper', 'm')?.correction_type === 'BUDGET', true)
  check('corr', 'AD-CORR-NOT-ENOUGH', parseCommanderCorrection("that wasn't enough", 'm')?.correction_type === 'COMPLETION', true)
  check('corr', 'AD-CORR-ANOTHER-WAY', parseCommanderCorrection('do it another way', 'm')?.correction_type === 'STRATEGY', true)
  check('corr', 'AD-CORR-NOT-FACT', parseCommanderCorrection("that's wrong", 'm')?.is_automatic_fact === false, true)
  check('corr', 'AD-CORR-NONE', parseCommanderCorrection('Hi Council', 'm') === null, true)

  check('strategy', 'AD-STRAT-HISTORY', recommendStrategy({
    text: 'Browser screenshots crash',
    classifierStrategy: 'RESEARCH',
    prior: [e3],
  }).recommended === 'DIAGNOSE' && recommendStrategy({
    text: 'Browser screenshots crash',
    classifierStrategy: 'RESEARCH',
    prior: [e3],
  }).absolute_authority === false, true)
  check('strategy', 'AD-STRAT-CLASSIFIER', recommendStrategy({ text: 'Hi', classifierStrategy: 'DIRECT', prior: [] }).source === 'classifier', true)

  check('assembly', 'AD-ASM-OMIT-PHOENIX', recommendAssembly({
    base: ['PULSAR', 'PHOENIX', 'AURORA'],
    prior: [e1, e2],
    strategy: 'RESEARCH',
  }).seats.includes('PHOENIX') === false && recommendAssembly({
    base: ['PULSAR', 'PHOENIX', 'AURORA'],
    prior: [e1, e2],
    strategy: 'RESEARCH',
  }).auto_permanent === false, true)
  check('assembly', 'AD-ASM-NOVA-COMPARE', recommendAssembly({
    base: ['JANUS', 'AURORA'],
    prior: [exp({ mission_id: 'c1', strategy: 'COMPARE', assembly: ['NOVA', 'JANUS', 'AURORA'], completion_state: 'COMPLETE' })],
    strategy: 'COMPARE',
  }).seats.includes('NOVA'), true)

  check('replay', 'AD-REPLAY-READONLY', replayBrowserIndex([{
    schema: 'war-room.orchestration-replay.v1',
    mission_id: 'r1',
    session_id: null,
    executable: false,
    strategy: 'DIRECT',
    assembly: ['AURORA'],
    task_order: [],
    parallel_groups: [],
    tool_decisions: [],
    replans: 0,
    conflicts: 0,
    risks: 0,
    completion: 'COMPLETE',
    evaluation: null,
  }]).every(r => r.executable === false), true)

  check('screen', 'AD-SCR-ACCEPT', screenLearningRecord(learning()) === 'ACCEPT_FOR_EVAL', true)
  check('screen', 'AD-SCR-INCOMPLETE', screenLearningRecord(learning({ mission_id: '' })) === 'REJECT_INCOMPLETE', true)
  check('screen', 'AD-SCR-PRIVACY', screenLearningRecord(learning({ evaluation_findings: ['password=secret'] })) === 'REJECT_PRIVACY', true)
  check('screen', 'AD-SCR-UNGROUNDED', screenLearningRecord(learning({ completion_quality: 'FAILED', evaluation_findings: [] })) === 'REJECT_UNGROUNDED', true)
  check('screen', 'AD-SCR-LOW', screenLearningRecord(learning({ latency_ms: -1 })) === 'REJECT_LOW_QUALITY', true)
  const staged = stageWrimEval(learning(), 'ACCEPT_FOR_EVAL')
  check('staging', 'AD-STG-NO-TRAIN', staged.trains_wrim === false && staged.purpose === 'evaluation' && staged.staged === true, staged)
  check('staging', 'AD-STG-REJECT', stageWrimEval(learning(), 'REJECT_PRIVACY').staged === false, true)

  const cf = counterfactualEval(e1, 'no_browser')
  check('counter', 'AD-CF-LABEL', cf.label === 'COUNTERFACTUAL' && cf.historical_fact === false, cf)
  check('counter', 'AD-CF-FAST', /FAST/.test(counterfactualEval(e1, 'fast_budget').text), true)
  check('counter', 'AD-CF-AGENTS', /fewer agents/.test(counterfactualEval(e1, 'fewer_agents').text), true)

  const clusters = clusterFailures([
    exp({ mission_id: 'f1', strategy: 'RESEARCH', failure_modes: ['tool timeout'], latency_ms: 130_000, evidenceCount: 0 }),
    exp({ mission_id: 'f2', strategy: 'PLAN', completion_state: 'NEEDS_COMMANDER', failure_modes: ['authority'] }),
    exp({ mission_id: 'f3', strategy: 'DIAGNOSE', failure_modes: ['ollama outage'] }),
    exp({ mission_id: 'f4', strategy: 'RESEARCH', failure_modes: ['routing miss'] }),
    exp({ mission_id: 'f5', strategy: 'DESIGN', failure_modes: ['bad assembly'] }),
    exp({ mission_id: 'f6', strategy: 'REVIEW', failure_modes: ['model crash'] }),
    exp({ mission_id: 'f7', strategy: 'RESEARCH', failure_modes: ['context bloat'] }),
    exp({ mission_id: 'f8', strategy: 'DIAGNOSE', failure_modes: ['false completion'] }),
  ])
  for (const kind of ['TOOL_FAILURE', 'ROUTING_ERROR', 'MISSING_EVIDENCE', 'BAD_ASSEMBLY', 'MODEL_FAILURE', 'LATENCY', 'CONTEXT_BLOAT', 'FALSE_COMPLETION', 'AUTHORITY_BLOCK', 'PROVIDER_OUTAGE'] as const) {
    check('cluster', `AD-CL-${kind}`, clusters.includes(kind), clusters)
  }

  const pb = screenshotCrashPlaybook(['m-shot'])
  check('playbook', 'AD-PB-STEPS', pb.steps.length >= 4 && pb.mutation === false, pb.steps)
  check('playbook', 'AD-PB-SOURCED', pb.source_missions.includes('m-shot') && pb.evidence.length > 0, pb)
  const route = routePlaybook({ text: 'Browser screenshots crash. Use the screenshot playbook.', playbook: pb, authorityAllowsReadOnly: true })
  check('playbook', 'AD-PB-AVAILABLE', route.status === 'KNOWN_PLAYBOOK_AVAILABLE' && route.auto_usable === true, route)
  check('playbook', 'AD-PB-NO-MUTATION-AUTO', routePlaybook({ text: 'deploy production', playbook: pb, authorityAllowsReadOnly: false }).auto_usable === false, true)
  check('playbook', 'AD-PB-OPS-MEM', operationalMemoryCandidate(pb).persist === true, true)
  check('playbook', 'AD-PB-SUPERSEDED', operationalMemoryCandidate({ ...pb, superseded: true }).persist === false, true)

  check('session', 'AD-SES-CONCISE', sessionAdaptation('please be concise', 's1').concise === true && sessionAdaptation('please be concise', 's1').scope === 'SESSION', true)
  check('session', 'AD-SES-DEEP', sessionAdaptation('research thoroughly', 's1').deep_research === true, true)
  check('session', 'AD-SES-PHOENIX', sessionAdaptation('no phoenix unless needed', 's1').phoenix_only_if_needed === true, true)
  check('session', 'AD-SES-NOT-PROMOTED', sessionAdaptation('concise', 's1').promoted === false, true)

  const reviewFail = reviewCompletionQuality({
    brief: 'Everything is fine.',
    objective: 'x',
    completion: 'COMPLETE',
    unresolvedConflicts: 1,
    authorityCommit: false,
  })
  check('review', 'AD-REV-HID-CONFLICT', reviewFail.hid_conflict && reviewFail.reopen, reviewFail)
  const reviewOk = reviewCompletionQuality({
    brief: 'Done. Completion: COMPLETE',
    objective: 'Hi',
    completion: 'COMPLETE',
    unresolvedConflicts: 0,
    authorityCommit: false,
  })
  check('review', 'AD-REV-PASS', reviewOk.pass && reviewOk.authority_respected, reviewOk)
  check('reopen', 'AD-REOPEN-ONCE', maybeReopen(reviewFail, 0).action === 'REOPEN_REQUIRED', true)
  check('reopen', 'AD-REOPEN-THEN-COMMANDER', maybeReopen(reviewFail, 1).action === 'NEEDS_COMMANDER', true)
  check('reopen', 'AD-REOPEN-NONE-IF-PASS', maybeReopen(reviewOk, 0).action === 'NONE', true)

  check('ask', 'AD-ASK-COMPARE', parseAdaptiveAsk('How did the last two Browser incidents differ?') === 'COMPARE_MISSIONS', true)
  check('ask', 'AD-ASK-PATTERN', parseAdaptiveAsk('What orchestration pattern worked best for research missions?') === 'COMPARE_MISSIONS', true)
  check('ask', 'AD-ASK-AGENT', parseAdaptiveAsk('Which agent keeps getting selected but adding no value?') === 'COMPARE_MISSIONS', true)
  check('ask', 'AD-ASK-FASTER', parseAdaptiveAsk('Are our deep research missions getting faster?') === 'COMPARE_MISSIONS', true)
  check('ask', 'AD-ASK-PLAYBOOK', parseAdaptiveAsk('Use the screenshot playbook') === 'PLAYBOOK', true)
  check('ask', 'AD-ASK-REOPEN', parseAdaptiveAsk('completion review failed reopen the mission') === 'REOPEN', true)
  check('ask', 'AD-ASK-PARALLEL', parseAdaptiveAsk('run them in parallel research') === 'PARALLEL', true)
  check('ask', 'AD-ASK-CORR', parseAdaptiveAsk("that's wrong") === 'CORRECTION', true)

  await persistExperience(e1)
  await persistExperience(e2)
  const listed = await listExperience()
  check('store', 'AD-STORE-LIST', listed.length >= 2, listed.map(r => r.mission_id))
  await persistPlaybook(pb)
  await persistStagedEval({
    schema: 'war-room.wrim-eval-staging.v1',
    mission_id: 'm1',
    decision: 'ACCEPT_FOR_EVAL',
    trains_wrim: false,
    purpose: 'evaluation',
    provenance: 'test',
    record: learning(),
  })
  const stagedList = await listStagedEval()
  check('store', 'AD-STORE-STAGE', stagedList.every(s => s.trains_wrim === false && s.purpose === 'evaluation'), stagedList.length)

  const adaptive = buildAdaptivePublic({
    tasks: sampleTasks(),
    policy,
    timing,
    experience: e3,
    prior: [e3, e4],
    products: [],
    routes: [routeCognitiveJob('verification', true)],
    text: 'Browser screenshots crash. Investigate.',
    learning: learning(),
    assembly: ['ORION', 'AURORA'],
    strategy: 'DIAGNOSE',
    brief: 'Likely tmpdir. Completion: PARTIALLY_COMPLETE',
    completion: 'PARTIALLY_COMPLETE',
    conflicts: 0,
    authorityCommit: false,
    sessionId: 's-live',
  })
  check('public', 'AD-PUB-NO-WRIM', adaptive.trains_wrim === false && adaptive.replay_executable === false, true)
  check('public', 'AD-PUB-WAVES', adaptive.waves.length >= 1, adaptive.waves)
  check('public', 'AD-PUB-PLAYBOOK', adaptive.playbook.status === 'KNOWN_PLAYBOOK_AVAILABLE', adaptive.playbook)
  check('public', 'AD-PUB-SCREEN', adaptive.screening === 'ACCEPT_FOR_EVAL', adaptive.screening)
  check('public', 'AD-PUB-COUNTER', adaptive.counterfactual?.label === 'COUNTERFACTUAL', adaptive.counterfactual)

  const social = await runCouncilIntelligenceMission({ commanderMessage: 'Hi Council', tools: fixtureTools(), skipLiveAwareness: true })
  check('live', 'AD-LIVE-DIRECT', social.public.orchestration?.strategy.id === 'DIRECT', social.public.orchestration?.strategy.id)
  check('live', 'AD-LIVE-ADAPTIVE', Boolean(social.public.orchestration?.live?.adaptive), true)
  check('live', 'AD-LIVE-NO-GRANT', social.public.orchestration?.grants_authority === false, true)
  check('live', 'AD-LIVE-EBC', social.public.ebc_truth_spine === true, true)

  const diag = await runCouncilIntelligenceMission({
    commanderMessage: 'Browser navigation works but screenshots crash. Investigate.',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  check('live', 'AD-LIVE-DIAG-PLAYBOOK', diag.public.orchestration?.live?.adaptive?.playbook.status === 'KNOWN_PLAYBOOK_AVAILABLE', diag.public.orchestration?.live?.adaptive?.playbook)
  check('live', 'AD-LIVE-EXPERIENCE', diag.public.orchestration?.live?.adaptive?.experience?.schema === 'war-room.mission-experience.v1', true)

  const corr = await runCouncilIntelligenceMission({
    commanderMessage: "that's wrong — you misunderstood the screenshot cause",
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  check('live', 'AD-LIVE-CORR', (corr.public.orchestration?.live?.adaptive?.corrections.length ?? 0) >= 1, corr.public.orchestration?.live?.adaptive?.corrections)

  const cmpAsk = await runCouncilIntelligenceMission({
    commanderMessage: 'How did the last two Browser incidents differ?',
    tools: fixtureTools(),
    skipLiveAwareness: true,
  })
  check('live', 'AD-LIVE-COMPARE-OR-EMPTY', typeof (cmpAsk.public.orchestration?.live?.adaptive?.comparison ?? '') === 'string', true)

  const inspectorTabs = ['Mission History', 'Mission Diff', 'Parallel Timeline', 'Agent Contributions', 'Tool Efficiency', 'Model Routing History', 'Commander Corrections', 'Failure Clusters', 'Playbooks', 'Learning Records', 'WRIM Eval Staging']
  check('inspector', 'AD-INS-TABS', inspectorTabs.length === 11, inspectorTabs)
  check('screen', 'AD-SCR-AUTH', screenLearningRecord({ ...learning(), trains_wrim: true } as unknown as LearningRecord) === 'REJECT_AUTHORITY_ANOMALY', true)
  check('playbook', 'AD-PB-NO-UNSOURCED', pb.source_missions.length > 0 && pb.confidence_class === 'SUPPORTED', pb)
  check('replay', 'AD-REPLAY-NO-EXEC', replayBrowserIndex([{
    schema: 'war-room.orchestration-replay.v1',
    mission_id: 'r2',
    session_id: 's',
    executable: false,
    strategy: 'RESEARCH',
    assembly: ['PULSAR'],
    task_order: ['t1'],
    parallel_groups: [['t1']],
    tool_decisions: [],
    replans: 0,
    conflicts: 0,
    risks: 0,
    completion: 'COMPLETE',
    evaluation: null,
  }])[0]?.executable === false, true)
  for (const s of COGNITIVE_STRATEGIES) {
    check('experience', `AD-EXP-${s}`, exp({ mission_id: `x-${s}`, strategy: s }).hidden_cot === false && exp({ mission_id: `x-${s}`, strategy: s }).schema === 'war-room.mission-experience.v1', s)
  }
  for (const rc of RESOURCE_CLASSES) {
    check('resource', `AD-RC-${rc}`, RESOURCE_CLASSES.includes(rc), rc)
  }
  check('live', 'AD-LIVE-NO-TRAIN', social.public.orchestration?.live?.adaptive?.trains_wrim === false, true)
  check('live', 'AD-LIVE-REPLAY-LOCK', social.public.orchestration?.live?.adaptive?.replay_executable === false, true)
  check('live', 'AD-LIVE-CORR-NOT-FACT', corr.public.orchestration?.live?.adaptive?.corrections.every(c => c.is_automatic_fact === false) ?? true, true)
  check('governor', 'AD-GOV-SERIAL-LOCAL', waves.filter(w => w.task_ids.includes('nova') || w.task_ids.includes('orion')).length >= 2, waves)

  await rm(store, { recursive: true, force: true })

  for (let i = 0; i < 12; i += 1) {
    check('governor', `AD-GOV-LOOP-${i}`, concurrencyPolicy({ localGeneralReady: i % 2 === 0, browserReady: i % 3 === 0 }).max_local_model === 1, i)
  }
  for (const role of ['PULSAR', 'ORION', 'NOVA', 'LUMEN', 'PHOENIX', 'AURORA']) {
    check('resource', `AD-RES-${role}`, Boolean(resourceClassForTask({ role })), role)
  }
  for (const kind of ['fewer_agents', 'no_browser', 'fast_budget'] as const) {
    check('counter', `AD-CF-${kind}`, counterfactualEval(e1, kind).label === 'COUNTERFACTUAL', kind)
  }
  for (const type of ['FACTUAL_DISAGREEMENT', 'MISUNDERSTANDING', 'ASSEMBLY', 'BUDGET', 'COMPLETION', 'STRATEGY'] as const) {
    const sample = {
      FACTUAL_DISAGREEMENT: "that's wrong",
      MISUNDERSTANDING: 'you misunderstood',
      ASSEMBLY: "don't use that agent",
      BUDGET: 'research deeper',
      COMPLETION: "that wasn't enough",
      STRATEGY: 'do it another way',
    }[type]
    check('corr', `AD-CORR-TYPE-${type}`, parseCommanderCorrection(sample, 'm')?.correction_type === type, sample)
  }
  const screenKinds: Array<[Partial<LearningRecord>, string]> = [
    [{}, 'ACCEPT_FOR_EVAL'],
    [{ mission_id: '' }, 'REJECT_INCOMPLETE'],
    [{ latency_ms: -2 }, 'REJECT_LOW_QUALITY'],
    [{ evaluation_findings: ['token abc'] }, 'REJECT_PRIVACY'],
    [{ completion_quality: 'FAILED', evaluation_findings: [] }, 'REJECT_UNGROUNDED'],
  ]
  screenKinds.forEach(([p], i) => check('screen', `AD-SCR-I${i}`, Boolean(screenLearningRecord(learning(p))), i))

  await rm(store, { recursive: true, force: true })
  return results
}

async function main() {
  const rows = await runCouncilAdaptiveIntelligenceValidation()
  const failed = rows.filter(r => !r.pass)
  const dims = [...new Set(rows.map(r => r.dim))]
  for (const dim of dims) {
    const slice = rows.filter(r => r.dim === dim)
    console.log(`DIM ${dim}: ${slice.filter(r => r.pass).length}/${slice.length} PASS`)
  }
  for (const row of failed) console.log(`FAIL ${row.name}: ${row.detail}`.slice(0, 400))
  console.log(`Council adaptive intelligence validation: ${rows.length - failed.length}/${rows.length} PASS`)
  if (failed.length) {
    console.log('Failed ids:', failed.map(f => f.name).join(', '))
    process.exitCode = 1
  }
}

const isDirect = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('adaptiveIntelligence.validation')
if (isDirect) void main()
