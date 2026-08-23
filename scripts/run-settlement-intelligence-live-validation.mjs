import { liveSafeFetch } from '../lib/settlement-intelligence/fetch.ts'
import { normalizeListing } from '../lib/settlement-intelligence/pipeline.ts'
import { generateNotification,resetNotificationMemory } from '../lib/settlement-intelligence/notifications.ts'
import { discoverClassActionListings } from '../lib/settlement-intelligence/discovery.ts'

const now=new Date(),discovered=await discoverClassActionListings(liveSafeFetch,now)
const targets=['Costco - Marketing Emails (Washington)','Fanatics - Handling Fees'].map(name=>{
  const listing=discovered.find(item=>item.title.includes(name));if(!listing)throw new Error(`Live ClassAction.org listing not found: ${name}`);return listing
})
if(discovered.some(item=>/millions left on the table|what happens to money/i.test(item.title)))throw new Error('Editorial content crossed the live settlement-card boundary.')
const records=[];resetNotificationMemory()
for(const listing of targets){
  const record=await normalizeListing(listing,liveSafeFetch,now),notification=generateNotification(record,now);records.push({record,notification})
  console.log(JSON.stringify({settlement:record.name,aggregatorUrl:listing.listingUrl,officialCandidates:listing.candidateUrls,officialUrl:record.officialUrl,officialState:record.officialSourceState,administrator:record.terms.administrator,classDefinition:record.terms.classDefinition,deadline:record.terms.claimDeadline,documentationRequirement:record.terms.documentationRequirement,documentationEvidence:record.terms.documentationEvidence,claimUrl:record.terms.claimFormUrl,urgency:record.deadlineState,priority:record.priority,questions:record.eligibilityQuestions,notification:notification?.state??null,externalDelivery:notification?.delivery??null,claimSubmitted:record.claimSubmitted},null,2))
}
if(!records.some(item=>item.record.officialSourceState==='OFFICIAL_SOURCE_VERIFIED'))throw new Error('No live official settlement chain verified.')
console.log(`LIVE DISCOVERY: ${discovered.length} CURRENT UNIQUE SETTLEMENT CARDS; 0 EDITORIAL FALSE POSITIVES`)
console.log(`LIVE SETTLEMENT PROOF: ${records.filter(item=>item.record.officialSourceState==='OFFICIAL_SOURCE_VERIFIED').length}/${records.length} OFFICIAL SOURCE VERIFIED`)
