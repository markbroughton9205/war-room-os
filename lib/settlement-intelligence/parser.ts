import type { DocumentationRequirement,OfficialTerms } from './types'
import { extractUrls } from './urls'

const clean=(value:string)=>value.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()
const first=(text:string,patterns:RegExp[])=>{for(const pattern of patterns){const value=pattern.exec(text)?.[1]?.trim();if(value)return value}return null}
export function classifyDocumentation(text:string):{requirement:DocumentationRequirement;evidence:string|null}{
  const clauses=clean(text).split(/(?<=[.!?])\s+/)
  const find=(pattern:RegExp)=>clauses.find(clause=>pattern.test(clause))??null
  let evidence=find(/documentation (?:is )?optional|without documentation.*(?:may|can).*(?:receive|claim)|documentation.*(?:increase|higher|additional)/i)
  if(evidence)return {requirement:'DOCUMENTATION_OPTIONAL',evidence}
  evidence=find(/no (?:supporting )?documentation (?:is )?required|documentation is not required|without (?:submitting )?(?:supporting )?documentation/i)
  if(evidence)return {requirement:'NO_DOCUMENTATION_REQUIRED',evidence}
  evidence=find(/no proof of purchase (?:is )?required|proof of purchase is not required/i)
  if(evidence)return {requirement:'PROOF_OF_PURCHASE_NOT_REQUIRED',evidence}
  evidence=find(/(?:must|required to) (?:submit|provide|include).{0,80}(?:documentation|receipt|proof of purchase)|documentation (?:must|is required)/i)
  if(evidence)return {requirement:'DOCUMENTATION_REQUIRED',evidence}
  return {requirement:'DOCUMENTATION_REQUIREMENT_UNKNOWN',evidence:null}
}
export function parseOfficialTerms(html:string,url:string):OfficialTerms{
  const text=clean(html),urls=extractUrls(html,url),docs=classifyDocumentation(text)
  const claimTiers=[...text.matchAll(/(?:Tier|Option)\s+([A-Za-z0-9 -]+)\s*[:—-]\s*([^.;]{3,240}[.;])/gi)].map(match=>{const classified=classifyDocumentation(match[2]);return {name:match[1].trim(),benefit:first(match[2],[/(\$[\d,.]+[^.;]*|[^.;]*(?:voucher|payment)[^.;]*)/i]),documentationRequirement:classified.requirement,evidence:classified.evidence}})
  const date=first(text,[/(?:claim(?: form| filing)? deadline|claims deadline|deadline)\s*[:—-]?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i,/claim form.{0,80}?(?:submitted|postmarked).{0,20}?by\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i])
  const pick=(pattern:RegExp)=>urls.find(value=>pattern.test(value))??null
  return {
    settlementName:first(text,[/([A-Z][^.]{3,100}(?:Settlement|v\. [A-Z][^.]{2,80}))/]),defendant:first(text,[/(?:against|Defendant(?: is)?)[ :]\s*([A-Z][A-Za-z0-9 ,.\-&]{2,80})/i]),
    caseNumber:first(text,[/(?:Case|Case No\.)\s*(?:No\.?\s*)?([A-Za-z0-9-]+(?:-CA-\d+)?)/i]),court:first(text,[/(In the [^.]{5,150}(?:Court|Florida|County))/i]),
    administrator:first(text,[/([A-Z][A-Za-z ]+ Settlement Administrator)/i,/(Analytics Consulting LLC|Verita Global|Kroll Settlement Administration|Epiq)/i]),
    classDefinition:first(text,[/(All persons[^.]{20,500}\.)/i,/(?:Settlement Class[^“"]*[“"])([^”"]{20,600})/i,/(If you [^.]{20,500}\.)/i]),claimDeadline:date,
    exclusionDeadline:first(text,[/(?:exclude yourself|exclusion)[^.]*(?:deadline|by)\s*[:—-]?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i]),
    objectionDeadline:first(text,[/(?:object|objection)[^.]*(?:deadline|by)\s*[:—-]?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i]),
    finalApprovalAt:first(text,[/(?:Final Approval Hearing|Attend Hearing)[^A-Z]*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}(?: at [0-9:]+\s*(?:a\.m\.|p\.m\.|AM|PM))?)/i]),
    claimFormUrl:pick(/claim|claimant/i),officialNoticeUrl:pick(/notice/i),faqUrl:pick(/faq|frequently/i),settlementAgreementUrl:pick(/agreement/i),
    settlementFund:first(text,[/(\$[\d,.]+\s*(?:million|billion)?)(?:\s+(?:settlement fund|fund|to fully))/i]),estimatedBenefit:first(text,[/(two \(2\) vouchers[^.]{0,180}|\$\d+(?:\.\d+)?[^.]{0,100}(?:voucher|payment|cash)|payments? will be equally distributed[^.]{0,200})/i]),
    claimTiers,documentationRequirement:docs.requirement,documentationEvidence:docs.evidence,paymentMethod:first(text,[/(?:paid|sent|issued) (?:by|via|to)[^.]{2,100}/i])
  }
}
