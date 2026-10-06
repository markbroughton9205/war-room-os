/**
 * Council Intelligence pipeline.
 * Wraps existing Evidence-Board Council. Does not rebuild EBC, seats, or providers.
 */

import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { runEvidenceBoardCouncil, type EbcRunInput } from '@/lib/council/evidence-board/orchestrator'
import { createToolRunner } from '@/lib/council/evidence-board/tools'
import type { EbcMissionResult, EbcPublicSnapshot } from '@/lib/council/evidence-board/types'
import { createMissionContract } from './missionContract'
import { planWithAtlas } from './atlas'
import { analyzeScenarios, skippedJanus } from './janus'
import { reviewWithSentinel, skippedSentinel } from './sentinel'
import { seedWarRoomSelfKnowledge, ingestVerifiedKnowledge } from './knowledgeGraph'
import { gateMissionMemory } from './memoryGate'
import { listIndexedCapabilities } from './capabilityRegistry'
import { governPlan } from './toolGovernor'
import { createReceipt } from './receipts'
import { collectSelfAwareness } from './selfAwareness'
import { buildStructuredRationale, formatRationaleForCommander } from './rationale'
import { resolveIntelligenceRouting, isRationaleAsk } from './routing'
import { DEFAULT_ROLE_FULFILLMENT } from './roles'
import { runCouncilExecutive } from './executive'
import { selectCognitiveStrategy } from './strategy'
import { parseLiveHarness, persistLiveIfEnabled, prepareLiveCognition, shouldInvokeJanusLive } from './liveCognition'
import { budgetAllowsOptional, initBudget } from './budget'
import {
  invokeEngine03ForProduction,
  mapEbcToolToEngine03,
  wrapToolRunnerForEngine03,
} from '@/lib/council/engines/production/invoke'
import { bindEngine04ToLive } from '@/lib/council/engines/production/horizon'
import { attachCouncilEngine04Public } from '@/lib/council/engines/integration/executive04'
import { bindEngine05ToLive, parseEngine05Command } from '@/lib/council/engines/production/evaluate'
import { bindEngineFinalToLive } from '@/lib/council/engines/production/finalBind'
import type { Engine03ProductionPhase } from '@/lib/council/engines/production/invoke'
import {
  buildAdaptivePublic,
  compareMissions,
  concurrencyPolicy,
  diffMissions,
  experienceFromMission,
  operationalMemoryCandidate,
  parseAdaptiveAsk,
  parseCommanderCorrection,
  screenLearningRecord,
  screenshotCrashPlaybook,
  sequentialVsParallelTiming,
  stageWrimEval,
  tasksFromGraph,
  type MissionExperienceRecord,
} from './adaptiveIntelligence'
import { listExperience, persistExperience, persistPlaybook, persistStagedEval } from './adaptiveStore'
import { INTELLIGENCE_SCHEMA, type CouncilIntelligencePublic, type ExecutionReceipt, type IntelligenceMetrics, type KnowledgeGraph, type MemoryCandidate, type SelfAwarenessSnapshot } from './types'
import { sourceQualityFromEvidenceKind, truthFromEbcStatus, temporalFromEbcLayer } from './temporal'
import { formatSystemStatusCommanderBrief } from '@/lib/council/commander-chat/systemStatusBrief'
import {
  generateConversationalAurora,
  wantsRuntimeTruthForConversation,
} from '@/lib/council/commander-chat/conversationalAurora'

export type CouncilIntelligenceResult = {
  ebc: EbcMissionResult | null
  public: CouncilIntelligencePublic
  commander_brief: string
  snapshot: EbcPublicSnapshot | null
}

function evidenceClassesFromEbc(ebc: EbcMissionResult | null): string[] {
  if (!ebc) return []
  const classes: string[] = []
  for (const row of ebc.board.evidence) {
    if (row.tool_name === 'wr.ports.list' && row.ok) {
      classes.push('live_telemetry', '3847_pid', '3848_pid')
    }
    if (row.tool_name === 'wr.core.health' && row.ok) classes.push('live_telemetry')
    if (row.tool_name === 'wr.council.backend' && row.ok) classes.push('council_backend_state', 'live_telemetry')
    if (row.kind === 'primary_external' && row.ok) classes.push('primary_external')
    if (row.tool_name === 'wr.broker.status' && row.ok) classes.push('live_telemetry')
  }
  return [...new Set(classes)]
}

export async function runCouncilIntelligenceMission(input: EbcRunInput & {
  skipEbc?: boolean
  skipLiveAwareness?: boolean
  replanTrigger?: import('./replan').ReplanTrigger | null
  unavailableTool?: string | null
  injectedConflicts?: Array<{ claim: string; evidenceA: string[]; evidenceB: string[] }>
  engine03?: {
    skip?: boolean
    proof_level?: 'UNIT' | 'INTEGRATION' | 'LIVE_INSTALLED'
    force_attempts?: import('@/lib/council/engines/live-execution/types').LiveExecutionInput['force_attempts']
    onPhase?: (phase: Engine03ProductionPhase) => void
  }
  conversationId?: string | null
  sessionId?: string | null
  priorTurns?: readonly string[]
}): Promise<CouncilIntelligenceResult> {
  const started = Date.now()
  const classification = classifyEvidenceBoardMission({
    commanderMessage: input.commanderMessage,
    missionId: input.missionId,
    now: input.now,
  })
  const routing = resolveIntelligenceRouting({
    text: input.commanderMessage,
    ebcClass: classification.mission_class,
  })
  const contract0 = createMissionContract({
    missionId: classification.mission_id,
    ebcClass: classification.mission_class,
    intelligenceClass: routing.intelligence_class,
    commanderMessage: input.commanderMessage,
    requiredTools: classification.required_tools,
    lightweight: routing.mission_contract !== 'full',
  })
  const atlas0 = routing.atlas ? planWithAtlas({ contract: contract0 }) : null
  const harness = parseLiveHarness(input.commanderMessage)
  const unavailableTool = input.unavailableTool ?? harness.unavailableTool
  const injectedConflicts = input.injectedConflicts ?? harness.injectedConflicts
  const livePrep = prepareLiveCognition({
    text: input.commanderMessage,
    contract: contract0,
    routing,
    plan: atlas0,
    forceUnavailable: unavailableTool,
    injectedConflicts: injectedConflicts.length,
  })
  const contract = livePrep.contract
  const atlas = atlas0
  const atlasForLive = atlas ?? planWithAtlas({ contract })

  const social = classification.mission_class === 'SOCIAL_CHECKIN'
  const atlas_plan = {
    steps: atlasForLive.steps.map(step => ({
      step_id: step.step_id,
      title: step.title,
      purpose: step.purpose,
      depends_on: [...step.depends_on],
      required_capabilities: [...step.required_capabilities],
      required_evidence: [...step.required_evidence],
      expected_output: step.expected_output,
      approval_required: step.approval_required,
      status: step.status,
      parallel_group: step.parallel_group,
    })),
    parallelizable_groups: atlasForLive.parallelizable_groups,
  }
  const mappedCaps = [
    ...atlasForLive.steps.flatMap(step => step.required_capabilities),
    ...classification.required_tools.map(mapEbcToolToEngine03),
  ]
  const available_tools = [...new Set(mappedCaps.filter(Boolean))]
  const remaining_evidence_gap = social
    ? []
    : (livePrep.questions.questions.map(row => row.text).filter(Boolean).slice(0, 6).length
      ? livePrep.questions.questions.map(row => row.text).slice(0, 6)
      : classification.required_tools.map(tool => `need ${tool}`))
  const tool_health = unavailableTool
    ? { [mapEbcToolToEngine03(unavailableTool)]: 'DEAD' as const }
    : undefined

  const horizonPre = await bindEngine04ToLive({
    mission_id: classification.mission_id,
    objective: contract.objective || input.commanderMessage,
    commanderMessage: input.commanderMessage,
    conversation_id: input.conversationId ?? null,
    session_id: input.sessionId ?? null,
    mission_type: classification.mission_class,
    plan_snapshot: atlas_plan,
  })
  const liveMissionId = horizonPre.mission.mission_id
  const approvedFingerprints = horizonPre.mission.authority_state === 'APPROVED'
    ? horizonPre.mission.pending_approval_refs.filter(row => row.state === 'APPROVED').map(row => row.action_fingerprint)
    : []

  let productionLive: Awaited<ReturnType<typeof invokeEngine03ForProduction>> | null = null
  if (horizonPre.execute_live && !input.skipEbc && routing.ebc && input.engine03?.skip !== true) {
    productionLive = await invokeEngine03ForProduction({
      mission_id: liveMissionId,
      objective: contract.objective || input.commanderMessage,
      mission_class: classification.mission_class,
      atlas_plan: (horizonPre.mission.plan_snapshot as typeof atlas_plan | null) ?? atlas_plan,
      remaining_evidence_gap: remaining_evidence_gap.length ? remaining_evidence_gap : undefined,
      available_tools: available_tools.length ? available_tools : ['system.health', 'research.web', 'browser.fetch', 'verification', 'synthesis'],
      ebc_satisfied: social || horizonPre.current_verified_memory,
      tools: input.tools,
      proof_level: input.engine03?.proof_level,
      tool_health,
      force_attempts: input.engine03?.force_attempts,
      onPhase: input.engine03?.onPhase,
      skip_task_ids: horizonPre.skip_task_ids,
      completed_dispatch_ids: horizonPre.completed_dispatch_ids,
      current_verified_memory: horizonPre.current_verified_memory,
      stale_freshness_gap: horizonPre.refresh === 'REFRESH_REQUIRED',
      approved_fingerprints: approvedFingerprints,
      spent: {
        tool_calls: horizonPre.mission.budget_state.tool_calls_used,
        retry_count: horizonPre.mission.budget_state.retry_count,
        latency_ms: horizonPre.mission.budget_state.wall_ms_used,
        local_model_calls: horizonPre.mission.budget_state.local_model_calls,
        external_calls: horizonPre.mission.budget_state.external_calls,
      },
    })
  }

  const ebcTools = productionLive
    ? wrapToolRunnerForEngine03(
      input.tools ?? createToolRunner({
        ...input.toolOptions,
        denyBrowser: productionLive.unexpected_failure || input.toolOptions?.denyBrowser,
        disabledTools: productionLive.unexpected_failure
          ? [...(input.toolOptions?.disabledTools ?? []), 'broker.fetch']
          : input.toolOptions?.disabledTools,
      }),
      productionLive.live,
      productionLive.unexpected_failure,
    )
    : input.tools

  const ebc = input.skipEbc || !routing.ebc || !horizonPre.execute_live
    ? null
    : await runEvidenceBoardCouncil({
      ...input,
      tools: ebcTools,
      missionId: liveMissionId,
      live: livePrep.hooks,
    })

  const strategyHint = selectCognitiveStrategy({
    text: input.commanderMessage,
    intelligenceClass: routing.intelligence_class,
    ebcClass: classification.mission_class,
  })
  const evidenceIds = ebc?.board.evidence.filter(row => row.ok).map(row => row.evidence_id) ?? []
  const budgetState = initBudget(input.commanderMessage, strategyHint)
  const invokeJanus = (routing.janus || strategyHint.scenario_requirement)
    && shouldInvokeJanusLive(strategyHint.id, budgetAllowsOptional(budgetState.budget, 'janus'))
  const janus = invokeJanus
    ? analyzeScenarios({ contract, plan: atlas, evidenceIds })
    : skippedJanus(contract.mission_id, routing.janus ? 'not invoked' : 'routing skipped JANUS')
  const sentinel = routing.sentinel
    ? reviewWithSentinel({ contract, plan: atlas, scenarios: janus })
    : skippedSentinel(contract.mission_id, 'routing skipped SENTINEL')

  const governor = atlas ? governPlan({ contract, steps: atlas.steps, sentinel }) : []

  const receipts: ExecutionReceipt[] = []
  if (ebc) {
    for (const call of ebc.snapshot.tool_calls) {
      const startedAt = new Date(started).toISOString()
      receipts.push(createReceipt({
        missionId: contract.mission_id,
        capability: call.tool_name,
        requestedAction: call.tool_name,
        authorityResult: call.ok ? 'ALLOW' : 'DENY',
        startedAt,
        completedAt: new Date().toISOString(),
        success: call.ok,
        resultSummary: `${call.tool_name} ${call.ok ? 'ok' : 'fail'} ${call.fingerprint}`,
        evidenceIds: ebc.board.evidence.filter(row => row.tool_name === call.tool_name).map(row => row.evidence_id),
        runtimeIdentity: null,
      }))
    }
  }

  let awareness: SelfAwarenessSnapshot | null = null
  const needsAwareness = (
    routing.self_awareness
    || strategyHint.runtime_knowledge
    || (classification.mission_class === 'SOCIAL_CHECKIN' && wantsRuntimeTruthForConversation(input.commanderMessage))
  ) && !input.skipLiveAwareness
  if (needsAwareness) {
    awareness = await collectSelfAwareness({
      missionId: contract.mission_id,
      bounded: routing.intelligence_class !== 'SYSTEM_STATUS',
      tryStartLocal: true,
    })
    if (awareness.install_id) {
      const classes = evidenceClassesFromEbc(ebc)
      if (awareness.runtime_3847.pid) classes.push('3847_pid')
      if (awareness.runtime_3848.pid) classes.push('3848_pid')
      classes.push('install_id')
      void classes
    }
  }

  let graph: KnowledgeGraph | null = null
  if (routing.knowledge_graph) {
    const installEvidence = ebc?.board.evidence.find(row => row.tool_name === 'wr.ports.list')?.evidence_id
    const councilEvidence = ebc?.board.evidence.find(row => row.tool_name === 'wr.council.backend')?.evidence_id
    const brokerEvidence = ebc?.board.evidence.find(row => row.tool_name === 'wr.broker.status')?.evidence_id
    graph = seedWarRoomSelfKnowledge({
      installId: awareness?.install_id ?? null,
      evidenceInstall: installEvidence,
      councilState: awareness?.local_backend_state ?? awareness?.council_state ?? (ebc?.board.claims.some(claim => /READY_LOCAL/.test(claim.text)) ? 'READY_LOCAL' : null),
      evidenceCouncil: councilEvidence,
      ebcActive: true,
      evidenceEbc: 'ebc-active',
      brokerState: ebc?.snapshot.tool_calls.some(call => call.tool_name === 'wr.broker.status' && call.ok) ? 'ACTIVE' : null,
      evidenceBroker: brokerEvidence,
    })
    graph = ingestVerifiedKnowledge(graph, {
      missionId: contract.mission_id,
      ebc,
      now: new Date().toISOString(),
    })
  }

  const candidates: MemoryCandidate[] = (ebc?.board.claims ?? []).map(claim => ({
    fact_id: claim.claim_id,
    text: claim.text,
    scope: 'MISSION' as const,
    truth_state: truthFromEbcStatus(claim.status),
    source_quality: sourceQualityFromEvidenceKind(ebc?.board.evidence.find(row => claim.evidence_ids.includes(row.evidence_id))?.kind ?? 'inference'),
    evidence_ids: claim.evidence_ids,
    sensitivity: 'INTERNAL' as const,
    temporal_state: temporalFromEbcLayer(claim.temporal_layer),
    speculative: claim.label === 'INFERENCE' || claim.status === 'UNVERIFIED',
  }))
  const memory = routing.memory_gate
    ? gateMissionMemory({ missionId: contract.mission_id, commanderText: input.commanderMessage, candidates })
    : null

  const localGeneralReady = awareness?.local_backend_state === 'READY_LOCAL'
  const liveBlocked = ebc?.snapshot.tool_calls.some(call => !call.ok) ?? false
  const executive = runCouncilExecutive({
    contract,
    routing,
    text: input.commanderMessage,
    plan: atlas,
    ebc,
    janus,
    sentinel,
    awareness,
    kgNodeIds: graph?.nodes.filter(n => n.temporal_state === 'CURRENT').map(n => n.node_id) ?? [],
    localGeneralReady,
    replanTrigger: input.replanTrigger ?? livePrep.replanTrigger ?? (liveBlocked ? 'TOOL_UNAVAILABLE' : null),
    unavailableTool: unavailableTool ?? livePrep.unavailableTool,
    injectedConflicts,
    startedAt: started,
    livePrep,
    liveExecution: productionLive?.live ?? null,
    engine03Production: productionLive ? {
      production_invoked: true,
      injection: false,
      phases: productionLive.phases,
      approval_request: productionLive.approval_request,
    } : null,
  })
  receipts.push(...executive.extra_receipts)

  const horizonPost = await bindEngine04ToLive({
    mission_id: liveMissionId,
    objective: contract.objective || input.commanderMessage,
    commanderMessage: input.commanderMessage,
    conversation_id: input.conversationId ?? null,
    session_id: input.sessionId ?? null,
    live: productionLive?.live ?? null,
    ebc_evidence_ids: ebc?.board.evidence.map(row => row.evidence_id).filter((id): id is string => Boolean(id)),
    questions: executive.public.questions.questions.map(q => ({ question_id: q.question_id, text: q.text, answer_state: q.answer_state })),
    hypotheses: executive.public.hypotheses.map(h => ({ id: h.id, statement: h.statement, status: h.status })),
    mode: 'commit',
  })
  const engines04 = attachCouncilEngine04Public({
    mission: horizonPost.mission,
    memories: horizonPost.memories,
    refresh: horizonPost.refresh,
    commander_status: horizonPost.commander_status,
  })
  const engine05Bind = bindEngine05ToLive({
    mission_id: liveMissionId,
    commanderMessage: input.commanderMessage,
    localAvailable: localGeneralReady,
    cloudAvailable: true,
    role: 'ORION',
  })
  const engines05 = engine05Bind.engines05
  const enginesFinal = bindEngineFinalToLive({
    mission_id: liveMissionId,
    commanderMessage: input.commanderMessage,
  }).enginesFinal

  let live = executive.public.live
  if (live?.learning && live.replay) {
    const persisted = await persistLiveIfEnabled({
      schema: 'war-room.live-cognition.v1',
      mission_id: contract.mission_id,
      session_id: contract.mission_id,
      telemetry: executive.public.telemetry,
      replay: live.replay,
      learning: live.learning,
      hidden_cot: false,
    })
    live = { ...live, persisted }
  }

  const policy = concurrencyPolicy({
    localGeneralReady,
    browserReady: ebc?.snapshot.tool_calls.some(c => /broker|browser/.test(c.tool_name)) ?? true,
  })
  const schedTasks = tasksFromGraph({
    missionId: contract.mission_id,
    tasks: executive.public.task_graph.tasks.map(t => ({
      task_id: t.task_id,
      assigned_role: String(t.assigned_role),
      depends_on: t.depends_on,
      tools_required: t.tools_required,
    })),
  })
  const timing = schedTasks.length ? await sequentialVsParallelTiming({ tasks: schedTasks, policy }) : null
  const correction = parseCommanderCorrection(input.commanderMessage, contract.mission_id)
  const experience = experienceFromMission({
    missionId: contract.mission_id,
    missionClass: routing.intelligence_class,
    strategy: executive.public.strategy.id,
    assembly: executive.public.assembly.selected_seats,
    tasks: executive.public.task_graph.tasks.map(t => t.task_id),
    parallelism: timing?.waves.filter(w => w.concurrent).length ?? executive.public.telemetry.parallel_groups,
    models: executive.public.job_routes.map(r => r.model_target),
    tools: ebc?.snapshot.tool_calls.map(c => c.tool_name) ?? [],
    replans: executive.public.telemetry.replans,
    conflicts: executive.public.conflicts.length,
    completion: executive.public.completion,
    latency_ms: executive.public.telemetry.latency_ms,
    evidenceCount: executive.public.telemetry.evidence_count,
    verified: executive.public.telemetry.verified_claims,
    evaluation: executive.public.evaluation?.what_worked ?? [],
    corrections: correction ? 1 : 0,
  })
  let comparison: string | null = null
  let missionDiff: Record<string, string> | null = null
  let prior: MissionExperienceRecord[] = []
  try {
    prior = await listExperience()
    if (parseAdaptiveAsk(input.commanderMessage) === 'COMPARE_MISSIONS' && prior.length >= 2) {
      comparison = compareMissions(prior[prior.length - 2], prior[prior.length - 1])
      missionDiff = diffMissions(prior[prior.length - 2], prior[prior.length - 1])
    }
    await persistExperience(experience)
    if (/screenshot/i.test(input.commanderMessage)) {
      const pb = screenshotCrashPlaybook([contract.mission_id])
      if (operationalMemoryCandidate(pb).persist) await persistPlaybook(pb)
    }
    if (live?.learning) {
      const decision = screenLearningRecord(live.learning)
      const staged = stageWrimEval(live.learning, decision)
      if (staged.staged) {
        await persistStagedEval({
          schema: 'war-room.wrim-eval-staging.v1',
          mission_id: contract.mission_id,
          decision,
          trains_wrim: false,
          purpose: 'evaluation',
          provenance: staged.provenance,
          record: live.learning,
        })
      }
    }
  } catch {
    /* persistence must not fail the mission */
  }
  const adaptive = buildAdaptivePublic({
    tasks: schedTasks,
    policy,
    timing,
    experience,
    comparison,
    prior,
    products: executive.public.work_products,
    routes: executive.public.job_routes,
    corrections: correction ? [correction] : [],
    toolRows: (ebc?.snapshot.tool_calls ?? []).map(c => ({
      tool: c.tool_name,
      ok: c.ok,
      gain: (c.ok ? 'HIGH' : 'LOW') as 'HIGH' | 'LOW',
      evidence: c.ok ? 1 : 0,
      latency_ms: 0,
      changed: c.ok,
    })),
    text: input.commanderMessage,
    learning: live?.learning ?? null,
    assembly: executive.public.assembly.selected_seats,
    strategy: executive.public.strategy.id,
    brief: executive.commander_brief,
    completion: executive.public.completion,
    conflicts: executive.public.conflicts.length,
    authorityCommit: contract.authority.commit,
    sessionId: contract.mission_id,
    missionDiff,
  })
  live = live ? { ...live, adaptive } : live

  const rationale = routing.mission_contract === 'none'
    ? null
    : buildStructuredRationale({
      contract,
      plan: atlas,
      scenarios: janus.invoked ? janus : null,
      risks: sentinel.invoked ? sentinel : null,
      evidence: (ebc?.board.evidence ?? []).slice(0, 16).map(row => ({ evidence_id: row.evidence_id, summary: row.summary })),
    })

  const layers = [
    'contract',
    routing.atlas ? 'atlas' : null,
    routing.ebc ? 'ebc' : null,
    invokeJanus ? 'janus' : null,
    routing.phoenix ? 'phoenix' : null,
    routing.sentinel ? 'sentinel' : null,
    routing.aurora ? 'aurora' : null,
    routing.memory_gate ? 'memory_gate' : null,
    routing.self_awareness ? 'self_awareness' : null,
  ].filter((item): item is string => Boolean(item))

  const metrics: IntelligenceMetrics = {
    latency_ms: Date.now() - started,
    seat_count: classification.selected_agents.length,
    tool_calls: ebc?.snapshot.tool_calls.length ?? 0,
    model_provider_calls: 0,
    evidence_count: ebc?.snapshot.evidence_count ?? 0,
    mission_duration_ms: Date.now() - started,
    layers_invoked: [...layers, 'executive'],
  }

  const pub: CouncilIntelligencePublic = {
    schema: INTELLIGENCE_SCHEMA,
    mission_id: contract.mission_id,
    intelligence_class: routing.intelligence_class,
    routing,
    contract,
    plan: atlas,
    scenarios: janus,
    risks: sentinel,
    knowledge: {
      node_count: graph?.nodes.length ?? 0,
      edge_count: graph?.edges.length ?? 0,
      current_install: awareness?.install_id ?? graph?.nodes.find(item => item.node_type === 'INSTALL' && item.temporal_state === 'CURRENT')?.canonical_name ?? null,
    },
    memory,
    receipts,
    governor,
    self_awareness: awareness,
    rationale,
    roles: [...DEFAULT_ROLE_FULFILLMENT],
    metrics,
    ebc_truth_spine: true,
    orchestration: live
      ? { ...executive.public, live, engines04, engines05, enginesFinal }
      : { ...executive.public, engines04, engines05, enginesFinal },
    conversational_failure_code: null,
    conversational_model: null,
  }

  const snapshot = ebc
    ? { ...ebc.snapshot, intelligence: pub }
    : null

  let brief = executive.commander_brief || ebc?.commander_brief || contract.objective
  if (!horizonPre.execute_live && horizonPost.commander_status) {
    brief = horizonPost.commander_status
  }
  if (routing.intelligence_class === 'SYSTEM_STATUS') {
    brief = formatSystemStatusCommanderBrief(awareness)
  } else if (isRationaleAsk(input.commanderMessage) && rationale) {
    brief = formatRationaleForCommander(rationale)
  }
  if (productionLive?.approval_request && !brief.includes('Authority required: Commander')) {
    brief = `${brief}\n\n${productionLive.approval_request}`
  }
  if (engine05Bind.engines05.commander_status && parseEngine05Command(input.commanderMessage)) {
    brief = `${brief}\n\n${engine05Bind.engines05.commander_status}`
  }
  if (enginesFinal.commander_status) {
    brief = `${brief}\n\n${enginesFinal.commander_status}`
  }

  if (classification.mission_class === 'SOCIAL_CHECKIN' && !input.skipLiveAwareness) {
    const spoken = await generateConversationalAurora({
      commanderMessage: input.commanderMessage,
      priorTurns: input.priorTurns,
      awareness,
    })
    brief = spoken.text
    pub.conversational_failure_code = spoken.failureCode
    pub.conversational_model = {
      role: 'AURORA',
      provider: spoken.provider,
      model: spoken.model,
      latency_ms: spoken.latencyMs,
    }
    metrics.model_provider_calls += spoken.ok || spoken.failureCode ? 1 : 0
    metrics.layers_invoked.push('conversational_aurora')
  }

  void listIndexedCapabilities
  return {
    ebc,
    public: pub,
    commander_brief: brief,
    snapshot,
  }
}

export function lightweightIntelligencePublic(input: {
  missionId: string
  commanderMessage: string
  ebcClass?: 'SOCIAL_CHECKIN'
}): CouncilIntelligencePublic {
  const routing = resolveIntelligenceRouting({
    text: input.commanderMessage,
    ebcClass: input.ebcClass ?? 'SOCIAL_CHECKIN',
  })
  const contract = createMissionContract({
    missionId: input.missionId,
    ebcClass: input.ebcClass ?? 'SOCIAL_CHECKIN',
    intelligenceClass: 'SOCIAL_CHECKIN',
    commanderMessage: input.commanderMessage,
    lightweight: true,
  })
  return {
    schema: INTELLIGENCE_SCHEMA,
    mission_id: input.missionId,
    intelligence_class: 'SOCIAL_CHECKIN',
    routing,
    contract,
    plan: null,
    scenarios: skippedJanus(input.missionId, 'SOCIAL_CHECKIN skips JANUS'),
    risks: skippedSentinel(input.missionId, 'SOCIAL_CHECKIN skips SENTINEL'),
    knowledge: { node_count: 0, edge_count: 0, current_install: null },
    memory: null,
    receipts: [],
    governor: [],
    self_awareness: null,
    rationale: buildStructuredRationale({ contract }),
    roles: [...DEFAULT_ROLE_FULFILLMENT],
    metrics: {
      latency_ms: 0,
      seat_count: 1,
      tool_calls: 0,
      model_provider_calls: 0,
      evidence_count: 0,
      mission_duration_ms: 0,
      layers_invoked: ['contract', 'aurora'],
    },
    ebc_truth_spine: true,
    orchestration: null,
  }
}
