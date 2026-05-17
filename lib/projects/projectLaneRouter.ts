import type { ProjectIntake, ProjectLane, ProjectTask } from './projectTaskPlanner'

export type ProjectLaneAssignment = {
  lane: ProjectLane
  family: string
  agent: ProjectTask['assigned_agent']
  agentLabel: string
  role: string
  status: ProjectTask['status']
  approvalRequired: boolean
}

export const PROJECT_LANES: ProjectLane[] = [
  'research',
  'architecture',
  'engineering',
  'design_ui',
  'business_revenue',
  'legal_compliance',
  'risk_review',
  'documentation',
  'final_synthesis',
]

export const PROJECT_LANE_LABELS: Record<ProjectLane, string> = {
  research: 'Research',
  architecture: 'Architecture',
  engineering: 'Engineering',
  design_ui: 'Design/UI',
  business_revenue: 'Business/Revenue',
  legal_compliance: 'Legal/Compliance',
  risk_review: 'Risk Review',
  documentation: 'Documentation',
  final_synthesis: 'Final Synthesis',
}

const BASE_ASSIGNMENTS: Record<ProjectLane, Omit<ProjectLaneAssignment, 'lane'>> = {
  research: {
    family: 'Grok',
    agent: 'grok',
    agentLabel: 'Grok',
    role: 'Live research, market/news/radar signals, source freshness.',
    status: 'assigned',
    approvalRequired: true,
  },
  architecture: {
    family: 'Claude',
    agent: 'claude',
    agentLabel: 'Claude',
    role: 'Architecture, structure, implementation quality, invariants.',
    status: 'assigned',
    approvalRequired: true,
  },
  engineering: {
    family: 'Cursor',
    agent: 'cursor',
    agentLabel: 'Cursor',
    role: 'Engineering task packet and visible execution lane after approval.',
    status: 'waiting_approval',
    approvalRequired: true,
  },
  design_ui: {
    family: 'Claude',
    agent: 'claude',
    agentLabel: 'Claude',
    role: 'Compact UX structure, interaction model, and UI quality.',
    status: 'assigned',
    approvalRequired: true,
  },
  business_revenue: {
    family: 'ChatGPT',
    agent: 'chatgpt',
    agentLabel: 'ChatGPT',
    role: 'Offer strategy, monetization path, operating plan.',
    status: 'assigned',
    approvalRequired: true,
  },
  legal_compliance: {
    family: 'Gemini',
    agent: 'gemini',
    agentLabel: 'Gemini',
    role: 'Compliance placeholder, cross-reference, pattern organization.',
    status: 'assigned',
    approvalRequired: true,
  },
  risk_review: {
    family: 'Red Team',
    agent: 'red_team',
    agentLabel: 'Red Team',
    role: 'Contradictions, weakness detection, approval boundary review.',
    status: 'assigned',
    approvalRequired: true,
  },
  documentation: {
    family: 'Gemini',
    agent: 'gemini',
    agentLabel: 'Gemini',
    role: 'Organization, documentation shape, reusable patterns.',
    status: 'assigned',
    approvalRequired: true,
  },
  final_synthesis: {
    family: 'ChatGPT',
    agent: 'chatgpt',
    agentLabel: 'ChatGPT',
    role: 'Project orchestration, final synthesis, execution plan.',
    status: 'waiting_approval',
    approvalRequired: true,
  },
}

function decreeText(intake: ProjectIntake) {
  return intake.sourceDecree.toLowerCase()
}

export function inferProjectLanes(intake: ProjectIntake): ProjectLane[] {
  const text = decreeText(intake)
  const lanes = new Set<ProjectLane>(['architecture', 'risk_review', 'documentation', 'final_synthesis'])

  if (/\bresearch|market|news|radar|competitor|source|evidence\b/.test(text)) lanes.add('research')
  if (/\bbuild|app|application|feature|code|repair|implement|repo|bug|ui|war\s*room\b/.test(text)) lanes.add('engineering')
  if (/\bdesign|ui|ux|page|landing|presentation|slide|brand\b/.test(text)) lanes.add('design_ui')
  if (/\bbusiness|revenue|sales|outreach|campaign|offer|customer|market\b/.test(text)) lanes.add('business_revenue')
  if (/\blegal|compliance|privacy|terms|regulation|audit\b/.test(text)) lanes.add('legal_compliance')

  if (/\bend[-\s]?to[-\s]?end|orchestrat|multi[-\s]?agent|workflow|phase\s*\d+/.test(text)) {
    lanes.add('research')
    lanes.add('engineering')
    lanes.add('design_ui')
    lanes.add('business_revenue')
    lanes.add('legal_compliance')
  }

  return PROJECT_LANES.filter(lane => lanes.has(lane))
}

export function routeProjectLane(lane: ProjectLane): ProjectLaneAssignment {
  return { lane, ...BASE_ASSIGNMENTS[lane] }
}

export function buildProjectLaneAssignments(intake: ProjectIntake): ProjectLaneAssignment[] {
  return inferProjectLanes(intake).map(routeProjectLane)
}

export function laneTaskObjective(lane: ProjectLane, intake: ProjectIntake): string {
  const label = PROJECT_LANE_LABELS[lane]
  return `${label} lane prepares its contribution to: ${intake.commanderIntent}`
}

export function laneRequiredInputs(lane: ProjectLane): string[] {
  switch (lane) {
    case 'research':
      return ['Commander decree', 'live source requirements', 'known evidence gaps']
    case 'architecture':
      return ['Commander decree', 'current system constraints', 'quality and structure expectations']
    case 'engineering':
      return ['Commander decree', 'repo scope', 'validation commands', 'approval boundaries']
    case 'design_ui':
      return ['Commander decree', 'target user', 'screen or asset context']
    case 'business_revenue':
      return ['Commander decree', 'audience', 'offer or revenue hypothesis']
    case 'legal_compliance':
      return ['Commander decree', 'jurisdiction or policy assumptions', 'known compliance unknowns']
    case 'risk_review':
      return ['All lane summaries', 'approval actions', 'runtime truth evidence']
    case 'documentation':
      return ['Lane decisions', 'implementation plan', 'Commander-facing summary needs']
    case 'final_synthesis':
      return ['All lane outputs', 'Red Team review', 'open risks']
  }
}

export function buildProjectTasks(intake: ProjectIntake): ProjectTask[] {
  const assignments = buildProjectLaneAssignments(intake)
  const idsByLane = new Map(assignments.map(assignment => [assignment.lane, `${intake.id}-${assignment.lane}`]))

  return assignments.map(assignment => {
    const dependencies =
      assignment.lane === 'risk_review'
        ? assignments.filter(a => !['risk_review', 'final_synthesis'].includes(a.lane)).map(a => idsByLane.get(a.lane)!)
        : assignment.lane === 'final_synthesis'
          ? assignments.filter(a => a.lane !== 'final_synthesis').map(a => idsByLane.get(a.lane)!)
          : []

    return {
      id: idsByLane.get(assignment.lane)!,
      lane: assignment.lane,
      title: `${PROJECT_LANE_LABELS[assignment.lane]} lane`,
      objective: laneTaskObjective(assignment.lane, intake),
      assigned_family: assignment.family,
      assigned_agent: assignment.agent,
      assigned_agent_label: assignment.agentLabel,
      required_inputs: laneRequiredInputs(assignment.lane),
      status: assignment.status,
      dependencies,
      output_summary: `${assignment.role} Prepared for Commander-approved work; not executed autonomously.`,
      confidence: assignment.lane === 'legal_compliance' ? 0.54 : 0.72,
      risks: assignment.lane === 'legal_compliance'
        ? ['Placeholder only; specialist/legal review may be required before external use.']
        : ['Requires Commander approval before execution or external action.'],
      approval_required: assignment.approvalRequired,
    } satisfies ProjectTask
  })
}
