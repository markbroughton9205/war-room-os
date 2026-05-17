import { createAnalystOperationsPacket, type AnalystOperationsPacket } from '@/lib/analysts/analystOutcomeEvaluator'
import { createEngineeringTaskPacket, type EngineeringTaskPacket } from '@/lib/engineering/engineeringTaskPacket'
import { buildProjectApprovalPacket, type ProjectApprovalPacket } from './projectApprovalPacket'
import { buildProjectLaneAssignments, buildProjectTasks, type ProjectLaneAssignment } from './projectLaneRouter'
import { buildProjectQualityGate, type ProjectQualityGate } from './projectQualityGate'
import { buildProjectSynthesis, type ProjectSynthesis } from './projectSynthesis'
import {
  createProjectIntake,
  detectProjectOrchestrationIntent,
  type ProjectIntake,
  type ProjectIntentDetection,
  type ProjectTask,
} from './projectTaskPlanner'

export type ProjectOrchestrationStatus =
  | 'intake'
  | 'lanes_assigned'
  | 'awaiting_commander_approval'
  | 'paused'
  | 'approved'

export type ProjectOrchestrationPacket = {
  id: string
  status: ProjectOrchestrationStatus
  createdAt: string
  intake: ProjectIntake
  tasks: ProjectTask[]
  lanes: ProjectLaneAssignment[]
  synthesis: ProjectSynthesis
  qualityGate: ProjectQualityGate
  approvalPacket: ProjectApprovalPacket
  analystPacket: AnalystOperationsPacket
  engineeringTaskPacket: EngineeringTaskPacket | null
  commanderControls: Array<'approve' | 'pause' | 'redirect' | 'deeper_work'>
  behaviorSummary: string
}

export { detectProjectOrchestrationIntent }
export type { ProjectApprovalPacket, ProjectIntentDetection, ProjectTask }

export function createProjectOrchestrationPacket(decree: string, now = new Date()): ProjectOrchestrationPacket | null {
  const intake = createProjectIntake(decree, now)
  if (!intake) return null

  const lanes = buildProjectLaneAssignments(intake)
  const tasks = buildProjectTasks(intake)
  const synthesis = buildProjectSynthesis(intake, tasks)
  const qualityGate = buildProjectQualityGate(intake, tasks)
  const analystPacket = createAnalystOperationsPacket(decree, now, {
    force: true,
    analysisType: `${intake.projectType} outcome intelligence`,
  })!
  const approvalPacket = buildProjectApprovalPacket({ intake, tasks, synthesis, qualityGate, analystPacket })
  const engineeringTaskPacket = tasks.some(task => task.lane === 'engineering')
    ? createEngineeringTaskPacket(decree, now)
    : null

  return {
    id: intake.id,
    status: 'awaiting_commander_approval',
    createdAt: intake.createdAt,
    intake,
    tasks,
    lanes,
    synthesis,
    qualityGate,
    approvalPacket,
    analystPacket,
    engineeringTaskPacket,
    commanderControls: ['approve', 'pause', 'redirect', 'deeper_work'],
    behaviorSummary:
      'Commander decree -> intake -> task decomposition -> family/agent assignment -> prepared parallel lanes -> synthesis plan -> Red Team quality gate -> approval packet. No autonomous execution is performed.',
  }
}
