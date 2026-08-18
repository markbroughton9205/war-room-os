import type { PayPalIncomingTransaction } from './paypalIncome'
import { recordCashReceivedReward,type RewardLedgerRecordResult } from './rewardLedger'
import type { RewardLedgerEntry } from './types'

export const PAYPAL_RECONCILIATION_STATES=['MATCHED','POSSIBLE_MATCH_COMMANDER_REVIEW','UNMATCHED','CONFLICT'] as const
export type PayPalReconciliationState=(typeof PAYPAL_RECONCILIATION_STATES)[number]
export const BANK_DEPOSIT_STATES=['PAYPAL_BALANCE_RECEIVED','BANK_TRANSFER_STATUS_UNKNOWN','BANK_TRANSFER_NOT_CONFIGURED','BANK_TRANSFER_READY','BANK_TRANSFER_IN_PROGRESS','BANK_TRANSFER_COMPLETED','BANK_DEPOSIT_CONFIRMED','TRANSFER_FAILED','COMMANDER_ACTION_REQUIRED','MANUAL_PAYPAL_ACTION_REQUIRED'] as const
export type BankDepositState=(typeof BANK_DEPOSIT_STATES)[number]
export const PAYPAL_AUTO_TRANSFER_STATES=['AUTO_TRANSFER_UNKNOWN','AUTO_TRANSFER_COMMANDER_CONFIRMED','AUTO_TRANSFER_NOT_CONFIGURED'] as const
export type PayPalAutoTransferState=(typeof PAYPAL_AUTO_TRANSFER_STATES)[number]

export type PayPalReconciliation={transactionId:string;state:PayPalReconciliationState;opportunityId:string|null;reason:string}
export type PayPalDepositRecord={ownerUserId:string;transaction:PayPalIncomingTransaction;reconciliation:PayPalReconciliation;depositState:BankDepositState;autoTransferState:PayPalAutoTransferState;updatedAt:string}
const records:PayPalDepositRecord[]=[]

export function reconcilePayPalIncoming(transaction:PayPalIncomingTransaction,entries:RewardLedgerEntry[]):PayPalReconciliation{
  if(transaction.receiptState!=='PAYPAL_RECEIVED')return{transactionId:transaction.transactionId,state:'CONFLICT',opportunityId:null,reason:'Only a received PayPal transaction can reconcile as incoming money.'}
  const candidates=entries.filter(entry=>entry.valueBasis==='CONFIRMED'&&entry.currency===transaction.grossAmount.currency&&entry.amount===transaction.grossAmount.amount)
  const referenced=candidates.filter(entry=>Boolean(transaction.referenceId)&&entry.externalEventId===transaction.referenceId)
  if(referenced.length===1)return{transactionId:transaction.transactionId,state:'MATCHED',opportunityId:referenced[0].opportunityId,reason:'Provider reference, amount, and currency match one confirmed reward.'}
  if(referenced.length>1)return{transactionId:transaction.transactionId,state:'CONFLICT',opportunityId:null,reason:'The provider reference matches multiple reward records.'}
  if(candidates.length===1)return{transactionId:transaction.transactionId,state:'POSSIBLE_MATCH_COMMANDER_REVIEW',opportunityId:candidates[0].opportunityId,reason:'Amount and currency match, but no shared provider reference proves identity.'}
  if(candidates.length>1)return{transactionId:transaction.transactionId,state:'POSSIBLE_MATCH_COMMANDER_REVIEW',opportunityId:null,reason:'Multiple rewards share the PayPal amount and currency.'}
  return{transactionId:transaction.transactionId,state:'UNMATCHED',opportunityId:null,reason:'No confirmed reward matches the available PayPal facts.'}
}

export function trackPayPalReceipt(ownerUserId:string,transaction:PayPalIncomingTransaction,reconciliation:PayPalReconciliation,now=new Date().toISOString()):PayPalDepositRecord{
  const existing=records.find(item=>item.ownerUserId===ownerUserId&&item.transaction.transactionId===transaction.transactionId)
  if(existing){existing.transaction=transaction;existing.reconciliation=reconciliation;existing.updatedAt=now;return structuredClone(existing)}
  const record:PayPalDepositRecord={ownerUserId,transaction,reconciliation,depositState:transaction.receiptState==='PAYPAL_RECEIVED'?'MANUAL_PAYPAL_ACTION_REQUIRED':'BANK_TRANSFER_STATUS_UNKNOWN',autoTransferState:'AUTO_TRANSFER_UNKNOWN',updatedAt:now};records.unshift(record);return structuredClone(record)
}
export function listPayPalDepositsForOwner(ownerUserId:string):PayPalDepositRecord[]{return records.filter(item=>item.ownerUserId===ownerUserId).map(item=>structuredClone(item))}
export function updatePayPalDepositState(ownerUserId:string,transactionId:string,state:BankDepositState):PayPalDepositRecord|null{const record=records.find(item=>item.ownerUserId===ownerUserId&&item.transaction.transactionId===transactionId);if(!record)return null;record.depositState=state;record.updatedAt=new Date().toISOString();return structuredClone(record)}
export function updatePayPalAutoTransferState(ownerUserId:string,transactionId:string,state:PayPalAutoTransferState):PayPalDepositRecord|null{const record=records.find(item=>item.ownerUserId===ownerUserId&&item.transaction.transactionId===transactionId);if(!record)return null;record.autoTransferState=state;record.updatedAt=new Date().toISOString();return structuredClone(record)}
export function confirmBankDeposit(ownerUserId:string,transactionId:string,receivedAt:string):RewardLedgerRecordResult{
  const record=records.find(item=>item.ownerUserId===ownerUserId&&item.transaction.transactionId===transactionId)
  if(!record||record.reconciliation.state!=='MATCHED'||!record.reconciliation.opportunityId)return{entry:null,code:'OPPORTUNITY_NOT_FOUND'}
  const result=recordCashReceivedReward({ownerUserId,opportunityId:record.reconciliation.opportunityId,amount:record.transaction.netAmount.amount??record.transaction.grossAmount.amount!,currency:record.transaction.netAmount.currency??record.transaction.grossAmount.currency!,externalEventId:`paypal-bank-deposit:${transactionId}`,receipt:{receivedAt,method:'PayPal bank deposit'},provenance:{sourceAdapterId:'paypal-transaction-search',sourceType:'provider_api',providerRecordId:transactionId,sourceUrl:null,retrievedAt:record.transaction.retrievedAt,actorId:null,notes:'Bank deposit confirmed after PayPal incoming receipt reconciliation'},notes:'PayPal receipt reconciled and bank deposit confirmed.'})
  if(result.code==='RECORDED'||result.code==='DUPLICATE_EXTERNAL_EVENT')record.depositState='BANK_DEPOSIT_CONFIRMED'
  return result
}
export function __resetPayPalDepositStore(){records.splice(0)}
