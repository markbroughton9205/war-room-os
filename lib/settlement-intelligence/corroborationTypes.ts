export const SETTLEMENT_DISCOVERY_ONLY = true as const

export type SettlementAggregator = 'settlesignal' | 'classaction_org'
export type OfficialAuthority = 'OFFICIAL_ADMIN' | 'OFFICIAL_COURT' | 'OFFICIAL_GOVERNMENT'
export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'CONFLICT' | 'UNAVAILABLE'
export type VerificationField = 'deadline' | 'proofRequirement' | 'benefit' | 'classDefinition' | 'claimFormUrl'
export type BenefitType = 'FIXED' | 'UP_TO' | 'PRO_RATA' | 'TIERED' | 'REIMBURSEMENT' | 'UNKNOWN'

export type Benefit = {
  type: BenefitType
  amount: number | null
  currency: string | null
  text: string
  proRata: { numerator: number | null; denominator: number | null; netFundAmount: number | null } | null
  tiers: Array<{ name: string; requirement: string; amount: number | null }> | null
}

export type Provenance = {
  url: string
  sourceClass: 'AGGREGATOR' | OfficialAuthority
  retrievedAt: string
  httpStatus: number | null
  contentType: string | null
  observedLatencyMs: number | null
}

export type FieldVerification = {
  field: VerificationField
  status: VerificationStatus
  value: string | null
  source: Provenance | null
  verifiedBy: OfficialAuthority | null
  note: string | null
}

export type SettlementDiscovery = {
  id: string
  provider: SettlementAggregator
  title: string
  recordUrl: string
  deadline: string | null
  proofRequirement: string | null
  benefit: Benefit
  classDefinition: string | null
  claimFormUrl: string | null
  officialSourceCandidates: string[]
  provenance: Provenance
  rawText: string
}

export type CorroboratedSettlement = {
  key: string
  discoveries: SettlementDiscovery[]
  corroboration: 'SINGLE_SOURCE' | 'DUAL_AGGREGATOR_CORROBORATED'
  officialSourceVerified: boolean
  fields: Record<VerificationField, FieldVerification>
}
