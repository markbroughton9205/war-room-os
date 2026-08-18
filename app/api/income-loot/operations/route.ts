import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { PARTICIPANT_APPLICATION_STATUSES,SCREENER_QUESTION_TYPES,PARTICIPANT_SENSITIVITIES,type ParticipantApplicationStatus,type ScreenerQuestion } from '@/lib/income-loot/participantAutomation'
import { enqueueParticipantQuestion,listParticipantApplicationsForOwner,listParticipantProfileFactsForOwner,listParticipantQuestionsForOwner,listParticipantSourceConnectionsForOwner,prepareParticipantApplication,resolveParticipantQuestionWithCommanderAnswer,updateParticipantApplicationStatus } from '@/lib/income-loot/operationsStore'
import { decideExpenseReport,EXPENSE_RECOMMENDATIONS,generateExpenseReport,listExpenseReportsForOwner } from '@/lib/income-loot/expenseReports'
import { summarizeRewardLedgerForOwner } from '@/lib/income-loot/rewardLedger'
import { computeOperatingFundState } from '@/lib/income-loot/operatingFund'

export const runtime='nodejs'
export const dynamic='force-dynamic'

function omitOwner<T extends {ownerUserId:string}>(value:T):Omit<T,'ownerUserId'>{const {ownerUserId,...safe}=value;void ownerUserId;return safe}
function snapshot(ownerUserId:string){return{persistence:'session_only',externalActionsExecuted:false,applications:listParticipantApplicationsForOwner(ownerUserId).map(omitOwner),questions:listParticipantQuestionsForOwner(ownerUserId).map(omitOwner),connections:listParticipantSourceConnectionsForOwner(ownerUserId).map(omitOwner),expenseReports:listExpenseReportsForOwner(ownerUserId).map(omitOwner),profileFactCount:listParticipantProfileFactsForOwner(ownerUserId).length}}
function isQuestion(value:unknown):value is ScreenerQuestion{if(!value||typeof value!=='object')return false;const q=value as Partial<ScreenerQuestion>;return typeof q.questionId==='string'&&typeof q.provider==='string'&&typeof q.opportunityId==='string'&&typeof q.prompt==='string'&&typeof q.required==='boolean'&&Array.isArray(q.choices)&&q.choices.every(choice=>typeof choice==='string')&&SCREENER_QUESTION_TYPES.includes(q.type as ScreenerQuestion['type'])&&PARTICIPANT_SENSITIVITIES.includes(q.sensitivity as ScreenerQuestion['sensitivity'])}

export async function GET(){const commander=await requireCommanderSession('Income Loot operations');if(!commander.ok)return commander.response;return NextResponse.json(snapshot(commander.userId))}

export async function POST(req:Request){
  const commander=await requireCommanderSession('Income Loot operations')
  if(!commander.ok)return commander.response
  let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>}catch{return NextResponse.json({error:'Valid JSON body required.'},{status:400})}
  if(body.action==='PREPARE_APPLICATION'){
    if(typeof body.opportunityId!=='string'||typeof body.sourceId!=='string')return NextResponse.json({error:'opportunityId and sourceId are required.'},{status:400})
    const application=prepareParticipantApplication(commander.userId,body.opportunityId,body.sourceId)
    if(!application)return NextResponse.json({error:'Owner-scoped stored opportunity required.'},{status:404})
    return NextResponse.json({status:'prepared',application:omitOwner(application),...snapshot(commander.userId)})
  }
  if(body.action==='QUEUE_QUESTION'){
    if(typeof body.id!=='string'||typeof body.sourceId!=='string'||typeof body.reason!=='string'||!['NEEDS_COMMANDER_ANSWER','SUBJECTIVE','TIME_SENSITIVE','SENSITIVE','CONFLICT_WITH_EXISTING_PROFILE'].includes(body.reason)||!isQuestion(body.question))return NextResponse.json({error:'Valid question payload required.'},{status:400})
    const question=enqueueParticipantQuestion({id:body.id,ownerUserId:commander.userId,applicationId:typeof body.applicationId==='string'?body.applicationId:null,opportunityId:body.question.opportunityId,sourceId:body.sourceId,question:body.question,reason:body.reason as 'NEEDS_COMMANDER_ANSWER'|'SUBJECTIVE'|'TIME_SENSITIVE'|'SENSITIVE'|'CONFLICT_WITH_EXISTING_PROFILE',createdAt:new Date().toISOString()})
    if(!question)return NextResponse.json({error:'Question must match an owner-scoped stored opportunity and application.'},{status:404})
    return NextResponse.json({status:'queued',question:omitOwner(question),...snapshot(commander.userId)})
  }
  if(body.action==='RECORD_COMMANDER_ANSWER'){
    if(typeof body.questionId!=='string'||typeof body.key!=='string'||typeof body.category!=='string'||!('value'in body))return NextResponse.json({error:'questionId, key, category, and value are required.'},{status:400})
    const status=resolveParticipantQuestionWithCommanderAnswer({ownerUserId:commander.userId,questionId:body.questionId,key:body.key,value:body.value,category:body.category})
    return NextResponse.json({status,...snapshot(commander.userId)},{status:status==='RECORDED'?200:status==='QUESTION_NOT_FOUND'?404:409})
  }
  if(body.action==='GENERATE_EXPENSE_REPORT'){
    if(typeof body.title!=='string'||typeof body.vendor!=='string'||typeof body.amount!=='number'||typeof body.currency!=='string'||!['ONE_TIME','RECURRING'].includes(String(body.recurrence))||typeof body.reason!=='string'||typeof body.subsystem!=='string'||typeof body.effectIfUnpaid!=='string'||!EXPENSE_RECOMMENDATIONS.includes(body.recommendation as typeof EXPENSE_RECOMMENDATIONS[number]))return NextResponse.json({error:'A complete, valid expense report is required.'},{status:400})
    const operatingFund=computeOperatingFundState(Object.fromEntries(Object.entries(summarizeRewardLedgerForOwner(commander.userId).byCurrency).map(([currency,value])=>[currency,value.cashReceived])))
    const report=generateExpenseReport({ownerUserId:commander.userId,title:body.title,vendor:body.vendor,amount:body.amount,currency:body.currency.toUpperCase(),recurrence:body.recurrence as 'ONE_TIME'|'RECURRING',dueDate:typeof body.dueDate==='string'?body.dueDate:null,reason:body.reason,subsystem:body.subsystem,operatingFundAvailable:operatingFund.operatingFundAvailableByCurrency[body.currency.toUpperCase()]??0,effectIfUnpaid:body.effectIfUnpaid,cheaperAlternative:typeof body.cheaperAlternative==='string'?body.cheaperAlternative:null,recommendation:body.recommendation as typeof EXPENSE_RECOMMENDATIONS[number]})
    if(!report)return NextResponse.json({error:'Expense report failed validation.'},{status:400})
    return NextResponse.json({status:'COMMANDER_APPROVAL_REQUIRED',report:omitOwner(report),paymentExecuted:false,...snapshot(commander.userId)})
  }
  if(body.action==='DECIDE_EXPENSE_REPORT'){
    if(typeof body.reportId!=='string'||!['APPROVED','DENIED'].includes(String(body.decision)))return NextResponse.json({error:'Valid reportId and decision required.'},{status:400})
    const report=decideExpenseReport(commander.userId,body.reportId,body.decision as 'APPROVED'|'DENIED',commander.userId)
    if(!report)return NextResponse.json({error:'Pending owner-scoped report required.'},{status:409})
    return NextResponse.json({status:report.state,report:omitOwner(report),paymentExecuted:false,...snapshot(commander.userId)})
  }
  return NextResponse.json({error:'Unsupported operation.'},{status:400})
}

export async function PATCH(req:Request){
  const commander=await requireCommanderSession('Income Loot application status')
  if(!commander.ok)return commander.response
  let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>}catch{return NextResponse.json({error:'Valid JSON body required.'},{status:400})}
  if(typeof body.applicationId!=='string'||!PARTICIPANT_APPLICATION_STATUSES.includes(body.status as ParticipantApplicationStatus))return NextResponse.json({error:'Valid applicationId and status required.'},{status:400})
  const application=updateParticipantApplicationStatus(commander.userId,body.applicationId,body.status as ParticipantApplicationStatus)
  if(!application)return NextResponse.json({error:'Application not found or transition not permitted.'},{status:409})
  return NextResponse.json({status:'updated',application:omitOwner(application),...snapshot(commander.userId)})
}
