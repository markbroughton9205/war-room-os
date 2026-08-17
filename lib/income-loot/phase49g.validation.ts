import { readFileSync } from 'node:fs'
import { buildIncomeLootConsoleViewModel } from './consoleViewModel'
import { safeIncomeLootUrl } from './operationalPolicy'
import { computeOperatingFundState } from './operatingFund'
import { __resetIncomeLootOperationsStore,enqueueParticipantQuestion,listParticipantApplicationsForOwner,listParticipantProfileFactsForOwner,listParticipantQuestionsForOwner,prepareParticipantApplication,resolveParticipantQuestionWithCommanderAnswer,updateParticipantApplicationStatus,upsertParticipantSourceConnection } from './operationsStore'
import { __resetIncomeLootRewardLedger,listRewardLedgerEntriesForOwner,recordCashReceivedReward,recordConfirmedReward,recordEstimatedReward,summarizeRewardLedgerForOwner } from './rewardLedger'
import { __resetIncomeLootStore,insertIncomeLootOpportunity } from './store'
import { LOOT_STATUSES,type RewardLedgerProvenance } from './types'

export type Phase49GValidation={id:string;pass:boolean;detail:string}
const NOW='2026-08-17T12:00:00.000Z'
const provenance:RewardLedgerProvenance={sourceAdapterId:'provider',sourceType:'provider_api',providerRecordId:'record',sourceUrl:'https://official.example/record',retrievedAt:NOW,actorId:null,notes:null}
function opportunity(ownerUserId:string,providerOpportunityId:string,externalUrl='https://official.example/apply',expiresAt='2026-08-18T12:00:00.000Z'){
  return insertIncomeLootOpportunity({ownerUserId,provider:'User Interviews',providerOpportunityId,title:'Remote usability interview',description:'Non-invasive product feedback interview',category:'SURVEY',estimatedReward:{amount:25,currency:'USD',basis:'ESTIMATED',notes:'Source-stated fixture'},estimatedTimeMinutes:30,expiresAt,eligibility:[],locationRequirement:null,evidenceRequirement:[],externalUrl,status:'ELIGIBLE',evidenceLabel:'LIVE_SIGNAL_BACKED',confidence:90,provenance:[{sourceAdapterId:'user-interviews',sourceType:'provider_api',sourceUrl:externalUrl,retrievedAt:NOW,searchQuery:null,providerRecordId:providerOpportunityId,freshness:'current',isHistorical:false}]})!
}
export function runPhase49GValidation():Phase49GValidation[]{
  const out:Phase49GValidation[]=[];const add=(id:string,pass:boolean,detail:string)=>out.push({id,pass,detail})
  __resetIncomeLootStore();__resetIncomeLootRewardLedger();__resetIncomeLootOperationsStore()
  const owner='phase49g-owner',other='phase49g-other',live=opportunity(owner,'live'),expired=opportunity(owner,'expired','https://official.example/expired','2020-01-01T00:00:00.000Z')
  let model=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[live,expired],evidence:[],now:Date.parse(NOW)})
  add('phase49g_01_expired_earn_now_veto',model.earnNow.map(item=>item.id).join(',')===live.id,'expired opportunities never enter EARN NOW')
  add('phase49g_02_url_protocol_gate',safeIncomeLootUrl('javascript:alert(1)')===null&&safeIncomeLootUrl('data:text/html,x')===null&&safeIncomeLootUrl('file:///tmp/x')===null&&safeIncomeLootUrl('custom://x')===null,'non-http schemes are rejected')
  add('phase49g_03_url_credential_gate',safeIncomeLootUrl('https://user:pass@example.com/x')===null&&safeIncomeLootUrl('https://example.com/x?token=secret&ok=1')==='https://example.com/x?ok=1','userinfo is rejected and secret-like query fields are stripped')
  recordConfirmedReward({ownerUserId:owner,opportunityId:live.id,amount:40,currency:'USD',provenance,confirmation:{type:'provider_api',confirmedAt:NOW},externalEventId:'confirmed-1'},()=> '2026-08-17T10:00:00.000Z')
  recordConfirmedReward({ownerUserId:owner,opportunityId:live.id,amount:25,currency:'USD',provenance,confirmation:{type:'provider_api',confirmedAt:NOW},externalEventId:'confirmed-2'},()=> '2026-08-17T11:00:00.000Z')
  recordConfirmedReward({ownerUserId:owner,opportunityId:live.id,amount:10,currency:'EUR',provenance,confirmation:{type:'provider_api',confirmedAt:NOW},externalEventId:'confirmed-eur'},()=> '2026-08-17T11:00:00.000Z')
  recordCashReceivedReward({ownerUserId:owner,opportunityId:live.id,amount:5,currency:'USD',provenance,receipt:{receivedAt:NOW,method:'bank'},externalEventId:'cash-1'},()=> '2026-08-17T11:10:00.000Z')
  recordCashReceivedReward({ownerUserId:owner,opportunityId:live.id,amount:7,currency:'USD',provenance,receipt:{receivedAt:NOW,method:'bank'},externalEventId:'cash-2'},()=> '2026-08-17T11:20:00.000Z')
  const ledger=listRewardLedgerEntriesForOwner(owner)
  model=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[live],evidence:[],ledgerEntries:ledger,ledgerSummary:summarizeRewardLedgerForOwner(owner).byCurrency,now:Date.parse(NOW)})
  add('phase49g_04_latest_confirmation_wins',model.moneyOwed.filter(row=>row.currency==='USD').length===1&&model.moneyOwed.find(row=>row.currency==='USD')?.amount===13,'corrected confirmation replaces the superseded amount and multiple receipts subtract once')
  add('phase49g_05_currency_separation',model.moneyOwed.find(row=>row.currency==='EUR')?.amount===10&&model.ledgerSummary.USD.confirmedOutstanding===13,'currencies remain separate and summary is net outstanding')
  recordCashReceivedReward({ownerUserId:owner,opportunityId:live.id,amount:20,currency:'USD',provenance,receipt:{receivedAt:NOW,method:'bank'},externalEventId:'cash-over'},()=> '2026-08-17T11:30:00.000Z')
  model=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[live],evidence:[],ledgerEntries:listRewardLedgerEntriesForOwner(owner),ledgerSummary:summarizeRewardLedgerForOwner(owner).byCurrency,now:Date.parse(NOW)})
  add('phase49g_06_overpayment_clamped',!model.moneyOwed.some(row=>row.currency==='USD')&&model.cashReceived.filter(row=>row.currency==='USD').reduce((sum,row)=>sum+row.amount,0)===32,'overpayment produces zero outstanding without hiding received cash')
  const invasive=opportunity(owner,'invasive','https://official.example/invasive')
  invasive.title='Experimental drug injection trial'
  const historical=opportunity(owner,'historical','https://official.example/historical')
  historical.evidenceLabel='HISTORICAL_PATTERN_BASED'
  historical.provenance[0].isHistorical=true
  const app=prepareParticipantApplication(owner,live.id,'user-interviews',NOW)
  add('phase49g_07_prepare_owner_scope',Boolean(app)&&prepareParticipantApplication(other,live.id,'user-interviews',NOW)===null&&listParticipantApplicationsForOwner(other).length===0,'application preparation requires an owner-scoped opportunity')
  add('phase49g_07b_prepare_server_earn_now_gate',prepareParticipantApplication(owner,expired.id,'user-interviews',NOW)===null&&prepareParticipantApplication(owner,invasive.id,'user-interviews',NOW)===null&&prepareParticipantApplication(owner,historical.id,'user-interviews',NOW)===null,'server-side preparation rejects expired, historical, and safety-excluded opportunities')
  const statusResults=LOOT_STATUSES.map(status=>{const candidate=opportunity(owner,`status-${status.toLowerCase()}`);candidate.status=status;return{status,eligible:buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[candidate],evidence:[],now:Date.parse(NOW)}).earnNow.length===1,prepared:Boolean(prepareParticipantApplication(owner,candidate.id,'user-interviews',NOW))}})
  add('phase49g_07c_lifecycle_status_gate',statusResults.every(result=>result.eligible===['DISCOVERED','ELIGIBLE'].includes(result.status)&&result.prepared===['DISCOVERED','ELIGIBLE'].includes(result.status)),'all lifecycle statuses are exhaustively gated; only DISCOVERED and ELIGIBLE are newly actionable')
  const invalidJump=app?updateParticipantApplicationStatus(owner,app.id,'SUBMITTED',NOW):null
  const screening=app?updateParticipantApplicationStatus(owner,app.id,'SCREENING',NOW):null
  add('phase49g_08_transition_graph',invalidJump===null&&screening?.status==='SCREENING'&&updateParticipantApplicationStatus(other,app!.id,'READY_TO_SUBMIT',NOW)===null,'status changes follow the explicit graph and owner scope')
  upsertParticipantSourceConnection({id:'connection',ownerUserId:owner,sourceId:'user-interviews',accountStatus:'ACCOUNT_ACTIVE',connectionMode:'USER_AUTH_REQUIRED',capabilities:{canDiscoverPublicly:false,canReadPersonalFeed:false,canPrepareScreener:true,canAutofillKnownAnswers:true,canSubmitAutomatically:false,requiresCommanderReview:true,requiresMobileApp:false,requiresLocation:false,requiresAccountAuthentication:true},updatedAt:NOW})
  model=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[live],evidence:[],connections:[{id:'connection',ownerUserId:owner,sourceId:'user-interviews',accountStatus:'ACCOUNT_ACTIVE',connectionMode:'USER_AUTH_REQUIRED',capabilities:{canDiscoverPublicly:false,canReadPersonalFeed:false,canPrepareScreener:true,canAutofillKnownAnswers:true,canSubmitAutomatically:false,requiresCommanderReview:true,requiresMobileApp:false,requiresLocation:false,requiresAccountAuthentication:true},updatedAt:NOW}]})
  const source=model.sources.find(item=>item.id==='user-interviews')
  add('phase49g_09_source_truth_separation',source?.accountStatus==='ACCOUNT_ACTIVE'&&source.status==='DOCUMENTED_NOT_IMPLEMENTED','account state never overrides connector implementation health')
  const queued=enqueueParticipantQuestion({id:'question-1',ownerUserId:owner,applicationId:app!.id,opportunityId:live.id,sourceId:'user-interviews',question:{questionId:'q1',provider:'User Interviews',opportunityId:live.id,prompt:'Do you own an iPhone?',type:'BOOLEAN',choices:[],required:true,sensitivity:'STANDARD'},reason:'NEEDS_COMMANDER_ANSWER',createdAt:NOW})
  const resolved=resolveParticipantQuestionWithCommanderAnswer({ownerUserId:owner,questionId:'question-1',key:'iphone',value:true,category:'device',now:NOW})
  add('phase49g_10_question_resolution_truth',Boolean(queued)&&resolved==='RECORDED'&&listParticipantQuestionsForOwner(owner).length===0&&listParticipantProfileFactsForOwner(owner).length===1,'a real Commander-approved fact resolves a queued question')
  add('phase49g_11_question_owner_isolation',resolveParticipantQuestionWithCommanderAnswer({ownerUserId:other,questionId:'question-1',key:'iphone',value:true,category:'device'})==='QUESTION_NOT_FOUND','questions cannot be resolved across owners')
  const route=readFileSync('app/api/income-loot/operations/route.ts','utf8'),guard=route.indexOf('requireCommanderSession'),bodyRead=route.indexOf('req.json()')
  add('phase49g_12_route_commander_first',guard>=0&&bodyRead>guard&&route.includes('commander.userId')&&!route.includes('ownerUserId:body'),'route authenticates before body parsing and derives ownership from Commander session')
  const clientModel=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[live],evidence:[],applications:listParticipantApplicationsForOwner(owner),questions:[{id:'hygiene',ownerUserId:owner,applicationId:app!.id,opportunityId:live.id,sourceId:'user-interviews',question:{questionId:'hygiene',provider:'User Interviews',opportunityId:live.id,prompt:'Question',type:'BOOLEAN',choices:[],required:true,sensitivity:'STANDARD'},reason:'NEEDS_COMMANDER_ANSWER',createdAt:NOW}]})
  add('phase49g_12b_owner_id_hygiene',!('ownerUserId'in clientModel.applications[0])&&!('ownerUserId'in clientModel.needsCommander[0])&&route.includes('map(omitOwner)')&&route.includes('application:omitOwner(application)'),'client view model and API snapshots omit owner identifiers')
  const ui=readFileSync('components/war-room/income-loot/IncomeLootConsole.tsx','utf8')
  add('phase49g_13_ui_financial_and_button_truth',ui.includes("totals('confirmedOutstanding')")&&!/<button(?![^>]*type=)/.test(ui),'UI shows net outstanding and all buttons declare a type')
  add('phase49g_14_operating_fund_no_revenue',computeOperatingFundState({},0).selfFundingReadiness==='NO_REVENUE','no CASH_RECEIVED produces NO_REVENUE')
  add('phase49g_15_operating_fund_zero_allocation_revenue_received',(()=>{const r=computeOperatingFundState({USD:100},0);return r.selfFundingReadiness==='REVENUE_RECEIVED'&&r.operatingFundAvailableByCurrency.USD===0})(),'CASH_RECEIVED with 0% allocation shows REVENUE_RECEIVED and $0 available')
  add('phase49g_16_operating_fund_allocation_computes_available',(()=>{const r=computeOperatingFundState({USD:100},20);return r.selfFundingReadiness==='OPERATING_FUNDS_AVAILABLE'&&r.operatingFundAvailableByCurrency.USD===20})(),'CASH_RECEIVED with 20% allocation computes the correct operating fund amount')
  const treasuryOwner='phase49g-treasury-owner'
  const treasuryOppEstimated=opportunity(treasuryOwner,'treasury-estimated')
  recordEstimatedReward({ownerUserId:treasuryOwner,opportunityId:treasuryOppEstimated.id,amount:500,currency:'USD',provenance,externalEventId:'treasury-est-1'},()=>NOW)
  const treasuryModelEstimated=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[treasuryOppEstimated],evidence:[],ledgerEntries:listRewardLedgerEntriesForOwner(treasuryOwner),ledgerSummary:summarizeRewardLedgerForOwner(treasuryOwner).byCurrency,now:Date.parse(NOW)})
  add('phase49g_17_operating_fund_estimated_does_not_fund',treasuryModelEstimated.operatingFund.selfFundingReadiness==='NO_REVENUE'&&(treasuryModelEstimated.operatingFund.cashReceivedByCurrency.USD??0)===0,'an ESTIMATED reward alone never funds the Operating Fund')
  const treasuryOppConfirmed=opportunity(treasuryOwner,'treasury-confirmed')
  recordConfirmedReward({ownerUserId:treasuryOwner,opportunityId:treasuryOppConfirmed.id,amount:500,currency:'USD',provenance,confirmation:{type:'provider_api',confirmedAt:NOW},externalEventId:'treasury-conf-1'},()=>NOW)
  const treasurySummaryConfirmed=summarizeRewardLedgerForOwner(treasuryOwner).byCurrency
  const treasuryModelConfirmed=buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:[treasuryOppEstimated,treasuryOppConfirmed],evidence:[],ledgerEntries:listRewardLedgerEntriesForOwner(treasuryOwner),ledgerSummary:treasurySummaryConfirmed,now:Date.parse(NOW)})
  add('phase49g_18_operating_fund_confirmed_unreceived_does_not_fund',treasuryModelConfirmed.operatingFund.selfFundingReadiness==='NO_REVENUE'&&(treasuryModelConfirmed.operatingFund.cashReceivedByCurrency.USD??0)===0&&treasurySummaryConfirmed.USD.confirmedOutstanding===500,'a CONFIRMED-but-unreceived reward never funds the Operating Fund even though it is genuinely owed')
  add('phase49g_19_operating_fund_nan_clamped_zero',computeOperatingFundState({USD:100},Number.NaN).operatingFundAllocationPercent===0,'NaN allocation clamps to 0%')
  add('phase49g_20_operating_fund_negative_infinity_clamped_zero',computeOperatingFundState({USD:100},Number.NEGATIVE_INFINITY).operatingFundAllocationPercent===0,'-Infinity allocation clamps to 0%')
  add('phase49g_21_operating_fund_positive_infinity_clamped_hundred',computeOperatingFundState({USD:100},Number.POSITIVE_INFINITY).operatingFundAllocationPercent===100,'+Infinity allocation clamps to 100%')
  add('phase49g_22_operating_fund_negative_clamped_zero',computeOperatingFundState({USD:100},-1).operatingFundAllocationPercent===0,'negative allocation clamps to 0%')
  add('phase49g_23_operating_fund_over_hundred_clamped_hundred',computeOperatingFundState({USD:100},101).operatingFundAllocationPercent===100&&computeOperatingFundState({USD:100},1000).operatingFundAllocationPercent===100,'allocation above 100 clamps to 100%')
  add('phase49g_24_operating_fund_available_never_exceeds_cash_received',computeOperatingFundState({USD:100},1000).operatingFundAvailableByCurrency.USD===100&&computeOperatingFundState({USD:33.33},100).operatingFundAvailableByCurrency.USD===33.33,'operating fund available never exceeds actual CASH_RECEIVED for that currency')
  add('phase49g_25_operating_fund_currency_separation',(()=>{const r=computeOperatingFundState({USD:100,EUR:50},20);return r.operatingFundAvailableByCurrency.USD===20&&r.operatingFundAvailableByCurrency.EUR===10})(),'USD and EUR operating fund allocations remain separate with no cross-currency conversion')
  return out
}
