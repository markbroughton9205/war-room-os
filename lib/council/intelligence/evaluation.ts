/**
 * Cheap structured post-mission evaluation. Not chain-of-thought. Does not train WRIM.
 */

import type { CouncilAssemblyPlan, CognitiveStrategy, CognitiveTaskGraph, MissionEvaluation, OrchestrationTelemetry } from './orchestrationTypes'

export function evaluateMission(input: {
  strategy: CognitiveStrategy
  assembly: CouncilAssemblyPlan
  tasks: CognitiveTaskGraph
  telemetry: OrchestrationTelemetry
  wastedTools: string[]
}): MissionEvaluation {
  const unused = input.assembly.selected_seats.filter(seat => seat !== 'AURORA' && input.telemetry.agents_used.length > 0 && !input.telemetry.agents_used.includes(seat))
  return Object.freeze({
    what_worked: [
      `strategy ${input.strategy.id}`,
      `seats ${input.assembly.selected_seats.join(',')}`,
      input.assembly.never_default_six ? 'did not default to six' : 'assembly review',
    ],
    what_failed: [
      ...input.tasks.tasks.filter(t => t.status === 'FAILED').map(t => t.task_id),
      ...input.tasks.tasks.filter(t => t.status === 'WAITING_AUTHORITY').map(t => `${t.task_id} authority`),
    ],
    unresolved_questions: [],
    wasted_calls: input.wastedTools,
    unnecessary_agents: unused,
    missing_tools: [],
    routing_issue: input.strategy.id === 'DIRECT' && input.assembly.selected_seats.length > 1 ? 'DIRECT used extra seats' : null,
    evidence_issue: input.telemetry.evidence_count === 0 && input.strategy.evidence_requirement !== 'NONE' ? 'no evidence gathered' : null,
    latency_issue: input.telemetry.latency_ms > 120_000 ? 'mission exceeded 120s' : null,
    candidate_memory: input.telemetry.verified_claims > 0 ? ['verified runtime/system facts may be project candidates'] : [],
    trains_wrim: false,
  })
}
