import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { prepareSettlementClaim,runSettlementIntelligence,settlementStore } from '@/lib/settlement-intelligence'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function GET(){const commander=await requireCommanderSession('Settlement Intelligence');if(!commander.ok)return commander.response;return NextResponse.json({records:settlementStore.list(),notifications:settlementStore.listNotifications(),persistence:'SESSION_ONLY',moneyTruth:'DISCOVERED_AND_CLAIM_READY_ARE_NOT_CASH_RECEIVED'})}
export async function POST(request:Request){const commander=await requireCommanderSession('Settlement Intelligence');if(!commander.ok)return commander.response;const body=await request.json().catch(()=>({})) as {action?:string;settlementId?:string;knownFacts?:Record<string,boolean>}
  if(body.action==='PREPARE_CLAIM'){const record=settlementStore.list().find(item=>item.id===body.settlementId);if(!record)return NextResponse.json({error:'Settlement not found.'},{status:404});const prepared=prepareSettlementClaim(record,body.knownFacts??{});settlementStore.upsert(prepared);return NextResponse.json({record:prepared,claimSubmitted:false,externalDeliveryOccurred:false})}
  if(body.action&&body.action!=='REFRESH')return NextResponse.json({error:'Unsupported prepare-only action.'},{status:400})
  try{return NextResponse.json(await runSettlementIntelligence())}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Settlement refresh failed.',applicationsOrSubmissionsPerformed:false,externalDeliveryOccurred:false},{status:502})}}
