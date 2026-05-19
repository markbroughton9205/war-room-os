import type { CouncilCompressedFinding, CouncilCompressedSummary } from '@/lib/council/compression'
import { sanitizeMemoryRuntimeText } from '@/lib/memory/runtimeState'

export const OPERATOR_ACTION_LABELS = [
  'Review telemetry confidence',
  'Prepare repair packet',
  'Review approval queue',
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
  highestLeverageMove: string
  currentSystemState: string
  activeRepairPacketTitle: string
  topRevenueOpportunity: string
  growthBlock: string
  urgentWarning: string
  councilSummary: string
  nextApprovedAction: string
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
    sanitizeMemoryRuntimeText(value)
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

function isOperatorActionLabel(value: string): boolean {
  return OPERATOR_ACTION_LABELS.some(label => label.toLowerCase() === value.toLowerCase())
}

function isDisplayableOperatorContent(value: string): boolean {
  if (!value) return false
  if (isOperatorActionLabel(value)) return false
  if (/^prepare repair packet$/i.test(value)) return false
  if (/^(none active|no urgent action|loading|pending|not available yet)$/i.test(value)) return false
  if (/^no (current evidence note|action recommended|source-backed signal loaded|durable lesson evidence)/i.test(value)) return false
  if (/^(council is waiting|ask the council|generate a manual repair packet)/i.test(value)) return false
  if (/\bmemory items? available\b/i.test(value)) return false
  return true
}

function cleanDisplayContent(value: string | null | undefined): string | null {
  const clean = stripOperatorTextArtifacts(value ?? '')
  if (!isDisplayableOperatorContent(clean)) return null
  return clean.slice(0, 140)
}

function cleanOpportunityTitle(opportunities: OperatorRevenueOpportunitySource[]): string | null {
  const backed = opportunities.find(sourceBackedOpportunity)
  return cleanDisplayContent(backed?.title)
}

function cleanRepairTitle(title: string | null | undefined): string | null {
  return cleanDisplayContent(title)
}

function councilFindingSummary(summary: CouncilCompressedSummary): string {
  const finding =
    summary.evidence.find(item => item.evidenceWeight === 'verified' || item.evidenceWeight === 'source-backed')
    ?? summary.evidence.find(item => item.evidenceWeight === 'inferred' || item.evidenceWeight === 'uncertain')
  const cleanFinding = cleanDisplayContent(finding?.text)
  if (cleanFinding) return cleanFinding

  const cleanDecision = summary.decisionSummary
    .map(item => cleanDisplayContent(item))
    .find(Boolean)
  return cleanDecision ?? 'No council summary yet'
}

function highestLeverageMoveFor(input: OperatorSummaryInput, revenueTitle: string | null, signalTitle: string | null): string {
  const pendingTitle = cleanDisplayContent(input.pendingActionTitle)
  if (pendingTitle) return pendingTitle
  if (revenueTitle) return revenueTitle
  if (signalTitle) return signalTitle

  const growthBlock = cleanDisplayContent(input.growthBlock)
  if (growthBlock) return growthBlock

  if (input.pendingApprovalCount > 0 || input.queueActionType) return 'Review approval queue'
  return input.hasRuntimeWarning ? 'Review approval queue' : 'Run signal scan'
}

function urgentWarningFor(input: OperatorSummaryInput): string {
  if (input.hasRuntimeWarning) return 'Open engineering diagnostics'
  if (input.pendingApprovalCount > 0) return 'Review approval queue'

  const classification = strongestCouncilClassification(input.councilSummary)
  const riskText = stripOperatorTextArtifacts(input.councilSummary.risk.summary)
  if (input.councilSummary.risk.level !== 'high') return 'No verified urgent warning'
  if (SPECULATIVE_RISK_LANGUAGE.test(riskText) && !isTrustedClassification(classification)) {
    return 'Verification needed'
  }
  return isTrustedClassification(classification) ? 'Open engineering diagnostics' : 'Evidence missing'
}

export function buildCleanOperatorSummary(input: OperatorSummaryInput): OperatorSummary {
  const sourceBackedRevenueTitle = cleanOpportunityTitle(input.incomeOpportunities.filter(opportunity => opportunity.isActive !== false))
  const sourceBackedSignalTitle = cleanOpportunityTitle(input.signalResults)
  const topOpportunityTitle = sourceBackedRevenueTitle ?? sourceBackedSignalTitle
  const hasPendingApproval = input.pendingApprovalCount > 0 || Boolean(input.pendingActionTitle || input.queueActionType)
  const repairTitle = cleanRepairTitle(input.activeRepairTitle)

  return {
    highestLeverageMove: highestLeverageMoveFor(input, sourceBackedRevenueTitle, sourceBackedSignalTitle),
    currentSystemState: stripOperatorTextArtifacts(input.systemState),
    activeRepairPacketTitle: repairTitle ?? 'No active repair packet',
    topRevenueOpportunity: topOpportunityTitle ?? 'No source-backed revenue opportunity',
    growthBlock: cleanDisplayContent(input.growthBlock) ?? 'No growth block yet',
    urgentWarning: urgentWarningFor(input),
    councilSummary: councilFindingSummary(input.councilSummary),
    nextApprovedAction: hasPendingApproval ? 'Review approval queue' : 'No approved action queued',
  }
}
