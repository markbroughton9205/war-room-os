import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { INCOME_LOOT_SOURCE_REGISTRY, clinicalTrialsGovAdapter, discoverLiveIncomeSource } from '@/lib/income-loot/liveSources'

export const runtime='nodejs'
export const dynamic='force-dynamic'

const ADAPTERS_BY_SOURCE_ID: Record<string,typeof clinicalTrialsGovAdapter> = { 'clinicaltrials-gov': clinicalTrialsGovAdapter }

export async function POST(req:Request){
  const commander=await requireCommanderSession('Refresh live source intelligence');if(!commander.ok)return commander.response
  let body:Record<string,unknown>={};try{const parsed=await req.json() as Record<string,unknown>;body=parsed}catch{void 0}
  const sourceId=typeof body.sourceId==='string'?body.sourceId:null
  const adapter=sourceId?ADAPTERS_BY_SOURCE_ID[sourceId]:null
  if(!adapter)return NextResponse.json({error:'Unsupported or unimplemented live source.'},{status:400})
  try{
    const {result,opportunities}=await discoverLiveIncomeSource(commander.userId,adapter)
    const registryEntry=INCOME_LOOT_SOURCE_REGISTRY.find(source=>source.id===sourceId)
    const status = result.status==='LIVE_VERIFIED' ? 'LIVE_VERIFIED' : (registryEntry?.status ?? 'UNVERIFIED')
    const statusReason = result.status==='LIVE_VERIFIED'
      ? `Live-verified via a real ${adapter.source.providerName} request; ${result.recordsReturned} record(s) returned, ${opportunities.length} new opportunity(ies) added.`
      : (result.failure?.safeMessage ?? registryEntry?.statusReason ?? 'Source could not be verified.')
    return NextResponse.json({sourceId,status,statusReason,recordsReturned:result.recordsReturned,opportunitiesAdded:opportunities.length,retrievedAt:result.retrievedAt,failure:result.failure})
  }catch{
    return NextResponse.json({error:'Live source refresh failed. No opportunity or financial state was advanced.'},{status:502})
  }
}
