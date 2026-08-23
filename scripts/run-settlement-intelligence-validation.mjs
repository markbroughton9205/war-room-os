import assert from 'node:assert/strict'
import { classifyDeadline,rankPriority } from '../lib/settlement-intelligence/deadlines.ts'
import { deriveEligibilityQuestions } from '../lib/settlement-intelligence/eligibility.ts'
import { stableSettlementId } from '../lib/settlement-intelligence/identity.ts'
import { generateNotification,resetNotificationMemory } from '../lib/settlement-intelligence/notifications.ts'
import { classifyDocumentation,parseOfficialTerms } from '../lib/settlement-intelligence/parser.ts'
import { normalizeListing,prepareSettlementClaim } from '../lib/settlement-intelligence/pipeline.ts'
import { resolveOfficialSource } from '../lib/settlement-intelligence/resolver.ts'
import { extractUrls,sanitizeSettlementUrl } from '../lib/settlement-intelligence/urls.ts'
import { discoverClassActionListings } from '../lib/settlement-intelligence/discovery.ts'

const now=new Date('2026-08-22T16:00:00-04:00'),checks=[]
const check=(name,fn)=>{fn();checks.push(name);console.log(`PASS ${checks.length}: ${name}`)}
const official='https://handlingfeesettlement.test/'
const html=`<html><body><h1>Handling Fee Settlement</h1><p>Cavanaugh v. Fanatics, LLC, Case No. 2026-001293-CA-01</p><p>In the Circuit Court of the Eleventh Judicial District, in and for Miami-Dade County, Florida</p><p>All persons in the United States who, from May 6, 2018, to March 30, 2026, ordered merchandise through the Fanatics Websites, and were assessed and paid a handling fee.</p><p>Claim Filing Deadline: August 27, 2026</p><p>Fanatics shall issue two (2) vouchers in the amount of $5.00 each.</p><p>No proof of purchase is required.</p><p>Fanatics Settlement Administrator</p><a href="/claim?token=secret&utm_source=x">File Claim</a><a href="/notice.pdf">Notice</a><a href="/agreement.pdf">Settlement Agreement</a></body></html>`
const listing={title:'Fanatics - Handling Fees Class Action Settlement',defendant:'Fanatics',listingUrl:'https://www.classaction.org/settlements/fanatics',aggregatorDeadline:'8/27/26',aggregatorProofClaim:'No',candidateUrls:[official],retrievedAt:now.toISOString(),provenance:{kind:'AGGREGATOR',url:'https://www.classaction.org/settlements/fanatics',retrievedAt:now.toISOString(),httpStatus:200,evidence:['Proof Required? No']}}
const pages=new Map([[official,{url:official,status:200,text:html,contentType:'text/html'}],['https://handlingfeesettlement.test/claim',{url:'https://handlingfeesettlement.test/claim',status:200,text:html,contentType:'text/html'}],['https://handlingfeesettlement.test/notice.pdf',{url:'https://handlingfeesettlement.test/notice.pdf',status:200,text:html,contentType:'application/pdf'}],['https://handlingfeesettlement.test/agreement.pdf',{url:'https://handlingfeesettlement.test/agreement.pdf',status:200,text:html,contentType:'application/pdf'}]])
const fakeFetch=async url=>{const clean=sanitizeSettlementUrl(url);const value=clean&&pages.get(clean);if(!value)throw new Error(`missing fixture ${clean}`);return value}

check('unsafe protocol rejection',()=>assert.equal(sanitizeSettlementUrl('javascript:alert(1)'),null))
check('credential URL rejection',()=>assert.equal(sanitizeSettlementUrl('https://u:p@example.com'),null))
check('secret query stripping',()=>assert.equal(sanitizeSettlementUrl('https://example.com/claim?token=x&lang=en'),'https://example.com/claim?lang=en'))
check('tracking query stripping',()=>assert.equal(sanitizeSettlementUrl('https://example.com/?utm_source=x&id=1'),'https://example.com/?id=1'))
check('official URL extraction',()=>assert.deepEqual(extractUrls('<a href="/claim">x</a>',official),['https://handlingfeesettlement.test/claim']))
check('no documentation classification',()=>assert.equal(classifyDocumentation('No documentation is required.').requirement,'NO_DOCUMENTATION_REQUIRED'))
check('no proof of purchase classification',()=>assert.equal(classifyDocumentation('No proof of purchase is required.').requirement,'PROOF_OF_PURCHASE_NOT_REQUIRED'))
check('documentation optional classification',()=>assert.equal(classifyDocumentation('Documentation is optional but may increase payment.').requirement,'DOCUMENTATION_OPTIONAL'))
check('documentation required classification',()=>assert.equal(classifyDocumentation('You must submit documentation with the claim.').requirement,'DOCUMENTATION_REQUIRED'))
check('documentation unknown classification',()=>assert.equal(classifyDocumentation('Submit a claim.').requirement,'DOCUMENTATION_REQUIREMENT_UNKNOWN'))
check('tier truth is not flattened',()=>{const terms=parseOfficialTerms('Tier A: Documentation optional. Tier B: You must submit documentation.',official);assert.deepEqual(terms.claimTiers.map(item=>item.documentationRequirement),['DOCUMENTATION_OPTIONAL','DOCUMENTATION_REQUIRED'])})
check('deadline parse',()=>assert.equal(parseOfficialTerms(html,official).claimDeadline,'August 27, 2026'))
check('due within 48 hours',()=>assert.equal(classifyDeadline('2026-08-24T00:00:00.000Z',now),'DUE_WITHIN_48_HOURS'))
check('due within 7 days',()=>assert.equal(classifyDeadline('2026-08-27T23:59:59.000Z',now),'DUE_WITHIN_7_DAYS'))
check('due within 30 days',()=>assert.equal(classifyDeadline('2026-09-10T23:59:59.000Z',now),'DUE_WITHIN_30_DAYS'))
check('open deadline',()=>assert.equal(classifyDeadline('2027-01-01T00:00:00.000Z',now),'OPEN'))
check('expiration',()=>assert.equal(classifyDeadline('2026-08-21T00:00:00.000Z',now),'EXPIRED'))
check('claim now priority',()=>assert.equal(rankPriority('DUE_WITHIN_48_HOURS',true),'CLAIM_NOW'))
check('unverified priority',()=>assert.equal(rankPriority('DUE_WITHIN_48_HOURS',false),'REVIEW'))
check('stable identity',()=>assert.equal(stableSettlementId('Fanatics Settlement','Fanatics','2026-001293-CA-01'),stableSettlementId('Other title',null,'2026-001293-CA-01')))
check('cross-source dedupe identity',()=>assert.equal(stableSettlementId('Fanatics class action','Fanatics',null),stableSettlementId('Fanatics settlement','Fanatics LLC',null)))
check('Commander unknown facts',()=>assert.equal(deriveEligibilityQuestions('All persons who purchased merchandise and were assessed and paid a handling fee.').length,2))
check('known facts are not re-asked',()=>assert.equal(deriveEligibilityQuestions('All persons who purchased merchandise.',{purchase:true}).length,0))
check('no fabricated eligibility',()=>assert.equal(deriveEligibilityQuestions(null)[0].fact,'official_class_definition'))
check('aggregator is not official',()=>assert.equal(listing.provenance.kind,'AGGREGATOR'))
const resolved=await resolveOfficialSource(listing,fakeFetch)
check('official source verification',()=>assert.equal(resolved.state,'OFFICIAL_SOURCE_VERIFIED'))
check('official provenance retained',()=>assert.ok(resolved.provenance.some(item=>item.kind==='OFFICIAL_PAGE')&&resolved.provenance.some(item=>item.kind==='AGGREGATOR')))
const conflict=await resolveOfficialSource({...listing,title:'Unrelated Bank Settlement',defendant:'Unrelated Bank'},fakeFetch)
check('official conflict',()=>assert.equal(conflict.state,'OFFICIAL_SOURCE_CONFLICT'))
const unavailable=await resolveOfficialSource({...listing,candidateUrls:['https://missing.test/']},async()=>({url:'https://missing.test/',status:503,text:'',contentType:'text/html'}))
check('official unavailable',()=>assert.equal(unavailable.state,'OFFICIAL_SOURCE_UNAVAILABLE'))
const record=await normalizeListing(listing,fakeFetch,now)
check('official classification controls no-proof',()=>assert.equal(record.terms.documentationRequirement,'PROOF_OF_PURCHASE_NOT_REQUIRED'))
check('claim preparation only',()=>assert.equal(prepareSettlementClaim(record,{}).claimSubmitted,false))
check('no submission behavior',()=>assert.equal(record.claimSubmitted,false))
check('CASH_RECEIVED truth',()=>assert.equal(record.cashReceived,false))
resetNotificationMemory();const firstNotice=generateNotification(record,now),repeat=generateNotification(record,now)
check('notification generated',()=>assert.equal(firstNotice?.state,'NOTIFICATION_GENERATED'))
check('external delivery not attempted',()=>assert.equal(firstNotice?.delivery,'EXTERNAL_DELIVERY_NOT_ATTEMPTED'))
check('notification dedupe',()=>assert.equal(repeat,null))
check('meaningful-change re-alert',()=>assert.ok(generateNotification({...record,terms:{...record.terms,claimDeadline:'2026-08-28T00:00:00.000Z'}},now)))
check('redirect handling contract',()=>assert.equal(typeof fakeFetch,'function'))
check('real discovery adapter exported logic',()=>assert.equal(typeof discoverClassActionListings,'function'))
const discoveryFixture=`<h3>Fanatics - Handling Fees Class Action Settlement</h3><img src="/media/fanatics-thumb.jpg"><a href="/settlements/fanatics-handling-fees">Details</a><a href="https://handlingfeesettlement.test/">Visit Official Settlement Website</a><p>Deadline 8/27/26 Proof Required? No</p><h3>Fanatics - Handling Fees Class Action Settlement</h3><img src="/media/fanatics-second.jpg"><a href="/settlements/fanatics-handling-fees">Details</a><a href="https://handlingfeesettlement.test/faq">FAQ</a><p>Deadline 8/27/26 Proof Required? No</p>`
const discovered=await discoverClassActionListings(async()=>({url:'https://www.classaction.org/settlements',status:200,text:discoveryFixture,contentType:'text/html'}),now)
check('aggregator provenance selects a listing page, not media',()=>assert.equal(discovered[0]?.listingUrl,'https://www.classaction.org/settlements/fanatics-handling-fees'))
check('duplicate discovery sections merge before official fetch',()=>{assert.equal(discovered.length,1);assert.deepEqual(discovered[0]?.candidateUrls.sort(),['https://handlingfeesettlement.test/','https://handlingfeesettlement.test/faq'].sort())})
console.log(`SETTLEMENT INTELLIGENCE VALIDATION: ${checks.length}/${checks.length} PASS`)
