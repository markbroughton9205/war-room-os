import { classifyResearchSafety,isEarnNowEligible } from './participantAutomation'
import { rankLootOpportunity } from './ranking'
import type { LootOpportunity } from './types'

export function safeIncomeLootUrl(value:string|null):string|null{
  if(!value)return null
  try{
    const url=new URL(value)
    if(url.protocol!=='http:'&&url.protocol!=='https:')return null
    if(url.username||url.password)return null
    for(const key of [...url.searchParams.keys()])if(/key|token|secret|password|credential|auth|session|cookie/i.test(key))url.searchParams.delete(key)
    return url.toString()
  }catch{return null}
}

export function isStoredOpportunityEarnNowEligible(opportunity:LootOpportunity,now=Date.now()):boolean{
  if(opportunity.status!=='DISCOVERED'&&opportunity.status!=='ELIGIBLE')return false
  const historical=opportunity.evidenceLabel==='HISTORICAL_PATTERN_BASED'||opportunity.provenance.some(item=>item.isHistorical)
  const current=opportunity.evidenceLabel==='LIVE_SIGNAL_BACKED'||opportunity.evidenceLabel==='PROVIDER_CONFIRMED'
  const actionUrl=safeIncomeLootUrl(opportunity.externalUrl)
  const safety=classifyResearchSafety([opportunity.title,opportunity.description,...opportunity.eligibility].filter(Boolean).join(' '))
  return current&&!historical&&rankLootOpportunity(opportunity,now).rankable&&isEarnNowEligible({isReal:opportunity.provenance.length>0,historicalOnly:historical,accessPathKnown:Boolean(actionUrl),officialActionUrl:actionUrl,safety,compensationAmount:opportunity.estimatedReward?.amount??null,truth:opportunity.estimatedReward?.amount==null?'LIVE_OPPORTUNITY_COMPENSATION_UNKNOWN':'LIVE_PAID_OPPORTUNITY_VERIFIED'})
}
