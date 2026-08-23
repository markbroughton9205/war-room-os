import { liveSafeFetch } from '../lib/settlement-intelligence/fetch.ts'
import { normalizeListing } from '../lib/settlement-intelligence/pipeline.ts'
import { generateNotification,resetNotificationMemory } from '../lib/settlement-intelligence/notifications.ts'
import { discoverClassActionListings } from '../lib/settlement-intelligence/discovery.ts'

const now=new Date(),discovered=await discoverClassActionListings(liveSafeFetch,now)
const aggregatorDeadlineExpired=value=>{
  if(!value)return false
  const numeric=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value)
  const timestamp=numeric?Date.UTC(Number(numeric[3])<100?2000+Number(numeric[3]):Number(numeric[3]),Number(numeric[1])-1,Number(numeric[2]),23,59,59,999):Date.parse(`${value} 23:59:59 GMT`)
  return Number.isFinite(timestamp)&&timestamp<now.getTime()
}
const targets=['Costco - Marketing Emails (Washington)','Fanatics - Handling Fees'].map(name=>{
  const listing=discovered.find(item=>item.title.includes(name));if(!listing)throw new Error(`Live ClassAction.org listing not found: ${name}`);return listing
})
if(discovered.some(item=>/millions left on the table|what happens to money/i.test(item.title)))throw new Error('Editorial content crossed the live settlement-card boundary.')
if(discovered.some(item=>/^(?:visit\s+)?official settlement website$/i.test(item.title)))throw new Error('A generic secondary card link became a settlement title.')
const deadlineCoverage=discovered.filter(item=>item.aggregatorDeadline).length
if(deadlineCoverage===0)throw new Error('No live card deadlines were parsed; expiration proof would be vacuous.')
if(discovered.some(item=>aggregatorDeadlineExpired(item.aggregatorDeadline)))throw new Error('An expired aggregator card crossed the live discovery boundary.')
const records=[];resetNotificationMemory()
for(const listing of targets){
  const record=await normalizeListing(listing,liveSafeFetch,now),notification=generateNotification(record,now);records.push({record,notification})
  console.log(JSON.stringify({settlement:record.name,aggregatorUrl:listing.listingUrl,officialCandidates:listing.candidateUrls,officialUrl:record.officialUrl,officialState:record.officialSourceState,administrator:record.terms.administrator,classDefinition:record.terms.classDefinition,deadline:record.terms.claimDeadline,documentationRequirement:record.terms.documentationRequirement,documentationEvidence:record.terms.documentationEvidence,claimUrl:record.terms.claimFormUrl,urgency:record.deadlineState,priority:record.priority,questions:record.eligibilityQuestions,notification:notification?.state??null,externalDelivery:notification?.delivery??null,claimSubmitted:record.claimSubmitted},null,2))
}
if(!records.some(item=>item.record.officialSourceState==='OFFICIAL_SOURCE_VERIFIED'))throw new Error('No live official settlement chain verified.')
console.log(`LIVE DISCOVERY: ${discovered.length} CURRENT UNIQUE SETTLEMENT CARDS; ${deadlineCoverage} DEADLINES PARSED; 0 EXPIRED, EDITORIAL, OR GENERIC-LINK FALSE POSITIVES`)
console.log(`LIVE SETTLEMENT PROOF: ${records.filter(item=>item.record.officialSourceState==='OFFICIAL_SOURCE_VERIFIED').length}/${records.length} OFFICIAL SOURCE VERIFIED`)
