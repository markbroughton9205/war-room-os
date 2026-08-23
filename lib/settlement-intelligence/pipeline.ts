import type { DiscoveryListing,SafeFetch,SettlementRecord } from './types'
import { discoverClassActionListings,hydrateListingCandidates } from './discovery'
import { resolveOfficialSource } from './resolver'
import { classifyDeadline,parseOfficialDate,rankPriority } from './deadlines'
import { deriveEligibilityQuestions } from './eligibility'
import { stableSettlementId } from './identity'
import { generateNotification } from './notifications'
import { settlementStore } from './store'
import { liveSafeFetch } from './fetch'

export async function normalizeListing(listing:DiscoveryListing,fetcher:SafeFetch,now=new Date()):Promise<SettlementRecord>{
  const hydrated=listing.candidateUrls.length?listing:await hydrateListingCandidates(listing,fetcher),resolved=await resolveOfficialSource(hydrated,fetcher)
  const fallback={settlementName:null,defendant:null,caseNumber:null,court:null,administrator:null,classDefinition:null,claimDeadline:null,exclusionDeadline:null,objectionDeadline:null,finalApprovalAt:null,claimFormUrl:null,officialNoticeUrl:null,faqUrl:null,settlementAgreementUrl:null,settlementFund:null,estimatedBenefit:null,claimTiers:[],documentationRequirement:'DOCUMENTATION_REQUIREMENT_UNKNOWN' as const,documentationEvidence:null,paymentMethod:null}
  const terms=resolved.terms??fallback;terms.claimDeadline=parseOfficialDate(terms.claimDeadline);terms.exclusionDeadline=parseOfficialDate(terms.exclusionDeadline);terms.objectionDeadline=parseOfficialDate(terms.objectionDeadline)
  const verified=resolved.state==='OFFICIAL_SOURCE_VERIFIED',deadlineState=classifyDeadline(terms.claimDeadline,now),questions=deriveEligibilityQuestions(terms.classDefinition)
  return {id:stableSettlementId(terms.settlementName??listing.title,terms.defendant??listing.defendant,terms.caseNumber),name:terms.settlementName??listing.title,defendant:terms.defendant??listing.defendant,aggregatorUrl:listing.listingUrl,officialUrl:resolved.url,officialSourceState:resolved.state,terms,deadlineState,priority:rankPriority(deadlineState,verified),eligibilityState:'UNKNOWN_FACTS_REQUIRED',eligibilityQuestions:questions,workflowState:verified?'ELIGIBILITY_REVIEW':'DISCOVERED',provenance:resolved.provenance,discoveredAt:listing.retrievedAt,updatedAt:now.toISOString(),claimSubmitted:false,cashReceived:false}
}
export async function runSettlementIntelligence(options:{fetcher?:SafeFetch;now?:Date;listings?:DiscoveryListing[]}={}){
  const fetcher=options.fetcher??liveSafeFetch,now=options.now??new Date(),discovered=options.listings??await discoverClassActionListings(fetcher,now),records:SettlementRecord[]=[];const notifications=[]
  for(const listing of discovered){const record=await normalizeListing(listing,fetcher,now);settlementStore.upsert(record);records.push(record);const notice=generateNotification(record,now);if(notice){settlementStore.saveNotification(notice);notifications.push(notice)}}
  return {discovered:records.length,officiallyVerified:records.filter(item=>item.officialSourceState==='OFFICIAL_SOURCE_VERIFIED').length,verifiedNoProof:records.filter(item=>item.officialSourceState==='OFFICIAL_SOURCE_VERIFIED'&&['NO_DOCUMENTATION_REQUIRED','PROOF_OF_PURCHASE_NOT_REQUIRED'].includes(item.terms.documentationRequirement)).length,records,notifications,persistence:'SESSION_ONLY' as const,applicationsOrSubmissionsPerformed:false,externalDeliveryOccurred:false}
}
export function prepareSettlementClaim(record:SettlementRecord,knownFacts:Record<string,boolean>){
  const questions=deriveEligibilityQuestions(record.terms.classDefinition,knownFacts);const eligibilityState=questions.length?'UNKNOWN_FACTS_REQUIRED' as const:'POSSIBLY_ELIGIBLE_COMMANDER_REVIEW' as const;return {...record,eligibilityQuestions:questions,eligibilityState,workflowState:'CLAIM_PREPARED' as const,claimSubmitted:false as const,cashReceived:false as const}
}
