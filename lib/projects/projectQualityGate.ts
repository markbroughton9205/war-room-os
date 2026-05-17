import type { ProjectIntake, ProjectTask } from './projectTaskPlanner'

export type ProjectQualityGateStatus = 'pass' | 'needs_commander_approval' | 'blocked'

export type ProjectQualityGateCheck = {
  id: string
  label: string
  status: ProjectQualityGateStatus
  detail: string
}

export type ProjectQualityGate = {
  status: ProjectQualityGateStatus
  redTeamSummary: string
  checks: ProjectQualityGateCheck[]
  openRisks: string[]
}

function check(id: string, label: string, status: ProjectQualityGateStatus, detail: string): ProjectQualityGateCheck {
  return { id, label, status, detail }
}

export function buildProjectQualityGate(intake: ProjectIntake, tasks: ProjectTask[]): ProjectQualityGate {
  const missingApproval = tasks.filter(task => !task.approval_required)
  const hasRiskReview = tasks.some(task => task.lane === 'risk_review')
  const hasFinalSynthesis = tasks.some(task => task.lane === 'final_synthesis')
  const legalPlaceholder = tasks.some(task => task.lane === 'legal_compliance')

  const checks: ProjectQualityGateCheck[] = [
    check(
      'turn_discipline',
      'Turn discipline',
      'pass',
      'Project packet prepares lane work without autonomous continuation beyond Commander-directed flow.',
    ),
    check(
      'approval_gates',
      'Approval gates',
      missingApproval.length ? 'blocked' : 'needs_commander_approval',
      missingApproval.length
        ? `Missing approval flag on ${missingApproval.length} task(s).`
        : 'All lanes require Commander approval before execution or external action.',
    ),
    check(
      'engineering_bridge',
      'Engineering bridge',
      tasks.some(task => task.lane === 'engineering') ? 'needs_commander_approval' : 'pass',
      tasks.some(task => task.lane === 'engineering')
        ? 'Cursor lane is prepared as a handoff packet; War Room does not mutate files from the card.'
        : 'No repo execution lane was required by this decree.',
    ),
    check(
      'red_team_review',
      'Red Team review',
      hasRiskReview ? 'needs_commander_approval' : 'blocked',
      hasRiskReview ? 'Red Team lane assigned for contradictions, weakness detection, and approval boundary review.' : 'Risk review lane missing.',
    ),
    check(
      'final_synthesis',
      'Final synthesis',
      hasFinalSynthesis ? 'needs_commander_approval' : 'blocked',
      hasFinalSynthesis ? 'Final synthesis lane assigned after lane outputs and Red Team review.' : 'Final synthesis lane missing.',
    ),
  ]

  const openRisks = [
    'Lane outputs are planned, not executed; confidence reflects routing quality, not completed work.',
    'Live research claims require source retrieval before final evidence-backed synthesis.',
    'Commander approval is required before repo mutation, external outreach, legal reliance, deployment, commit, or push.',
    ...(legalPlaceholder ? ['Legal/compliance lane is a placeholder and may require specialist review.'] : []),
  ]

  return {
    status: checks.some(row => row.status === 'blocked') ? 'blocked' : 'needs_commander_approval',
    redTeamSummary:
      `Red Team posture for ${intake.id}: inspect dependency gaps, false confidence, missing evidence, legal/compliance assumptions, and approval boundary drift before final approval.`,
    checks,
    openRisks,
  }
}
