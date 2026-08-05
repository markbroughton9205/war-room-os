import type { NormalizedOpportunitySourceRecord, SourceRefreshResult } from '@/lib/opportunity-agents/sources/types'

export type SourceAccessClassification =
  | 'PUBLIC_OFFICIAL_API'
  | 'PUBLIC_NEWS_API'
  | 'OFFICIAL_RSS'
  | 'FREE_KEY_COMMERCIAL'
  | 'FREE_KEY_NONCOMMERCIAL'
  | 'DEVELOPMENT_ONLY'
  | 'PAID_COMMERCIAL_LICENSE'
  | 'APPROVED_EXTRACTION'
  | 'METADATA_ONLY'
  | 'MANUAL_ONLY'
  | 'TERMS_REVIEW_REQUIRED'
  | 'WRITTEN_PERMISSION_REQUIRED'
  | 'AUTOMATION_PROHIBITED'
  | 'EXTRACTION_NOT_AUTHORIZED'

export type CommercialUseStatus = 'ALLOWED' | 'DEVELOPMENT_ONLY' | 'NONCOMMERCIAL_ONLY' | 'TERMS_REVIEW_REQUIRED' | 'WRITTEN_PERMISSION_REQUIRED'
export type MetadataUseStatus = 'ALLOWED' | 'METADATA_ONLY' | 'TERMS_REVIEW_REQUIRED' | 'BLOCKED'
export type FullTextUseStatus = 'ALLOWED' | 'SNIPPET_ONLY' | 'METADATA_ONLY' | 'LICENSE_REQUIRED' | 'BLOCKED'
export type SourceAuthority = 'NEWS_SIGNAL' | 'OFFICIAL_PRIMARY' | 'COURT_AUTHORITY' | 'HISTORICAL_AWARD_INTELLIGENCE' | 'SEARCH_METADATA' | 'UNKNOWN'
export type ExtractionPermission = 'AUTHORIZED' | 'METADATA_ONLY' | 'SNIPPET_ONLY' | 'EXTRACTION_NOT_AUTHORIZED'
export type IntelligenceConnectionState = 'CONNECTED' | 'NOT_CONFIGURED' | 'DEVELOPMENT_ONLY' | 'TERMS_REVIEW_REQUIRED' | 'BOUNDARY_ONLY' | 'RATE_LIMITED' | 'FAILED'

export type SourcePermission = {
  sourceId: string
  sourceName: string
  category: string
  officialDocumentation: string
  accessMethod: SourceAccessClassification
  accountRequirement: string
  credentialRequirement: string
  licenseClass: string
  commercialUseStatus: CommercialUseStatus
  metadataUseStatus: MetadataUseStatus
  fullTextUseStatus: FullTextUseStatus
  attributionRequirement: string | null
  pollingLimit: string
  rateLimit: string
  sourceAuthority: SourceAuthority
  extractionPermission: ExtractionPermission
  connectionState: IntelligenceConnectionState
  lastVerifiedAt: string | null
  lastSuccessfulRefresh: string | null
  lastFailure: string | null
  failureReason: string | null
  retentionRule: string
  permittedAgentUses: string[]
}

export type TruthLabel =
  | 'NEWS_SIGNAL_ONLY'
  | 'PRIMARY_SOURCE_CONFIRMED'
  | 'OFFICIAL_GUIDANCE_CONFIRMED'
  | 'COURT_AUTHORITY_FOUND'
  | 'PROPOSED_NOT_LAW'
  | 'JURISDICTION_LIMITED'
  | 'ELIGIBILITY_UNCONFIRMED'
  | 'PROFESSIONAL_REVIEW_REQUIRED'
  | 'EXPIRED'
  | 'APPLICATION_WINDOW_OPEN'
  | 'APPLICATION_WINDOW_CLOSED'
  | 'POSSIBLE_VALUE'
  | 'ESTIMATED_VALUE'
  | 'ACTUAL_AWARD'
  | 'ACTUAL_PAYMENT'
  | 'REJECTED_AS_UNLAWFUL'
  | 'REJECTED_AS_UNSUPPORTED'

export type CorroborationStatus =
  | 'NEWS_ONLY'
  | 'OFFICIAL_SOURCE_FOUND'
  | 'OFFICIAL_SOURCE_CONFLICTS'
  | 'OFFICIAL_SOURCE_NOT_FOUND'
  | 'OUTDATED'
  | 'MISLEADING'
  | 'VERIFIED_EVENT'

export type LegislativeState =
  | 'INTRODUCED'
  | 'IN_COMMITTEE'
  | 'PASSED_HOUSE'
  | 'PASSED_SENATE'
  | 'ENROLLED'
  | 'SIGNED_INTO_LAW'
  | 'FAILED'
  | 'VETOED'
  | 'UNKNOWN'

export type LegalStatus = 'proposed' | 'pending' | 'enacted' | 'effective' | 'expired' | 'stayed' | 'blocked_by_court' | 'under_appeal' | 'unknown'
export type ProfessionalEscalation = 'ATTORNEY_REVIEW_REQUIRED' | 'CPA_REVIEW_REQUIRED' | 'AGENCY_CONFIRMATION_REQUIRED' | 'PROVIDER_PERMISSION_REQUIRED'
export type ValueKind = 'advertised_maximum' | 'estimated_value' | 'likely_eligible_value' | 'reimbursable_expense' | 'refundable_credit' | 'nonrefundable_credit' | 'refundability_unknown_tax_credit' | 'deduction' | 'loan' | 'grant' | 'contract_ceiling' | 'expected_contract_value' | 'actual_award' | 'actual_payment'
export type TaxCreditRefundability = 'REFUNDABILITY_CONFIRMED' | 'NONREFUNDABILITY_CONFIRMED' | 'REFUNDABILITY_UNKNOWN'
export type CommanderPolicyState = 'COMMANDER_POLICY_UNCONFIGURED'

export type NewsSignal = {
  signalId: string
  sourceId: string
  title: string
  publisher: string
  url: string
  publicationTimestamp: string | null
  retrievalTimestamp: string
  language: string | null
  geographicContext: string[]
  snippet: string
  contentHash: string
  truthLabels: TruthLabel[]
  retainedFullText: false
}

export type OfficialSourceRecord = {
  sourceId: string
  sourceName: string
  title: string
  officialUrl: string
  documentNumber: string | null
  documentType: string | null
  agency: string | null
  agencies: string[]
  publicationDate: string | null
  enactedDate: string | null
  effectiveDate: string | null
  expirationDate: string | null
  commentDeadline: string | null
  jurisdiction: string | null
  citation: string | null
  precedentialStatus: string | null
  caseStatus: string | null
  legislativeState?: LegislativeState
  legalStatus: LegalStatus
  truthLabels: TruthLabel[]
  rawMetadata: Record<string, unknown>
}

export type LawfulOpportunityPathway = {
  pathwayId: string
  pathwayType: string
  title: string
  sourceUrl: string | null
  officialSourceUrl: string | null
  truthLabels: TruthLabel[]
  eligibilityStatus: 'eligible' | 'not_eligible' | 'unknown' | 'needs_review'
  requiredFacts: string[]
  missingFacts: string[]
  valueKind: ValueKind
  taxCreditRefundability: TaxCreditRefundability | null
  valueNarrative: string
  professionalEscalations: ProfessionalEscalation[]
  blockedReasons: string[]
}

export type NewsOpportunityPipelineStage =
  | 'NEWS_SIGNAL'
  | 'SOURCE_PERMISSION_CHECK'
  | 'DUPLICATE_CHECK'
  | 'SOURCE_RELIABILITY'
  | 'OFFICIAL_SOURCE_CORROBORATION'
  | 'LEGAL_STATUS_CLASSIFICATION'
  | 'LAWFUL_PATHWAY_IDENTIFICATION'
  | 'ELIGIBILITY_ANALYSIS'
  | 'STACKING_AND_CONFLICT_CHECK'
  | 'VALUE_ANALYSIS'
  | 'FRAUD_AND_ABUSE_REVIEW'
  | 'PROFESSIONAL_ESCALATION'
  | 'WORK_PACKET'
  | 'AWAIT_COMMANDER_APPROVAL'

export type NewsOpportunityWorkPacket = {
  packetId: string
  generatedAt: string
  pipelineStages: NewsOpportunityPipelineStage[]
  signal: NewsSignal | null
  officialSources: OfficialSourceRecord[]
  corroborationStatus: CorroborationStatus
  legalStatus: LegalStatus
  lawfulPathways: LawfulOpportunityPathway[]
  eligibilityFindings: string[]
  valueFindings: string[]
  fraudAndAbuseFindings: string[]
  professionalEscalations: ProfessionalEscalation[]
  commanderPolicyState: CommanderPolicyState
  technicalAuditTrail: string[]
  truthLabels: TruthLabel[]
  commanderApprovalRequired: true
  externalActionsExecuted: false
  retention: {
    fullTextStored: false
    retainedFields: string[]
  }
}

export type NetworkFetchResult = {
  ok: boolean
  status: number
  contentType: string
  url: string
  redirected: boolean
  body: string
  error: string | null
}

export type ConnectorResult<T> = {
  sourceId: string
  status: 'success' | 'not_configured' | 'boundary_only' | 'terms_review_required' | 'failed'
  records: T[]
  failure: string | null
  externalActionsExecuted: false
}

export type SamReuseResult = SourceRefreshResult
export type UsaSpendingReuseRecord = NormalizedOpportunitySourceRecord
