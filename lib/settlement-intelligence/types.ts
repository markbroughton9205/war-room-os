export type OfficialSourceState = 'AGGREGATOR_ONLY'|'OFFICIAL_CANDIDATE'|'OFFICIAL_SOURCE_VERIFIED'|'OFFICIAL_SOURCE_CONFLICT'|'OFFICIAL_SOURCE_UNAVAILABLE'
export type DocumentationRequirement = 'NO_DOCUMENTATION_REQUIRED'|'PROOF_OF_PURCHASE_NOT_REQUIRED'|'DOCUMENTATION_OPTIONAL'|'DOCUMENTATION_REQUIRED'|'DOCUMENTATION_REQUIREMENT_UNKNOWN'
export type EligibilityState = 'UNKNOWN_FACTS_REQUIRED'|'POSSIBLY_ELIGIBLE_COMMANDER_REVIEW'|'ELIGIBLE_CONFIRMED'|'NOT_ELIGIBLE'
export type DeadlineState = 'DUE_WITHIN_48_HOURS'|'DUE_WITHIN_7_DAYS'|'DUE_WITHIN_30_DAYS'|'OPEN'|'EXPIRED'
export type SettlementPriority = 'CLAIM_NOW'|'HIGH_PRIORITY'|'REVIEW'|'LOW_PRIORITY'|'EXPIRED'
export type WorkflowState = 'DISCOVERED'|'OFFICIAL_SOURCE_VERIFIED'|'ELIGIBILITY_REVIEW'|'CLAIM_READY'|'CLAIM_PREPARED'|'WAITING_FOR_COMMANDER'|'CLAIM_SUBMITTED'|'PAYMENT_PENDING'|'PAYMENT_VERIFIED'|'CASH_RECEIVED'
export type ProvenanceKind = 'AGGREGATOR'|'OFFICIAL_PAGE'|'OFFICIAL_NOTICE'|'OFFICIAL_FAQ'|'OFFICIAL_CLAIM_FORM'|'SETTLEMENT_AGREEMENT'

export interface Provenance { kind:ProvenanceKind; url:string; retrievedAt:string; httpStatus:number; evidence:string[] }
export interface ClaimTier { name:string; benefit:string|null; documentationRequirement:DocumentationRequirement; evidence:string|null }
export interface OfficialTerms {
  settlementName:string|null; defendant:string|null; caseNumber:string|null; court:string|null; administrator:string|null; classDefinition:string|null
  claimDeadline:string|null; exclusionDeadline:string|null; objectionDeadline:string|null; finalApprovalAt:string|null
  claimFormUrl:string|null; officialNoticeUrl:string|null; faqUrl:string|null; settlementAgreementUrl:string|null
  settlementFund:string|null; estimatedBenefit:string|null; claimTiers:ClaimTier[]; documentationRequirement:DocumentationRequirement
  documentationEvidence:string|null; paymentMethod:string|null
}
export interface EligibilityQuestion { id:string; fact:string; prompt:string }
export interface SettlementRecord {
  id:string; name:string; defendant:string|null; aggregatorUrl:string; officialUrl:string|null; officialSourceState:OfficialSourceState
  terms:OfficialTerms; deadlineState:DeadlineState; priority:SettlementPriority; eligibilityState:EligibilityState; eligibilityQuestions:EligibilityQuestion[]
  workflowState:WorkflowState; provenance:Provenance[]; discoveredAt:string; updatedAt:string; claimSubmitted:false; cashReceived:false
}
export interface DiscoveryListing { title:string; defendant:string|null; listingUrl:string; aggregatorDeadline:string|null; aggregatorProofClaim:string|null; candidateUrls:string[]; retrievedAt:string; provenance:Provenance }
export interface NotificationRecord { id:string; settlementId:string; fingerprint:string; createdAt:string; state:'NOTIFICATION_GENERATED'; delivery:'EXTERNAL_DELIVERY_NOT_ATTEMPTED'; message:string }
export interface FetchResponse { url:string; status:number; text:string; contentType:string }
export type SafeFetch = (url:string)=>Promise<FetchResponse>
