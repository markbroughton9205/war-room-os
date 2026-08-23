import type { DiscoveryListing,OfficialSourceState,Provenance,SafeFetch } from './types'
import { identityScore } from './identity'
import { parseOfficialTerms } from './parser'
import { extractUrls,isProbableOfficialUrl } from './urls'

export async function resolveOfficialSource(listing:DiscoveryListing,fetcher:SafeFetch){
  const attempts:string[]=[];let conflict=false
  for(const candidate of listing.candidateUrls.slice(0,12)){
    try{
      const page=await fetcher(candidate);attempts.push(page.url);if(page.status<200||page.status>=400)continue
      const terms=parseOfficialTerms(page.text,page.url),score=identityScore(listing,terms,page.text)
      const evidence=[terms.caseNumber&&`Case: ${terms.caseNumber}`,terms.defendant&&`Defendant: ${terms.defendant}`,terms.administrator&&`Administrator: ${terms.administrator}`,terms.claimDeadline&&`Claim deadline: ${terms.claimDeadline}`].filter(Boolean) as string[]
      const hasOfficialArtifacts=Boolean(terms.caseNumber||terms.officialNoticeUrl||terms.settlementAgreementUrl||/settlement administrator|court|case no/i.test(page.text))
      if(score>=0.2&&hasOfficialArtifacts&&terms.claimDeadline){
        const provenance:Provenance[]=[listing.provenance,{kind:'OFFICIAL_PAGE',url:page.url,retrievedAt:new Date().toISOString(),httpStatus:page.status,evidence}]
        const related=extractUrls(page.text,page.url).filter(url=>isProbableOfficialUrl(url,new URL(listing.listingUrl).hostname)).filter(url=>/notice|faq|frequently|agreement|claim/i.test(url))
        for(const url of related.slice(0,5)){try{const artifact=await fetcher(url);if(artifact.status>=200&&artifact.status<400){const parsed=parseOfficialTerms(artifact.text,artifact.url);terms.documentationRequirement=parsed.documentationRequirement!=='DOCUMENTATION_REQUIREMENT_UNKNOWN'?parsed.documentationRequirement:terms.documentationRequirement;terms.documentationEvidence=parsed.documentationEvidence??terms.documentationEvidence;terms.classDefinition=parsed.classDefinition??terms.classDefinition;terms.claimFormUrl=terms.claimFormUrl??parsed.claimFormUrl;provenance.push({kind:/claim/i.test(url)?'OFFICIAL_CLAIM_FORM':/faq|frequently/i.test(url)?'OFFICIAL_FAQ':/agreement/i.test(url)?'SETTLEMENT_AGREEMENT':'OFFICIAL_NOTICE',url:artifact.url,retrievedAt:new Date().toISOString(),httpStatus:artifact.status,evidence:[parsed.documentationEvidence,parsed.classDefinition].filter(Boolean) as string[]})}}catch{/* retain the verified primary source */}}
        return {state:'OFFICIAL_SOURCE_VERIFIED' as OfficialSourceState,url:page.url,terms,provenance,attempts}
      }
      if(score<0.2&&hasOfficialArtifacts)conflict=true
    }catch{attempts.push(candidate)}
  }
  return {state:(conflict?'OFFICIAL_SOURCE_CONFLICT':attempts.length?'OFFICIAL_SOURCE_UNAVAILABLE':'AGGREGATOR_ONLY') as OfficialSourceState,url:null,terms:null,provenance:[listing.provenance],attempts}
}
