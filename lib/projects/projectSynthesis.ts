import { PROJECT_LANE_LABELS } from './projectLaneRouter'
import type { ProjectIntake, ProjectTask } from './projectTaskPlanner'

export type ProjectSynthesis = {
  executiveSummary: string
  recommendedPath: string
  laneResults: Array<{
    lane: ProjectTask['lane']
    label: string
    family: string
    status: ProjectTask['status']
    summary: string
    confidence: number
  }>
  implementationPlan: string[]
  evidenceSources: string[]
}

export function buildProjectSynthesis(intake: ProjectIntake, tasks: ProjectTask[]): ProjectSynthesis {
  const engineering = tasks.find(task => task.lane === 'engineering')
  const research = tasks.find(task => task.lane === 'research')
  const risk = tasks.find(task => task.lane === 'risk_review')

  return {
    executiveSummary:
      `Project orchestration packet prepared for a ${intake.projectType}. War Room has decomposed the decree into coordinated lanes, assigned families/agents, and held execution behind Commander approval.`,
    recommendedPath:
      'Run lane work in parallel where possible, synthesize only after evidence and Red Team review are present, then request explicit Commander approval before any repo mutation, external action, commit, push, deploy, or outreach.',
    laneResults: tasks.map(task => ({
      lane: task.lane,
      label: PROJECT_LANE_LABELS[task.lane],
      family: task.assigned_family,
      status: task.status,
      summary: task.output_summary,
      confidence: task.confidence,
    })),
    implementationPlan: [
      'Confirm Commander scope, success criteria, and approval boundaries.',
      'Run research, architecture, design/business/compliance, documentation, and engineering lanes as applicable.',
      engineering
        ? 'Prepare or execute the Cursor engineering packet only after explicit Commander approval.'
        : 'Keep engineering as a future lane unless the Commander adds implementation scope.',
      research
        ? 'Attach live evidence and source freshness before synthesis.'
        : 'Record source assumptions and request live research if claims require current facts.',
      risk
        ? 'Route lane outputs through Red Team before final recommendation.'
        : 'Add Red Team review before any final approval request.',
      'Present final polished proposal with approval actions and next decree suggestions.',
    ],
    evidenceSources: [
      'Commander decree',
      'Live Council family lane assignments',
      'Runtime truth doctrine and provider status context',
      'Memory/repair ledger context when relevant',
      ...(research ? ['Live intelligence retrieval lane required before evidence-backed claims'] : []),
    ],
  }
}
