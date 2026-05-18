import type { CouncilCompressedFinding, CouncilCompressedSummary } from '@/lib/council/compression'

export const OPERATOR_ACTION_LABELS = [
  'Review telemetry confidence',
  'Prepare repair packet',
  'Check approval queue',
  'Run signal scan',
  'Log outcome',
  'Review revenue opportunity',
  'Open engineering diagnostics',
  'No urgent action',
] as const

export type OperatorActionLabel = (typeof OPERATOR_ACTION_LABELS)[number]

export type OperatorTruthClassification =
  | 'VERIFIED'
  | 'SOURCE_BACKED'
  | 'CONFIRMED'
  | 'UNVERIFIED'
  | 'MISSING'

export type OperatorRevenueOpportunitySource = {
  title: string | null | undefined
  isActive?: boolean | null
  source?: string | null
  platform?: string | null
  applyUrl?: string | null
  url?: string | null
  verificationStatus?: string | null
}

export type OperatorSummaryInput = {
  councilSummary: CouncilCompressedSummary
  systemState: string
  activeRepairTitle?: string | null
  incomeOpportunities: OperatorRevenueOpportunitySource[]
  signalResults: OperatorRevenueOpportunitySource[]
  growthBlock: string
  pendingApprovalCount: number
  pendingActionTitle?: string | null
  queueActionType?: string | null
  hasRuntimeWarning: boolean
}

export type OperatorSummary = {
  highestLeverageMove: OperatorActionLabel
  currentSystemState: string
  activeRepairPacketTitle: string
  topRevenueOpportunity: string
  growthBlock: string
  urgentWarning: string
  councilSummary: OperatorActionLabel
  nextApprovedAction: OperatorActionLabel
}

const SPECULATIVE_RISK_LANGUAGE =
  /\b(potential leakage|compromised|runaway|financial danger|silent bleeding|no kill switch|catastrophic|threat)\b/i

const RUNTIME_WARNING_AS_REVENUE =
  /\b(runtime|system|provider|telemetry|diagnostic|warning|risk|security|leakage|compromised|catastrophic|threat|kill switch)\b/i

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function stripOperatorTextArtifacts(value: string): string {
  return compactWhitespace(
    value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/^[\s>*•-]+/gm, '')
      .replace(/\b(?:priority|risk|evidence|finding|recommended action|next action|summary)\s*[:—-]\s*/gi, '')
      .replace(/[{}[\]"\\]/g, ' ')
      .replace(/\s*[:,]\s*/g, ' '),
  )
}

function isTrustedClassification(classification: OperatorTruthClassification): boolean {
  return classification === 'VERIFIED' || classification === 'SOURCE_BACKED' || classification === 'CONFIRMED'
}

function classificationForFinding(finding: CouncilCompressedFinding | undefined): OperatorTruthClassification {
  if (!finding) return 'MISSING'
  if (finding.evidenceWeight === 'verified') return 'VERIFIED'
  if (finding.evidenceWeight === 'source-backed') return 'SOURCE_BACKED'
  return 'UNVERIFIED'
}

function strongestCouncilClassification(summary: CouncilCompressedSummary): OperatorTruthClassification {
  if (summary.risk.redTeamCalibration === 'confirmed_issue') return 'CONFIRMED'
  const trusted = summary.evidence.find(
    item => item.evidenceWeight === 'verified' || item.evidenceWeight === 'source-backed',
  )
  return classificationForFinding(trusted)
}

function sourceBackedOpportunity(opportunity: OperatorRevenueOpportunitySource): boolean {
  const title = stripOperatorTextArtifacts(opportunity.title ?? '')
  if (!title || RUNTIME_WARNING_AS_REVENUE.test(title)) return false
  const url = opportunity.applyUrl ?? opportunity.url ?? ''
  const hasUrl = /^https:\/\//i.test(url)
  const hasSource = Boolean(opportunity.source?.trim() || opportunity.platform?.trim())
  const statusAllowsReview = !opportunity.verificationStatus || opportunity.verificationStatus === 'candidate'
  return statusAllowsReview && (hasUrl || hasSource)
}

function cleanOpportunityTitle(opportunities: OperatorRevenueOpportunitySource[]): string | null {
  const backed = opportunities.find(sourceBackedOpportunity)
  if (!backed?.title) return null
  return stripOperatorTextArtifacts(backed.title).slice(0, 140)
}

function cleanRepairTitle(title: string | null | undefined): string {
  const clean = stripOperatorTextArtifacts(title ?? '')
  if (!clean || clean === 'None active') return 'No urgent action'
  if (SPECULATIVE_RISK_LANGUAGE.test(clean)) return 'Prepare repair packet'
  return clean.slice(0, 140)
}

function mapCouncilToAction(summary: CouncilCompressedSummary): OperatorActionLabel {
  const rawText = stripOperatorTextArtifacts([
    summary.nextAction,
    summary.decisionSummary.join(' '),
    summary.risk.summary,
  ].join(' '))
  const classification = strongestCouncilClassification(summary)

  if (SPECULATIVE_RISK_LANGUAGE.test(rawText) && !isTrustedClassification(classification)) {
    return 'Review telemetry confidence'
  }
  if (summary.repairPacket?.applicable) return 'Prepare repair packet'
  if (summary.revenuePacket?.applicable && !RUNTIME_WARNING_AS_REVENUE.test(summary.revenuePacket.opportunity)) {
    return 'Review revenue opportunity'
  }
  if (/\b(signal|scan|radar|source-backed)\b/i.test(rawText)) return 'Run signal scan'
  if (/\b(approval|queue|commander)\b/i.test(rawText)) return 'Check approval queue'
  if (/\b(outcome|lesson|memory|ledger)\b/i.test(rawText)) return 'Log outcome'
  if (/\b(runtime|diagnostic|provider|telemetry)\b/i.test(rawText)) return 'Open engineering diagnostics'
  return 'Review telemetry confidence'
}

function urgentWarningFor(input: OperatorSummaryInput): string {
  if (input.hasRuntimeWarning) return 'Open engineering diagnostics'
  if (input.pendingApprovalCount > 0) return 'Check approval queue'

  const classification = strongestCouncilClassification(input.councilSummary)
  const riskText = stripOperatorTextArtifacts(input.councilSummary.risk.summary)
  if (input.councilSummary.risk.level !== 'high') return 'No verified urgent warning'
  if (SPECULATIVE_RISK_LANGUAGE.test(riskText) && !isTrustedClassification(classification)) {
    return 'Verification needed'
  }
  return isTrustedClassification(classification) ? 'Open engineering diagnostics' : 'Evidence missing'
}

export function buildCleanOperatorSummary(input: OperatorSummaryInput): OperatorSummary {
  const sourceBackedRevenueTitle =
    cleanOpportunityTitle(input.incomeOpportunities.filter(opportunity => opportunity.isActive !== false))
    ?? cleanOpportunityTitle(input.signalResults)
  const councilAction = mapCouncilToAction(input.councilSummary)
  const hasRepair = Boolean(input.activeRepairTitle || input.councilSummary.repairPacket?.applicable)
  const hasPendingApproval = input.pendingApprovalCount > 0 || Boolean(input.pendingActionTitle || input.queueActionType)

  const highestLeverageMove: OperatorActionLabel = sourceBackedRevenueTitle
    ? 'Review revenue opportunity'
    : hasRepair
      ? 'Prepare repair packet'
      : hasPendingApproval
        ? 'Check approval queue'
        : input.hasRuntimeWarning
          ? 'Open engineering diagnostics'
          : councilAction === 'Open engineering diagnostics'
            ? 'Review telemetry confidence'
            : councilAction

  return {
    highestLeverageMove,
    currentSystemState: stripOperatorTextArtifacts(input.systemState),
    activeRepairPacketTitle: input.activeRepairTitle
      ? cleanRepairTitle(input.activeRepairTitle)
      : hasRepair
        ? 'Prepare repair packet'
        : 'No urgent action',
    topRevenueOpportunity: sourceBackedRevenueTitle ?? 'No source-backed revenue opportunity',
    growthBlock: stripOperatorTextArtifacts(input.growthBlock),
    urgentWarning: urgentWarningFor(input),
    councilSummary: councilAction,
    nextApprovedAction: hasPendingApproval ? 'Check approval queue' : 'No urgent action',
  }
}
