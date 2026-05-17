import { ANALYST_LANE_LABELS, ANALYST_REGISTRY, type AnalystLane } from './analystRegistry'
import type { AnalystIntake, AnalystTask } from './analystTaskPlanner'

export type AnalystLaneAssignment = {
  lane: AnalystLane
  family: string
  label: string
  role: string
  status: AnalystTask['status']
  approvalRequiredForAction: boolean
}

function intakeText(intake: AnalystIntake): string {
  return `${intake.sourceDecree} ${intake.analysisType}`.toLowerCase()
}

export function inferAnalystLanes(intake: AnalystIntake): AnalystLane[] {
  const text = intakeText(intake)
  const lanes = new Set<AnalystLane>(['operations', 'intelligence', 'risk'])

  if (/\bfinance|financial|revenue|cost|roi|margin|payout|budget|cash\b/.test(text)) lanes.add('financial')
  if (/\bmarket|news|competitor|demand|pricing|customer|industry\b/.test(text)) lanes.add('market')
  if (/\blogistics?|supply|delivery|routing|lead\s*time|dependency|capacity\b/.test(text)) lanes.add('logistics')
  if (/\bsystem|provider|model|latency|repair|retrieval|runtime|performance|kpi\b/.test(text)) lanes.add('systems')
  if (/\bforecast|predict|scenario|trajectory|projection|future\b/.test(text)) lanes.add('forecast')
  if (/\bscore|rank|opportunit|compare|evaluate|strateg/.test(text)) {
    lanes.add('financial')
    lanes.add('forecast')
  }
  if (/\bbottleneck|workflow|approval|throughput|operations?\b/.test(text)) {
    lanes.add('operations')
    lanes.add('logistics')
    lanes.add('systems')
  }
  if (/\banomal|risk|volatile|failure|fail|unknown\b/.test(text)) lanes.add('risk')

  return (Object.keys(ANALYST_REGISTRY) as AnalystLane[]).filter(lane => lanes.has(lane))
}

export function routeAnalystLane(lane: AnalystLane): AnalystLaneAssignment {
  const profile = ANALYST_REGISTRY[lane]
  return {
    lane,
    family: profile.family,
    label: profile.label,
    role: profile.role,
    status: 'assigned',
    approvalRequiredForAction: true,
  }
}

export function buildAnalystLaneAssignments(intake: AnalystIntake): AnalystLaneAssignment[] {
  return inferAnalystLanes(intake).map(routeAnalystLane)
}

function laneInputs(lane: AnalystLane): string[] {
  switch (lane) {
    case 'financial':
      return ['Commander decree', 'known revenue/cost signals', 'opportunity assumptions']
    case 'operations':
      return ['Commander decree', 'workflow history', 'approval and repair outcomes']
    case 'intelligence':
      return ['Commander decree', 'source freshness', 'retrieval success/failure context']
    case 'market':
      return ['Commander decree', 'market/news signals', 'competitor or demand assumptions']
    case 'logistics':
      return ['Commander decree', 'dependencies', 'resource and timing constraints']
    case 'systems':
      return ['Commander decree', 'provider outcomes', 'latency, repair, and runtime status']
    case 'forecast':
      return ['Commander decree', 'historical comparisons', 'scenario assumptions']
    case 'risk':
      return ['All analyst findings', 'unknowns', 'Red Team verification posture']
  }
}

export function buildAnalystTasks(intake: AnalystIntake): AnalystTask[] {
  return buildAnalystLaneAssignments(intake).map(assignment => ({
    id: `${intake.id}-${assignment.lane}`,
    lane: assignment.lane,
    title: `${ANALYST_LANE_LABELS[assignment.lane]} lane`,
    objective: `${assignment.label} interprets outcomes and metrics for: ${intake.commanderIntent}`,
    assignedFamily: assignment.family,
    requiredInputs: laneInputs(assignment.lane),
    status: assignment.status,
    outputSummary: `${assignment.role} Findings are prepared as analyst intelligence only; no external action is executed.`,
    confidence: assignment.lane === 'market' || assignment.lane === 'forecast' ? 0.62 : 0.72,
    risks: ['Requires verified data before evidence-backed claims or external decisions.'],
    approvalRequiredForAction: assignment.approvalRequiredForAction,
  }))
}
