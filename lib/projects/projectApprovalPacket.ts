import type { AnalystOperationsPacket } from '@/lib/analysts/analystOutcomeEvaluator'
import type { ProjectQualityGate } from './projectQualityGate'
import type { ProjectSynthesis } from './projectSynthesis'
import type { ProjectIntake, ProjectTask } from './projectTaskPlanner'

export type ProjectApprovalPacket = {
  id: string
  executiveSummary: string
  recommendedPath: string
  taskResults: Array<{
    taskId: string
    lane: ProjectTask['lane']
    title: string
    assignedTo: string
    status: ProjectTask['status']
    outputSummary: string
    confidence: number
  }>
  openRisks: string[]
  evidenceSources: string[]
  implementationPlan: string[]
  approvalActions: string[]
  nextDecreeSuggestions: string[]
  qualityGate: ProjectQualityGate
  analystFindings: string[]
  trendObservations: string[]
  opportunityScores: Array<{ label: string; score: number; band: string; rationale: string }>
  riskForecasts: string[]
  confidenceSummary: string
  anomalyAlerts: string[]
}

export function buildProjectApprovalPacket(input: {
  intake: ProjectIntake
  tasks: ProjectTask[]
  synthesis: ProjectSynthesis
  qualityGate: ProjectQualityGate
  analystPacket?: AnalystOperationsPacket | null
}): ProjectApprovalPacket {
  const { intake, tasks, synthesis, qualityGate, analystPacket } = input
  const hasEngineering = tasks.some(task => task.lane === 'engineering')
  const hasResearch = tasks.some(task => task.lane === 'research')
  const analystReport = analystPacket?.report

  return {
    id: `${intake.id}-approval`,
    executiveSummary: synthesis.executiveSummary,
    recommendedPath: synthesis.recommendedPath,
    taskResults: tasks.map(task => ({
      taskId: task.id,
      lane: task.lane,
      title: task.title,
      assignedTo: `${task.assigned_family} / ${task.assigned_agent_label}`,
      status: task.status,
      outputSummary: task.output_summary,
      confidence: task.confidence,
    })),
    openRisks: qualityGate.openRisks,
    evidenceSources: synthesis.evidenceSources,
    implementationPlan: synthesis.implementationPlan,
    approvalActions: [
      'Approve lane work to proceed under Commander-visible supervision.',
      ...(hasResearch ? ['Approve live research retrieval before final evidence-backed synthesis.'] : []),
      ...(hasEngineering ? ['Approve Cursor engineering packet before file changes or validation commands.'] : []),
      'Approve final proposal before commit, push, deploy, external outreach, purchase, legal reliance, or public release.',
    ],
    nextDecreeSuggestions: [
      `Approve project packet ${intake.id} for lane work only; no external action without final approval.`,
      `Pause project packet ${intake.id}; hold all lanes pending Commander redirect.`,
      `Deepen project packet ${intake.id}: require stronger evidence, alternate paths, and Red Team objections.`,
      `Redirect project packet ${intake.id}: update scope, constraints, target audience, deadline, and success criteria.`,
    ],
    qualityGate,
    analystFindings: analystReport?.findings.map(finding => `${finding.title}: ${finding.summary}`) ?? [
      'Analyst support not attached; request analyze/evaluate/score to add outcome intelligence.',
    ],
    trendObservations: analystReport?.trendSnapshots ?? [
      'Track project outcomes, approval outcomes, provider effectiveness, repair frequency, and retrieval success after lane work.',
    ],
    opportunityScores: analystPacket
      ? [
          {
            label: analystPacket.scoring.opportunity.label,
            score: analystPacket.scoring.opportunity.value,
            band: analystPacket.scoring.opportunity.band,
            rationale: analystPacket.scoring.opportunity.rationale,
          },
          {
            label: analystPacket.scoring.operationalImpact.label,
            score: analystPacket.scoring.operationalImpact.value,
            band: analystPacket.scoring.operationalImpact.band,
            rationale: analystPacket.scoring.operationalImpact.rationale,
          },
        ]
      : [],
    riskForecasts: analystReport?.forecastCards.map(card => `${card.title}: ${card.scenario} Risk: ${card.risk}`) ?? [
      'Risk forecast pending analyst lane data.',
    ],
    confidenceSummary: analystReport?.confidenceSummary ?? 'Confidence summary pending analyst lane data.',
    anomalyAlerts: analystReport?.anomalyAlerts ?? ['No analyst anomaly scan attached yet.'],
  }
}
