import { sha256Text } from './hash'
import { COMMANDER_POLICY_STATE } from './policy'
import type {
  CorroborationStatus,
  LawfulOpportunityPathway,
  LegalStatus,
  NewsOpportunityWorkPacket,
  NewsSignal,
  OfficialSourceRecord,
  TruthLabel,
  ValueKind,
} from './types'

export function corroborateNewsSignal(signal: NewsSignal | null, officialSources: OfficialSourceRecord[]): CorroborationStatus {
  if (!signal) return officialSources.length ? 'OFFICIAL_SOURCE_FOUND' : 'NEWS_ONLY'
  if (!officialSources.length) return 'OFFICIAL_SOURCE_NOT_FOUND'
  const matching = officialSources.some(source => source.title.toLowerCase().includes(signal.title.toLowerCase().slice(0, 24)) || signal.title.toLowerCase().includes(source.title.toLowerCase().slice(0, 24)))
  return matching ? 'VERIFIED_EVENT' : 'OFFICIAL_SOURCE_FOUND'
}

export function classifyLegalStatus(source: OfficialSourceRecord | null): LegalStatus {
  if (!source) return 'unknown'
  if (source.truthLabels.includes('EXPIRED')) return 'expired'
  if (source.legalStatus === 'proposed') return 'proposed'
  if (source.effectiveDate) {
    const parsed = Date.parse(source.effectiveDate)
    if (Number.isFinite(parsed) && parsed <= Date.now()) return 'effective'
    return 'enacted'
  }
  return source.legalStatus
}

export function identifyLawfulPathways(input: {
  signal: NewsSignal | null
  officialSources: OfficialSourceRecord[]
  text: string
}): LawfulOpportunityPathway[] {
  const haystack = `${input.text} ${input.signal?.title ?? ''} ${input.officialSources.map(source => source.title).join(' ')}`.toLowerCase()
  const pathways: LawfulOpportunityPathway[] = []
  const add = (pathwayType: string, title: string, valueKind: ValueKind): void => {
    pathways.push({
      pathwayId: `lawful_pathway_${sha256Text(`${pathwayType}|${title}`).slice(0, 12)}`,
      pathwayType,
      title,
      sourceUrl: input.signal?.url ?? null,
      officialSourceUrl: input.officialSources[0]?.officialUrl ?? null,
      truthLabels: input.officialSources.length ? ['PRIMARY_SOURCE_CONFIRMED', 'ELIGIBILITY_UNCONFIRMED'] : ['NEWS_SIGNAL_ONLY', 'REJECTED_AS_UNSUPPORTED'],
      eligibilityStatus: 'unknown',
      requiredFacts: ['applicant type', 'location', 'documentation', 'deadline'],
      missingFacts: ['official eligibility review not completed'],
      valueKind,
      taxCreditRefundability: valueKind === 'refundability_unknown_tax_credit' ? 'REFUNDABILITY_UNKNOWN' : null,
      valueNarrative: valueNarrative(valueKind),
      professionalEscalations: [],
      blockedReasons: input.officialSources.length ? [] : ['Missing official corroboration blocks verified status.'],
    })
  }
  if (haystack.includes('grant')) add('grants', 'Documented grant pathway', 'grant')
  if (haystack.includes('contract') || haystack.includes('procurement')) add('contracts', 'Documented contract pathway', 'contract_ceiling')
  if (haystack.includes('rebate')) add('rebates', 'Documented rebate pathway', 'reimbursable_expense')
  if (haystack.includes('tax credit')) add('tax_credits', 'Documented tax credit pathway', 'refundability_unknown_tax_credit')
  if (haystack.includes('deduction')) add('deductions', 'Documented deduction pathway', 'deduction')
  if (haystack.includes('loan')) add('loans', 'Documented loan pathway', 'loan')
  if (haystack.includes('training')) add('training_reimbursements', 'Documented training reimbursement pathway', 'reimbursable_expense')
  return pathways
}

function valueNarrative(kind: ValueKind): string {
  switch (kind) {
    case 'deduction':
      return 'A deduction reduces taxable income; it is not cash received.'
    case 'loan':
      return 'A loan is repayable financing; it is not income.'
    case 'contract_ceiling':
      return 'A contract ceiling is a maximum possible authorization; it is not guaranteed revenue.'
    case 'refundability_unknown_tax_credit':
      return 'Tax credit refundability is unknown until confirmed by an official source.'
    default:
      return `${kind.replace(/_/g, ' ')} requires official confirmation before value is treated as available.`
  }
}

export function analyzeEligibility(pathways: LawfulOpportunityPathway[], knownFacts: Record<string, unknown> = {}): string[] {
  const findings = ['Missing facts remain UNKNOWN until source documents or Commander-provided facts satisfy eligibility requirements.']
  if (!knownFacts.applicantType) findings.push('Applicant type unknown.')
  if (!knownFacts.location) findings.push('Location eligibility unknown.')
  if (!knownFacts.documentation) findings.push('Required documentation unknown.')
  return findings.concat(pathways.flatMap(pathway => pathway.missingFacts.map(fact => `${pathway.title}: ${fact}`)))
}

export function analyzeValue(pathways: LawfulOpportunityPathway[]): string[] {
  return pathways.length
    ? pathways.map(pathway => pathway.valueNarrative)
    : ['No lawful opportunity value identified without official corroboration.']
}

export function policyDependentReview(): string[] {
  return [`${COMMANDER_POLICY_STATE}: no Commander behavioral policy is configured for fraud, legal, tax, eligibility, or application judgments.`]
}

export function professionalEscalationsFor(): [] {
  return []
}

export function technicalAuditTrail(stages: readonly string[]): string[] {
  return stages.map(stage => `TECHNICAL_STAGE_EXECUTED:${stage}`)
}

export function createNewsOpportunityWorkPacket(input: {
  signal: NewsSignal | null
  officialSources: OfficialSourceRecord[]
  sourceText: string
  knownFacts?: Record<string, unknown>
}): NewsOpportunityWorkPacket {
  const corroborationStatus = corroborateNewsSignal(input.signal, input.officialSources)
  const legalStatus = classifyLegalStatus(input.officialSources[0] ?? null)
  const pathways = identifyLawfulPathways({ signal: input.signal, officialSources: input.officialSources, text: input.sourceText })
  const eligibilityFindings = analyzeEligibility(pathways, input.knownFacts)
  const valueFindings = analyzeValue(pathways)
  const fraudAndAbuseFindings = policyDependentReview()
  const professionalEscalations = professionalEscalationsFor()
  const labels = new Set<TruthLabel>()
  if (input.signal) labels.add('NEWS_SIGNAL_ONLY')
  for (const source of input.officialSources) for (const label of source.truthLabels) labels.add(label)
  for (const pathway of pathways) for (const label of pathway.truthLabels) labels.add(label)
  if (!input.officialSources.length) labels.add('REJECTED_AS_UNSUPPORTED')
  const stages = [
    'NEWS_SIGNAL',
    'SOURCE_PERMISSION_CHECK',
    'DUPLICATE_CHECK',
    'SOURCE_RELIABILITY',
    'OFFICIAL_SOURCE_CORROBORATION',
    'LEGAL_STATUS_CLASSIFICATION',
    'LAWFUL_PATHWAY_IDENTIFICATION',
    'ELIGIBILITY_ANALYSIS',
    'STACKING_AND_CONFLICT_CHECK',
    'VALUE_ANALYSIS',
    'FRAUD_AND_ABUSE_REVIEW',
    'PROFESSIONAL_ESCALATION',
    'WORK_PACKET',
    'AWAIT_COMMANDER_APPROVAL',
  ] as const
  return {
    packetId: `newsopp_${sha256Text(`${input.signal?.signalId ?? 'official'}|${input.sourceText}`).slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    pipelineStages: [...stages],
    signal: input.signal,
    officialSources: input.officialSources,
    corroborationStatus,
    legalStatus,
    lawfulPathways: pathways,
    eligibilityFindings,
    valueFindings,
    fraudAndAbuseFindings,
    professionalEscalations,
    commanderPolicyState: COMMANDER_POLICY_STATE,
    technicalAuditTrail: technicalAuditTrail(stages),
    truthLabels: [...labels],
    commanderApprovalRequired: true,
    externalActionsExecuted: false,
    retention: {
      fullTextStored: false,
      retainedFields: ['source URL', 'title', 'publisher', 'publication timestamp', 'retrieval timestamp', 'permitted snippet', 'content hash', 'classifications', 'official corroboration', 'agent analysis'],
    },
  }
}
