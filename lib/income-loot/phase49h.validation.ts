import { readFileSync } from 'node:fs'
import { BANK_DEBIT_CAPABILITY,classifyPayPalReceipt,createPayPalIncomeAdapter,normalizeIncomingPayPalTransaction } from './paypalIncome'
import { __resetPayPalDepositStore,confirmBankDeposit,listPayPalDepositsForOwner,reconcilePayPalIncoming,trackPayPalReceipt } from './depositIntelligence'
import { __resetExpenseReports,decideExpenseReport,EXPENSE_APPROVAL_EXECUTES_PAYMENT,generateExpenseReport } from './expenseReports'
import { __resetIncomeLootRewardLedger,listRewardLedgerEntriesForOwner,recordConfirmedReward } from './rewardLedger'
import { __resetIncomeLootStore,insertIncomeLootOpportunity } from './store'

export type Phase49HValidation={id:string;pass:boolean;detail:string}
const NOW='2026-08-17T12:00:00.000Z'
export async function runPhase49HValidation():Promise<Phase49HValidation[]>{
  const out:Phase49HValidation[]=[];const add=(id:string,pass:boolean,detail:string)=>out.push({id,pass,detail})
  __resetIncomeLootStore();__resetIncomeLootRewardLedger();__resetPayPalDepositStore();__resetExpenseReports()
  add('phase49h_01_bank_debit_absent',BANK_DEBIT_CAPABILITY===false,'the PayPal lane declares no bank debit capability')
  add('phase49h_02_receipt_classification',classifyPayPalReceipt('S','T0000')==='PAYPAL_RECEIVED'&&classifyPayPalReceipt('P',null)==='PAYPAL_PENDING'&&classifyPayPalReceipt('D',null)==='PAYPAL_DENIED'&&classifyPayPalReceipt('S','T2107')==='PAYPAL_HELD'&&classifyPayPalReceipt('V',null)==='PAYPAL_REVERSED'&&classifyPayPalReceipt('S','T1106')==='PAYPAL_REVERSED'&&classifyPayPalReceipt('S','T1107')==='PAYPAL_REFUNDED','official D/P/S/V statuses and documented hold, reversal, and refund T-codes remain distinct')
  const normalized=normalizeIncomingPayPalTransaction({transaction_info:{transaction_id:'paypal-1',paypal_reference_id:'reward-ref',transaction_updated_date:NOW,transaction_status:'S',transaction_event_code:'T0000',transaction_amount:{currency_code:'USD',value:'25.00'},fee_amount:{currency_code:'USD',value:'1.00'},balance_affecting_records_only:'Y'},payer_info:{email_address:'payer@example.test'}},NOW)!
  add('phase49h_03_normalization',normalized.provider==='paypal'&&normalized.grossAmount.amount===25&&normalized.netAmount.amount===24&&normalized.provenance.endpoint==='/v1/reporting/transactions','official reporting fields normalize without invented values')
  add('phase49h_04_reject_outgoing',normalizeIncomingPayPalTransaction({transaction_info:{transaction_id:'outgoing',transaction_status:'S',transaction_amount:{currency_code:'USD',value:'-5'}}},NOW)===null,'negative/outgoing transactions never enter incoming-money truth')
  let networkCalls=0;const blocked=createPayPalIncomeAdapter({},async()=>{networkCalls++;throw new Error('unexpected request')},()=>NOW)
  const blockedStatus=await blocked.getConnectionStatus()
  add('phase49h_05_no_fake_connection',blockedStatus.state==='NOT_CONFIGURED'&&!blockedStatus.liveVerified&&networkCalls===0,'missing server credentials truthfully remain not configured without a fake request')
  const owner='phase49h-owner';const opportunity=insertIncomeLootOpportunity({ownerUserId:owner,provider:'User Interviews',providerOpportunityId:'reward-ref',title:'Interview',description:null,category:'SURVEY',estimatedReward:{amount:25,currency:'USD',basis:'ESTIMATED',notes:'fixture'},estimatedTimeMinutes:30,expiresAt:null,eligibility:[],locationRequirement:null,evidenceRequirement:[],externalUrl:'https://example.test',status:'REWARDED',evidenceLabel:'PROVIDER_CONFIRMED',confidence:100,provenance:[]})!
  recordConfirmedReward({ownerUserId:owner,opportunityId:opportunity.id,amount:25,currency:'USD',externalEventId:'reward-ref',confirmation:{type:'provider_api',confirmedAt:NOW},provenance:{sourceAdapterId:'user-interviews',sourceType:'provider_api',providerRecordId:'reward-ref',sourceUrl:null,retrievedAt:NOW,actorId:null,notes:null}})
  const match=reconcilePayPalIncoming(normalized,listRewardLedgerEntriesForOwner(owner));trackPayPalReceipt(owner,normalized,match,NOW)
  add('phase49h_06_reference_reconciliation',match.state==='MATCHED'&&match.opportunityId===opportunity.id,'reference, amount, and currency deterministically match one confirmed reward')
  add('phase49h_07_paypal_not_cash',listRewardLedgerEntriesForOwner(owner).every(entry=>entry.valueBasis!=='CASH_RECEIVED'),'PayPal receipt alone does not become CASH_RECEIVED')
  const receipt=confirmBankDeposit(owner,'paypal-1',NOW);const duplicate=confirmBankDeposit(owner,'paypal-1',NOW)
  add('phase49h_08_bank_confirmation_and_idempotency',receipt.code==='RECORDED'&&duplicate.code==='DUPLICATE_EXTERNAL_EVENT'&&listRewardLedgerEntriesForOwner(owner).filter(entry=>entry.valueBasis==='CASH_RECEIVED').length===1&&listPayPalDepositsForOwner(owner)[0].depositState==='BANK_DEPOSIT_CONFIRMED','bank confirmation records one idempotent CASH_RECEIVED event')
  const ambiguous={...normalized,transactionId:'paypal-2',referenceId:null};const review=reconcilePayPalIncoming(ambiguous,listRewardLedgerEntriesForOwner(owner))
  add('phase49h_09_ambiguous_never_promotes',review.state==='POSSIBLE_MATCH_COMMANDER_REVIEW','amount-only matching requires Commander review')
  const report=generateExpenseReport({ownerUserId:owner,title:'Hosting renewal',vendor:'Vendor',amount:10,currency:'USD',recurrence:'RECURRING',dueDate:null,reason:'Keep service available',subsystem:'Hosting',operatingFundAvailable:5,effectIfUnpaid:'Service pauses',cheaperAlternative:'Free tier',recommendation:'FIND_FREE_OPTION'},NOW)!
  const approved=decideExpenseReport(owner,report.id,'APPROVED',owner,NOW)
  add('phase49h_10_expense_requires_decision',report.state==='COMMANDER_APPROVAL_REQUIRED'&&approved?.state==='APPROVED'&&EXPENSE_APPROVAL_EXECUTES_PAYMENT===false,'a real expense report requires Commander approval and approval never pays')
  add('phase49h_11_owner_scope',decideExpenseReport('other-owner',report.id,'DENIED','other-owner',NOW)===null,'expense decisions remain owner scoped')
  const adapterSource=readFileSync('lib/income-loot/paypalIncome.ts','utf8'),routeSource=readFileSync('app/api/income-loot/paypal/route.ts','utf8')
  add('phase49h_12_server_secret_hygiene',!routeSource.includes('PAYPAL_CLIENT_SECRET')&&!routeSource.includes('access_token')&&!adapterSource.includes('console.'),'secrets and access tokens are not returned or logged')
  add('phase49h_13_no_payment_surface',!/(debitBank|withdraw|payExpense|chargeCard|initiateTransfer)\s*\(/.test(adapterSource+routeSource),'the PayPal adapter exposes no debit, withdrawal, charge, payment, or transfer method')
  return out
}
