import { buildAnalystLaneAssignments, buildAnalystTasks, type AnalystLaneAssignment } from './analystLaneRouter'
import { buildAnalystMemoryTracker, type AnalystMemoryTracker } from './analystMemoryTracker'
import { buildAnalystReport, type AnalystReport } from './analystReportBuilder'
import { buildAnalystScoringSummary, type AnalystScoringSummary } from './analystScoring'
import {
  createAnalystIntake,
  detectAnalystIntent,
  type AnalystIntake,
  type AnalystIntentDetection,
  type AnalystTask,
} from './analystTaskPlanner'

export type AnalystOperationsPacket = {
  id: string
  status: 'prepared' | 'waiting_data' | 'ready_for_commander_review'
  createdAt: string
  intake: AnalystIntake
  lanes: AnalystLaneAssignment[]
  tasks: AnalystTask[]
  report: AnalystReport
  scoring: AnalystScoringSummary
  memory: AnalystMemoryTracker
  behaviorSummary: string
  commanderControls: Array<'request_sources' | 'compare_history' | 'deeper_analysis' | 'route_project'>
}

export { detectAnalystIntent }
export type { AnalystIntentDetection, AnalystTask }

export function createAnalystOperationsPacket(
  decree: string,
  now = new Date(),
  options: { force?: boolean; analysisType?: string } = {},
): AnalystOperationsPacket | null {
  const intake = createAnalystIntake(decree, now, options)
  if (!intake) return null

  const lanes = buildAnalystLaneAssignments(intake)
  const tasks = buildAnalystTasks(intake)
  const scoring = buildAnalystScoringSummary({
    text: intake.sourceDecree,
    dataGapCount: 2 + (/\bmarket|news|provider|financial|revenue\b/i.test(intake.sourceDecree) ? 1 : 0),
    anomalyCount: /\banomal|risk|fail|volatile|unknown\b/i.test(intake.sourceDecree) ? 1 : 0,
  })
  const report = buildAnalystReport({ intake, tasks, scoring })
  const memory = buildAnalystMemoryTracker(tasks)

  return {
    id: intake.id,
    status: report.dataGaps.length ? 'waiting_data' : 'ready_for_commander_review',
    createdAt: intake.createdAt,
    intake,
    lanes,
    tasks,
    report,
    scoring,
    memory,
    behaviorSummary:
      'Commander request -> analyst intake -> data interpretation lanes -> scoring -> outcome intelligence report -> memory/learning notes -> approval-gated next steps. No autonomous external action is performed.',
    commanderControls: ['request_sources', 'compare_history', 'deeper_analysis', 'route_project'],
  }
}
