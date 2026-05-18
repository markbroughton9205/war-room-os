import type { SignalAlert, SignalResult, SignalScan, SignalSnapshot, SignalSourceDefinition } from './model'

function guardrails(): SignalSnapshot['guardrails'] {
  return {
    cloudOnly: true,
    noLocalAgents: true,
    noOllama: true,
    noLmStudio: true,
    noBridge: true,
    noLocalhost: true,
    noFakeSignals: true,
    noAutomaticOutreachSpendApplicationsOrExecution: true,
    approvalRequiredBeforeAction: true,
  }
}

function integrationLines(results: SignalResult[]): SignalSnapshot['integrations'] {
  const top = results.filter(result => result.approvalStatus === 'pending_review').slice(0, 6)
  const strongest = top[0]
  return {
    revenueEngine: top.map(result => `${result.title} maps to Revenue Engine review with leverage ${result.scores.highestLeverage}; no income is claimed.`),
    babyDailyBriefing: top.map(result => `${result.assignedBabyFamily} briefing item: ${result.title} (${result.source}).`),
    opportunityPipeline: top.map(result => `${result.category}: ${result.recommendedNextAction}`),
    incomeOperationsBaby: top.filter(result => result.assignedBabyFamily === 'Income Operations Baby').map(result => `${result.title}: verify payout, terms, startup cost, and family impact.`),
    analystBaby: top.filter(result => result.assignedBabyFamily === 'Analyst Baby' || result.assignedBabyFamily === 'Claude Family Baby').map(result => `${result.title}: grade source evidence and buyer pain.`),
    redTeamBaby: results.filter(result => result.approvalStatus === 'low_confidence' || result.category === 'economic_warning').slice(0, 5).map(result => `${result.title}: challenge confidence, urgency, and distraction risk.`),
    featureBuilderSuggestions: top.filter(result => result.category === 'app_factory_opportunity' || result.assignedBabyFamily === 'Feature Builder').map(result => `Convert "${result.title}" into a proposal-only build packet after Commander approval.`)
      .concat(strongest && strongest.assignedBabyFamily !== 'Feature Builder' ? [`Strongest signal can seed Feature Builder only as a proposal: ${strongest.title}.`] : [])
      .slice(0, 6),
  }
}

function buildAlerts(results: SignalResult[], existing: SignalAlert[]): SignalAlert[] {
  const alerts = [...existing]
  const strongest = results.find(result => result.approvalStatus === 'pending_review')
  if (strongest) {
    alerts.unshift({
      id: `strongest-${strongest.id}`,
      severity: strongest.scores.highestLeverage >= 72 ? 'important' : 'info',
      title: 'Strongest source-backed signal ready for review',
      summary: `${strongest.title} scored ${strongest.scores.highestLeverage}. Next action remains manual and approval-gated: ${strongest.recommendedNextAction}`,
      sourceAttribution: `${strongest.source} (${strongest.url})`,
      approvalRequired: true,
      canExecute: false,
    })
  }

  const lowConfidenceCount = results.filter(result => result.approvalStatus === 'low_confidence').length
  if (lowConfidenceCount) {
    alerts.push({
      id: 'low-confidence-signal-warning',
      severity: 'watch',
      title: 'Low confidence signals were held back',
      summary: `${lowConfidenceCount} source-backed item(s) scored below confidence/relevance threshold and should not drive action without better evidence.`,
      sourceAttribution: 'Signal scoring confidence gate',
      approvalRequired: true,
      canExecute: false,
    })
  }

  alerts.push({
    id: 'signal-execution-boundary',
    severity: 'info',
    title: 'Signal Radar is recommendation-only',
    summary: 'Scans do not outreach, spend, apply for jobs, contact shippers, execute automations, run local agents, or claim income.',
    sourceAttribution: 'Phase 14 guardrail',
    approvalRequired: true,
    canExecute: false,
  })

  const seen = new Set<string>()
  return alerts.filter(alert => {
    const key = alert.id || `${alert.title}:${alert.summary}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 12)
}

export function buildSignalSnapshot(input: {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  sources: SignalSourceDefinition[]
  latestScan: SignalScan | null
  results: SignalResult[]
  alerts: SignalAlert[]
}): SignalSnapshot {
  const ranked = [...input.results].sort((a, b) => b.scores.highestLeverage - a.scores.highestLeverage)
  const sourceBacked = ranked.filter(result => result.guardrails.sourceBacked && result.url.startsWith('https://'))
  const strongestSignal = sourceBacked.find(result => result.approvalStatus === 'pending_review') ?? null
  return {
    generatedAt: input.generatedAt,
    persistenceAvailable: input.persistenceAvailable,
    persistenceNote: input.persistenceNote,
    sources: input.sources,
    latestScan: input.latestScan,
    results: sourceBacked,
    strongestSignal,
    rejectedOrLowConfidence: sourceBacked.filter(result => result.approvalStatus === 'rejected' || result.approvalStatus === 'low_confidence'),
    alerts: buildAlerts(sourceBacked, input.alerts),
    integrations: integrationLines(sourceBacked),
    guardrails: guardrails(),
  }
}
