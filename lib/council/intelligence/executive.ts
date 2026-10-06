/**
 * CouncilExecutive — cognitive orchestrator.
 * Coordinates existing layers. Does not answer the Commander. Does not grant authority.
 * Tool Governor / Commander still authorize. EBC remains the evidence spine.
 */

import type { EbcMissionResult } from '@/lib/council/evidence-board/types'
import { assembleCouncil } from './assembly'
import { composeAuroraBrief } from './auroraSynthesis'
import { blackboardNeverUpgradesInference, buildBlackboard } from './blackboard'
import { initBudget, recordBudget } from './budget'
import { evaluateCompletion } from './completion'
import { packetsDiffer, buildContextPackets, compressContext } from './contextPacket'
import { auroraMayNotInventConsensus, resolveConflicts } from './conflict'
import { resolveDeliberationPolicy } from './deliberationPolicy'
import { planEvidence } from './evidencePlan'
import { evaluateMission } from './evaluation'
import { generateHypotheses } from './hypothesis'
import { routeJobsForStrategy } from './jobRouter'
import { ORCHESTRATION_SCHEMA, type CouncilOrchestrationPublic, type CognitiveJob, type CognitiveTask, type PlanRevision } from './orchestrationTypes'
import { buildQuestionGraph, prioritizeBlocking } from './questionGraph'
import { maybeReplan, type ReplanTrigger } from './replan'
import { taskGraphFromAtlas } from './taskGraph'
import { estimateToolValue, pickHighInformationProbes } from './toolValue'
import { scheduleVerification, materialOnly } from './verificationScheduler'
import { workProductsFromLayers } from './workProduct'
import { selectCognitiveStrategy } from './strategy'
import { buildLearningAndReplay, finalizeLiveCognition, routeWorkProducts } from './liveCognition'
import { attachCouncilEngine02Public } from '@/lib/council/engines/integration/executive02'
import { attachCouncilEngine03Public } from '@/lib/council/engines/integration/executive03'
import type { AtlasPlanGraph, ExecutionReceipt, IntelligenceRouting, JanusAnalysis, MissionContractV1, SelfAwarenessSnapshot, SentinelReview } from './types'

export type ExecutiveInput = {
  contract: MissionContractV1
  routing: IntelligenceRouting
  text: string
  plan: AtlasPlanGraph | null
  ebc: EbcMissionResult | null
  janus: JanusAnalysis | null
  sentinel: SentinelReview | null
  awareness: SelfAwarenessSnapshot | null
  kgNodeIds?: string[]
  receipts?: ExecutionReceipt[]
  localGeneralReady?: boolean
  replanTrigger?: ReplanTrigger | null
  unavailableTool?: string | null
  injectedConflicts?: Array<{ claim: string; evidenceA: string[]; evidenceB: string[] }>
  now?: string
  startedAt?: number
  livePrep?: import('./liveCognition').LivePrep | null
  liveExecution?: import('@/lib/council/engines/live-execution/types').LiveExecutionResult | null
    engine03Production?: {
    production_invoked: boolean
    injection: boolean
    phases?: string[]
    approval_request?: string | null
  } | null
  engine04?: import('@/lib/council/engines/integration/executive04').CouncilEngine04Public | null
  engine05?: import('@/lib/council/engines/integration/executive05').CouncilEngine05Public | null
  engineFinal?: import('@/lib/council/engines/integration/executiveFinal').CouncilEngineFinalPublic | null
}

export type ExecutiveResult = {
  public: CouncilOrchestrationPublic
  commander_brief: string
  extra_receipts: ExecutionReceipt[]
  packets_differ: boolean
  blackboard_safe: boolean
  no_false_consensus: boolean
}

export function runCouncilExecutive(input: ExecutiveInput): ExecutiveResult {
  const started = input.startedAt ?? Date.now()
  const now = input.now ?? new Date().toISOString()
  const strategy = selectCognitiveStrategy({
    text: input.text,
    intelligenceClass: input.routing.intelligence_class,
    ebcClass: input.routing.ebc_mission_class,
  })
  const budget0 = initBudget(input.text, strategy)
  const assembly = assembleCouncil({
    contract: input.contract,
    strategy,
    routing: input.routing,
    text: input.text,
    budget: budget0.budget,
    evidenceThin: (input.ebc?.board.evidence.length ?? 0) < 2,
    conflictProbability: input.injectedConflicts?.length ? 'high' : 'low',
  })
  const graph0 = taskGraphFromAtlas({ contract: input.contract, plan: input.plan, strategy, now })
  const replanned = maybeReplan({
    contract: input.contract,
    strategy,
    graph: graph0,
    plan: input.plan,
    trigger: input.replanTrigger ?? null,
    unavailableTool: input.unavailableTool,
    now,
  })
  const questions = input.livePrep?.questions ?? buildQuestionGraph({ contract: input.contract, strategy, text: input.text })
  void prioritizeBlocking(questions)
  const hypotheses = input.livePrep?.hypotheses?.length
    ? input.livePrep.hypotheses
    : strategy.id === 'DIAGNOSE' || strategy.id === 'INCIDENT_RESPONSE'
      ? generateHypotheses(input.text)
      : []
  const evidence_plan = planEvidence({ strategy, questions: questions.questions, text: input.text })
  const tool_values = pickHighInformationProbes(
    questions.questions.flatMap(q => q.required_evidence.map(ev => estimateToolValue({
      tool: ev === 'live_telemetry' ? 'system.health' : ev === 'primary_external' ? 'research.web' : 'wr.ports.list',
      question: q,
    }))),
  )
  const products = workProductsFromLayers({
    missionId: input.contract.mission_id,
    ebc: input.ebc,
    janus: input.janus,
    sentinel: input.sentinel,
    now,
  })
  const liveFinal = input.livePrep
    ? finalizeLiveCognition({
      prep: input.livePrep,
      ebc: input.ebc,
      products,
      calls: input.ebc?.snapshot.tool_calls.map(c => ({ tool_name: c.tool_name, ok: c.ok })) ?? [],
    })
    : null
  const conflicts = resolveConflicts({ ebc: input.ebc, injected: input.injectedConflicts })
  if (conflicts.length) {
    const conflictQ = {
      question_id: 'q-conflict-discriminating',
      type: 'FACTUAL' as const,
      text: `Which source is correct for: ${conflicts[0].disputed_claim}`,
      parent_task: 's1',
      priority: 'BLOCKING' as const,
      blocking: true,
      answer_state: 'OPEN' as const,
      required_evidence: ['primary_external', 'live_telemetry'],
      assigned_role: 'LUMEN' as const,
    }
    questions.questions.push(conflictQ)
    liveFinal?.questions.questions.push(conflictQ)
  }
  const verification = scheduleVerification(input.ebc)
  const blackboard = buildBlackboard({
    contract: input.contract,
    tasks: replanned.graph,
    questions: liveFinal?.questions ?? questions,
    hypotheses: liveFinal?.hypotheses ?? hypotheses,
    ebc: input.ebc,
    janus: input.janus,
    sentinel: input.sentinel,
    now,
  })
  const packets = liveFinal?.packets ?? buildContextPackets({
    contract: input.contract,
    blackboard,
    products,
    questions: liveFinal?.questions ?? questions,
    kgNodeIds: input.kgNodeIds ?? [],
  })
  const compression = compressContext({ blackboard, products, force: products.length >= 6 || budget0.budget === 'MAXIMUM' })
  const jobs: CognitiveJob[] = strategy.id === 'DIRECT'
    ? ['conversation', 'classification']
    : ['classification', 'planning', 'verification', strategy.id === 'RESEARCH' ? 'research_synthesis' : 'coding_analysis']
  const job_routes = routeJobsForStrategy(jobs, input.localGeneralReady === true)
  const completion = evaluateCompletion({
    contract: input.contract,
    strategy,
    tasks: replanned.graph,
    questions,
    evidencePlan: evidence_plan,
    ebc: input.ebc,
    conflicts,
    sentinel: input.sentinel,
    verificationDone: materialOnly(verification).every(v => v.verify),
  })
  const telemetry = {
    mission_id: input.contract.mission_id,
    strategy: strategy.id,
    assembly: assembly.selected_seats,
    task_count: replanned.graph.tasks.length,
    parallel_groups: replanned.graph.parallel_groups.length,
    agents_used: input.ebc?.classification.selected_agents ?? assembly.selected_seats,
    model_calls: 0,
    tool_calls: input.ebc?.snapshot.tool_calls.length ?? 0,
    evidence_count: input.ebc?.snapshot.evidence_count ?? 0,
    verified_claims: input.ebc?.board.claims.filter(c => c.status === 'VERIFIED').length ?? 0,
    conflicts: conflicts.length,
    replans: replanned.revision ? 1 : 0,
    risk_count: input.sentinel?.risks.length ?? 0,
    authority_blocks: (input.ebc ? 0 : 0) + replanned.graph.tasks.filter((t: { status: string }) => t.status === 'WAITING_AUTHORITY').length,
    completion_state: completion,
    latency_ms: Date.now() - started,
  }
  const evaluation = evaluateMission({
    strategy,
    assembly,
    tasks: replanned.graph,
    telemetry,
    wastedTools: [],
  })
  const budget = recordBudget(budget0, {
    tool_calls: telemetry.tool_calls,
    browser_calls: input.ebc?.snapshot.tool_calls.filter(c => /broker|browser/.test(c.tool_name)).length ?? 0,
    agent_turns: assembly.selected_seats.length,
    latency_ms: telemetry.latency_ms,
    context_chars: packets.reduce((n, p) => n + p.mission_objective.length, 0),
  })
  const revisions: PlanRevision[] = replanned.revision ? [replanned.revision] : []
  const pub: CouncilOrchestrationPublic = {
    schema: ORCHESTRATION_SCHEMA,
    strategy,
    assembly,
    task_graph: replanned.graph,
    questions: liveFinal?.questions ?? questions,
    hypotheses: liveFinal?.hypotheses ?? hypotheses,
    blackboard,
    work_products: products,
    evidence_plan,
    tool_values,
    deliberation: resolveDeliberationPolicy(strategy, input.text),
    conflicts,
    verification,
    packets,
    compression,
    budget,
    job_routes,
    completion,
    evaluation,
    revisions,
    telemetry,
    grants_authority: false,
    ebc_truth_spine: true,
    live: {
      work_product_edges: liveFinal?.edges ?? routeWorkProducts(products),
      tool_decisions: liveFinal?.tool_decisions ?? input.livePrep?.tool_decisions ?? [],
      phoenix: input.livePrep?.phoenix ?? { invoked: false, reason: 'not prepared', claim_ids: [], what_changed: null },
      sentinel_checkpoints: input.livePrep?.sentinel_checkpoints ?? [{ at: 'plan', action: 'CONTINUE', grants_authority: false }],
      learning: buildLearningAndReplay({
        missionId: input.contract.mission_id,
        sessionId: input.contract.mission_id,
        strategy: strategy.id,
        assembly: assembly.selected_seats,
        taskIds: replanned.graph.tasks.map((t: { task_id: string }) => t.task_id),
        parallel: replanned.graph.parallel_groups,
        tool_decisions: liveFinal?.tool_decisions ?? [],
        replans: telemetry.replans,
        conflicts: conflicts.length,
        risks: telemetry.risk_count,
        completion,
        latency_ms: telemetry.latency_ms,
        findings: evaluation.what_worked,
      }).learning,
      replay: buildLearningAndReplay({
        missionId: input.contract.mission_id,
        sessionId: input.contract.mission_id,
        strategy: strategy.id,
        assembly: assembly.selected_seats,
        taskIds: replanned.graph.tasks.map((t: { task_id: string }) => t.task_id),
        parallel: replanned.graph.parallel_groups,
        tool_decisions: liveFinal?.tool_decisions ?? [],
        replans: telemetry.replans,
        conflicts: conflicts.length,
        risks: telemetry.risk_count,
        completion,
        latency_ms: telemetry.latency_ms,
        findings: evaluation.what_worked,
      }).replay,
      persisted: false,
    },
    engines02: attachCouncilEngine02Public({
      mission_id: input.contract.mission_id,
      objective: input.contract.objective,
      available_tools: tool_values.map(row => row.tool),
      remaining_evidence_gap: evidence_plan.filter(row => row.minimum_sources > 0).map(row => row.claim_or_question),
      ebc_satisfied: (input.ebc?.snapshot.usable_source_count ?? 0) > 0 && completion === 'COMPLETE',
      atlas_plan: (replanned.plan ?? input.plan) ? {
        steps: (replanned.plan ?? input.plan)!.steps.map(step => ({
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
        parallelizable_groups: (replanned.plan ?? input.plan)?.parallelizable_groups,
      } : null,
      failed_task_id: input.unavailableTool ? replanned.graph.tasks.find((t: CognitiveTask) => t.tools_required.includes(input.unavailableTool ?? ''))?.task_id ?? null : null,
      tasks: replanned.graph.tasks.map((t: CognitiveTask) => ({
        task_id: t.task_id,
        started_at: t.started_at,
        completed_at: t.completed_at,
        tools_required: t.tools_required,
        status: t.status,
        depends_on: t.depends_on,
      })),
    }),
    engines03: attachCouncilEngine03Public({
      live: input.liveExecution ?? null,
      production_invoked: input.engine03Production?.production_invoked,
      injection: input.engine03Production ? input.engine03Production.injection : Boolean(input.liveExecution),
      phases: input.engine03Production?.phases,
      approval_request: input.engine03Production?.approval_request,
    }),
    engines04: input.engine04 ?? undefined,
    engines05: input.engine05 ?? undefined,
    enginesFinal: input.engineFinal ?? undefined,
  }
  const brief0 = composeAuroraBrief({
    contract: input.contract,
    strategy,
    ebc: input.ebc,
    janus: input.janus,
    sentinel: input.sentinel,
    conflicts,
    completion,
  })
  const brief = input.liveExecution?.completion === 'WAITING_AUTHORITY' && input.engine03Production?.approval_request
    ? `${brief0}\n\n${input.engine03Production.approval_request}`
    : brief0
  return {
    public: Object.freeze(pub),
    commander_brief: brief,
    extra_receipts: replanned.receipt ? [replanned.receipt] : [],
    packets_differ: liveFinal?.packets_differ ?? packetsDiffer(packets),
    blackboard_safe: blackboardNeverUpgradesInference(blackboard),
    no_false_consensus: auroraMayNotInventConsensus(conflicts),
  }
}
