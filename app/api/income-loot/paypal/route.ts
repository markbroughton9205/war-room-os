import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { createPayPalIncomeAdapter } from '@/lib/income-loot/paypalIncome'
import { listRewardLedgerEntriesForOwner } from '@/lib/income-loot/rewardLedger'
import { confirmBankDeposit,listPayPalDepositsForOwner,reconcilePayPalIncoming,trackPayPalReceipt,updatePayPalAutoTransferState } from '@/lib/income-loot/depositIntelligence'

export const runtime='nodejs'
export const dynamic='force-dynamic'
const omitOwner=<T extends {ownerUserId:string}>({ownerUserId,...safe}:T)=>{void ownerUserId;return safe}

export async function GET(){const commander=await requireCommanderSession('PayPal income status');if(!commander.ok)return commander.response;const connection=await createPayPalIncomeAdapter().getConnectionStatus();return NextResponse.json({connection,bankDebitCapability:false,externalActionsExecuted:false,deposits:listPayPalDepositsForOwner(commander.userId).map(omitOwner)})}
export async function POST(req:Request){
  const commander=await requireCommanderSession('Refresh PayPal income');if(!commander.ok)return commander.response
  let body:Record<string,unknown>={action:'REFRESH'};try{const parsed=await req.json() as Record<string,unknown>;body=parsed}catch{void 0}
  if(body.action==='CONFIRM_BANK_DEPOSIT'){
    if(typeof body.transactionId!=='string'||typeof body.receivedAt!=='string'||Number.isNaN(Date.parse(body.receivedAt)))return NextResponse.json({error:'Valid transactionId and receivedAt required.'},{status:400})
    const result=confirmBankDeposit(commander.userId,body.transactionId,body.receivedAt)
    if(!['RECORDED','DUPLICATE_EXTERNAL_EVENT'].includes(result.code))return NextResponse.json({error:'A deterministically matched PayPal receipt is required.',code:result.code},{status:409})
    return NextResponse.json({status:'BANK_DEPOSIT_CONFIRMED',cashReceivedRecorded:result.code==='RECORDED',bankDebitCapability:false,externalActionsExecuted:false,deposits:listPayPalDepositsForOwner(commander.userId).map(omitOwner)})
  }
  if(body.action==='CONFIRM_AUTO_TRANSFER_CONFIGURATION'){
    if(typeof body.transactionId!=='string'||typeof body.configured!=='boolean')return NextResponse.json({error:'Valid transactionId and configured flag required.'},{status:400})
    const record=updatePayPalAutoTransferState(commander.userId,body.transactionId,body.configured?'AUTO_TRANSFER_COMMANDER_CONFIRMED':'AUTO_TRANSFER_NOT_CONFIGURED')
    if(!record)return NextResponse.json({error:'Owner-scoped PayPal receipt required.'},{status:404})
    return NextResponse.json({status:record.autoTransferState,externalActionsExecuted:false,record:omitOwner(record)})
  }
  if(body.action!=='REFRESH')return NextResponse.json({error:'Unsupported incoming-money operation.'},{status:400})
  const adapter=createPayPalIncomeAdapter(),connection=await adapter.getConnectionStatus()
  if(!connection.liveVerified)return NextResponse.json({connection,error:'A real authenticated PayPal reporting connection is required.'},{status:409})
  const end=new Date(),start=new Date(end.getTime()-31*24*60*60*1000)
  try{const transactions=await adapter.findIncomingPayments(start.toISOString(),end.toISOString());const ledger=listRewardLedgerEntriesForOwner(commander.userId);for(const transaction of transactions)trackPayPalReceipt(commander.userId,transaction,reconcilePayPalIncoming(transaction,ledger));return NextResponse.json({connection,bankDebitCapability:false,externalActionsExecuted:false,receivedCount:transactions.length,deposits:listPayPalDepositsForOwner(commander.userId).map(omitOwner)})}catch{return NextResponse.json({connection,error:'PayPal reporting refresh failed. No financial truth was advanced.'},{status:502})}
}
