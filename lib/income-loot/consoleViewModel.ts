import type { EvidenceAttachment,LootOpportunity,LootStatus,RewardLedgerCurrencySummary,RewardLedgerEntry } from './types'
import { LOOT_STATUSES } from './types'
import { rankLootOpportunity,type LootRanking } from './ranking'
import type { ParticipantApplication,ParticipantApplicationStatus,ParticipantSourceConnection } from './participantAutomation'
import { INCOME_LOOT_SOURCE_REGISTRY,type IncomeLootSource,type IncomeLootSourceStatus } from './liveSources'
import type { ParticipantQuestionQueueItem } from './operationsStore'
import { isStoredOpportunityEarnNowEligible,safeIncomeLootUrl } from './operationalPolicy'
import { computeOperatingFundState,OPERATING_FUND_DEFAULT_ALLOCATION_PERCENT,type OperatingFundState } from './operatingFund'
import type { PayPalConnectionStatus } from './paypalIncome'
import type { PayPalDepositRecord } from './depositIntelligence'
import type { ExpenseReport } from './expenseReports'

export type IncomeLootConsoleEvidence=Pick<EvidenceAttachment,'id'|'kind'|'truthState'|'capturedAt'|'originalFilename'|'mimeType'>
export type IncomeLootConsoleOpportunity=Omit<LootOpportunity,'ownerUserId'>&{ranking:LootRanking;evidence:IncomeLootConsoleEvidence[];classification:'LIVE'|'HISTORICAL'|'PROVIDER CONFIRMED'|'SOURCE UNAVAILABLE';estimatedHourlyValue:{amount:number;currency:string}|null;earnNowEligible:boolean}
export type IncomeLootConsoleApplication=Omit<ParticipantApplication,'ownerUserId'>&{opportunity:IncomeLootConsoleOpportunity|null}
export type IncomeLootConsoleQuestion=Omit<ParticipantQuestionQueueItem,'ownerUserId'>
export type IncomeLootConsoleSource=Pick<IncomeLootSource,'id'|'providerName'|'officialUrl'|'accessMode'|'supportsLiveDiscovery'|'implementationState'|'statusReason'>&{status:IncomeLootSourceStatus;accountStatus:ParticipantSourceConnection['accountStatus']|null}
export type IncomeLootMoneyRow={opportunityId:string;title:string;provider:string;currency:string;amount:number;recordedAt:string}
export type IncomeLootConsoleViewModel={dataAvailable:boolean;durableAvailable:false;migrationRequired:boolean;opportunities:IncomeLootConsoleOpportunity[];liveOpportunities:IncomeLootConsoleOpportunity[];earnNow:IncomeLootConsoleOpportunity[];historicalOpportunities:IncomeLootConsoleOpportunity[];inProgress:IncomeLootConsoleOpportunity[];applications:IncomeLootConsoleApplication[];applicationsByStatus:Partial<Record<ParticipantApplicationStatus,IncomeLootConsoleApplication[]>>;needsCommander:IncomeLootConsoleQuestion[];sources:IncomeLootConsoleSource[];moneyOwed:IncomeLootMoneyRow[];cashReceived:IncomeLootMoneyRow[];ledgerSummary:Record<string,RewardLedgerCurrencySummary>;operatingFund:OperatingFundState;paypalConnection:PayPalConnectionStatus;paypalDeposits:Array<Omit<PayPalDepositRecord,'ownerUserId'>>;expenseReports:Array<Omit<ExpenseReport,'ownerUserId'|'decisionActorId'>>;statusCounts:Record<LootStatus,number>;estimatedByCurrency:Array<{currency:string;amount:number}>}

function classification(o:LootOpportunity):IncomeLootConsoleOpportunity['classification']{if(o.evidenceLabel==='HISTORICAL_PATTERN_BASED'||o.provenance.some(p=>p.isHistorical))return'HISTORICAL';if(o.evidenceLabel==='PROVIDER_CONFIRMED')return'PROVIDER CONFIRMED';return o.provenance.length?'LIVE':'SOURCE UNAVAILABLE'}
type Input={dataAvailable:boolean;opportunities:LootOpportunity[];evidence:EvidenceAttachment[];applications?:ParticipantApplication[];connections?:ParticipantSourceConnection[];questions?:ParticipantQuestionQueueItem[];ledgerEntries?:RewardLedgerEntry[];ledgerSummary?:Record<string,RewardLedgerCurrencySummary>;sources?:readonly IncomeLootSource[];operatingFundAllocationPercent?:number;paypalConnection?:PayPalConnectionStatus;paypalDeposits?:PayPalDepositRecord[];expenseReports?:ExpenseReport[];now?:number}
export function buildIncomeLootConsoleViewModel(input:Input):IncomeLootConsoleViewModel{
  const statusCounts=Object.fromEntries(LOOT_STATUSES.map(s=>[s,0])) as Record<LootStatus,number>
  const evidence=new Map<string,IncomeLootConsoleEvidence[]>()
  for(const e of input.evidence){const group=evidence.get(e.linkedOpportunityId)??[];group.push({id:e.id,kind:e.kind,truthState:e.truthState,capturedAt:e.capturedAt,originalFilename:e.originalFilename,mimeType:e.mimeType});evidence.set(e.linkedOpportunityId,group)}
  const opportunities=input.opportunities.map(o=>{
    statusCounts[o.status]++
    const amount=o.estimatedReward?.amount
    const estimatedHourlyValue=amount!=null&&o.estimatedTimeMinutes&&o.estimatedTimeMinutes>0?{amount:Math.round(amount/o.estimatedTimeMinutes*6000)/100,currency:o.estimatedReward!.currency}:null
    const safe=Object.fromEntries(Object.entries(o).filter(([key])=>key!=='ownerUserId')) as Omit<LootOpportunity,'ownerUserId'>
    safe.provenance=safe.provenance.map(p=>({...p,sourceUrl:safeIncomeLootUrl(p.sourceUrl)}))
    const kind=classification(o),actionUrl=safeIncomeLootUrl(o.externalUrl),ranking=rankLootOpportunity(o,input.now)
    return {...safe,externalUrl:actionUrl,ranking,evidence:evidence.get(o.id)??[],classification:kind,estimatedHourlyValue,earnNowEligible:isStoredOpportunityEarnNowEligible(o,input.now)}
  }).sort((a,b)=>b.ranking.score-a.ranking.score||b.confidence-a.confidence||b.discoveredAt.localeCompare(a.discoveredAt))
  const byId=new Map(opportunities.map(o=>[o.id,o]))
  const applications=(input.applications??[]).map(({ownerUserId,...application})=>{void ownerUserId;return{...application,opportunity:byId.get(application.opportunityId)??null}}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
  const applicationsByStatus:IncomeLootConsoleViewModel['applicationsByStatus']={}
  for(const app of applications)(applicationsByStatus[app.status]??=[]).push(app)
  const active=new Set(applications.filter(a=>!['NOT_STARTED','REJECTED','EXPIRED','PAID'].includes(a.status)).map(a=>a.opportunityId))
  const totals=new Map<string,number>()
  for(const o of opportunities)if(o.estimatedReward?.basis==='ESTIMATED'&&o.estimatedReward.amount!==null)totals.set(o.estimatedReward.currency,(totals.get(o.estimatedReward.currency)??0)+o.estimatedReward.amount)
  const connections=new Map((input.connections??[]).map(c=>[c.sourceId,c]))
  const sources=(input.sources??INCOME_LOOT_SOURCE_REGISTRY).map(s=>{const connection=connections.get(s.id)??null;return{id:s.id,providerName:s.providerName,officialUrl:s.officialUrl,accessMode:s.accessMode,supportsLiveDiscovery:s.supportsLiveDiscovery,implementationState:s.implementationState,status:s.status,statusReason:s.statusReason,accountStatus:connection?.accountStatus??null}})
  const entries=input.ledgerEntries??[]
  const rows=(basis:'CONFIRMED'|'CASH_RECEIVED')=>entries.filter(e=>e.valueBasis===basis).map(e=>{const o=byId.get(e.opportunityId);return{opportunityId:e.opportunityId,title:o?.title??'Stored opportunity unavailable',provider:o?.provider??e.providerId??'Unknown provider',currency:e.currency,amount:e.amount,recordedAt:e.recordedAt}})
  const latestConfirmed=new Map<string,RewardLedgerEntry>()
  for(const entry of entries.filter(e=>e.valueBasis==='CONFIRMED')){const key=`${entry.opportunityId}:${entry.currency}`;if(!latestConfirmed.has(key))latestConfirmed.set(key,entry)}
  const moneyOwed=[...latestConfirmed.values()].map(entry=>{const o=byId.get(entry.opportunityId);const received=entries.filter(e=>e.opportunityId===entry.opportunityId&&e.currency===entry.currency&&e.valueBasis==='CASH_RECEIVED').reduce((sum,e)=>sum+e.amount,0);return{opportunityId:entry.opportunityId,title:o?.title??'Stored opportunity unavailable',provider:o?.provider??entry.providerId??'Unknown provider',currency:entry.currency,amount:Math.max(entry.amount-received,0),recordedAt:entry.recordedAt}}).filter(row=>row.amount>0)
  const ledgerSummary=input.ledgerSummary??{}
  const cashReceivedByCurrency=Object.fromEntries(Object.entries(ledgerSummary).map(([currency,value])=>[currency,value.cashReceived]))
  const operatingFund=computeOperatingFundState(cashReceivedByCurrency,input.operatingFundAllocationPercent??OPERATING_FUND_DEFAULT_ALLOCATION_PERCENT)
  const paypalConnection=input.paypalConnection??{state:'NOT_CONFIGURED',liveVerified:false,checkedAt:new Date(input.now??Date.now()).toISOString(),reason:'PayPal has not been configured.'}
  const paypalDeposits=(input.paypalDeposits??[]).map(({ownerUserId,...record})=>{void ownerUserId;return record})
  const expenseReports=(input.expenseReports??[]).map(({ownerUserId,decisionActorId,...report})=>{void ownerUserId;void decisionActorId;return report})
  return{dataAvailable:input.dataAvailable,durableAvailable:false,migrationRequired:true,opportunities,liveOpportunities:opportunities.filter(o=>o.classification==='LIVE'||o.classification==='PROVIDER CONFIRMED'),earnNow:opportunities.filter(o=>o.earnNowEligible),historicalOpportunities:opportunities.filter(o=>o.classification==='HISTORICAL'),inProgress:opportunities.filter(o=>active.has(o.id)||['STARTED','SUBMITTED','PENDING'].includes(o.status)),applications,applicationsByStatus,needsCommander:(input.questions??[]).map(({ownerUserId,...question})=>{void ownerUserId;return question}),sources,moneyOwed,cashReceived:rows('CASH_RECEIVED'),ledgerSummary,operatingFund,paypalConnection,paypalDeposits,expenseReports,statusCounts,estimatedByCurrency:[...totals].map(([currency,amount])=>({currency,amount}))}
}
