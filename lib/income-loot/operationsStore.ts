import { recordCommanderAnswer, type AnswerClassification, type ParticipantApplication, type ParticipantApplicationStatus, type ParticipantProfile, type ParticipantProfileFact, type ParticipantSourceConnection, type ScreenerQuestion } from './participantAutomation'
import { getIncomeLootOpportunityForOwner } from './store'
import { isStoredOpportunityEarnNowEligible } from './operationalPolicy'

export const INCOME_LOOT_OPERATIONS_PERSISTENCE = 'session_only' as const
export const INCOME_LOOT_OPERATIONS_STORE_CAP = 500

export type ParticipantQuestionQueueItem = {
  id: string
  ownerUserId: string
  applicationId: string | null
  opportunityId: string
  sourceId: string
  question: ScreenerQuestion
  reason: Exclude<AnswerClassification, 'KNOWN_FACT'>
  createdAt: string
}

const applications: ParticipantApplication[] = []
const connections: ParticipantSourceConnection[] = []
const questions: ParticipantQuestionQueueItem[] = []
const profileFacts: ParticipantProfileFact[] = []
let nextApplicationId = 1

const APPLICATION_TRANSITIONS:Record<ParticipantApplicationStatus,readonly ParticipantApplicationStatus[]>={
  NOT_STARTED:['SCREENING','EXPIRED'],SCREENING:['READY_TO_SUBMIT','REJECTED','EXPIRED'],READY_TO_SUBMIT:['SUBMITTED','REJECTED','EXPIRED'],SUBMITTED:['PENDING','ACCEPTED','REJECTED','EXPIRED'],PENDING:['ACCEPTED','REJECTED','EXPIRED'],ACCEPTED:['SCHEDULED','COMPLETED','REJECTED'],SCHEDULED:['COMPLETED','REJECTED'],COMPLETED:['PAYMENT_PENDING','PAID'],REJECTED:[],EXPIRED:[],PAYMENT_PENDING:['PAID'],PAID:[],
}

const cloneApplication = (value: ParticipantApplication): ParticipantApplication => ({ ...value })
const cloneConnection = (value: ParticipantSourceConnection): ParticipantSourceConnection => ({ ...value, capabilities: { ...value.capabilities } })
const cloneQuestion = (value: ParticipantQuestionQueueItem): ParticipantQuestionQueueItem => ({ ...value, question: { ...value.question, choices: [...value.question.choices] } })

export function upsertParticipantSourceConnection(value: ParticipantSourceConnection): ParticipantSourceConnection {
  const index = connections.findIndex(item => item.ownerUserId === value.ownerUserId && item.sourceId === value.sourceId)
  const stored = cloneConnection(value)
  if (index >= 0) connections[index] = stored
  else connections.unshift(stored)
  if (connections.length > INCOME_LOOT_OPERATIONS_STORE_CAP) connections.splice(INCOME_LOOT_OPERATIONS_STORE_CAP)
  return cloneConnection(stored)
}

export function listParticipantSourceConnectionsForOwner(ownerUserId: string): ParticipantSourceConnection[] {
  return connections.filter(item => item.ownerUserId === ownerUserId).map(cloneConnection)
}

export function upsertParticipantApplication(value: ParticipantApplication): ParticipantApplication {
  if (!getIncomeLootOpportunityForOwner(value.ownerUserId, value.opportunityId)) throw new Error('OWNER_OPPORTUNITY_REQUIRED')
  const index = applications.findIndex(item => item.ownerUserId === value.ownerUserId && item.id === value.id)
  const stored = cloneApplication(value)
  if (index >= 0) applications[index] = stored
  else applications.unshift(stored)
  if (applications.length > INCOME_LOOT_OPERATIONS_STORE_CAP) applications.splice(INCOME_LOOT_OPERATIONS_STORE_CAP)
  return cloneApplication(stored)
}

export function prepareParticipantApplication(ownerUserId:string,opportunityId:string,sourceId:string,now=new Date().toISOString()):ParticipantApplication|null{
  const opportunity=getIncomeLootOpportunityForOwner(ownerUserId,opportunityId)
  if(!opportunity||!isStoredOpportunityEarnNowEligible(opportunity,Date.parse(now))||!sourceId.trim())return null
  const existing=applications.find(item=>item.ownerUserId===ownerUserId&&item.opportunityId===opportunityId)
  if(existing)return cloneApplication(existing)
  return upsertParticipantApplication({id:`participant_application_session_${nextApplicationId++}`,ownerUserId,opportunityId,sourceId:sourceId.trim(),status:'NOT_STARTED',updatedAt:now})
}

export function updateParticipantApplicationStatus(ownerUserId: string, id: string, status: ParticipantApplicationStatus, now = new Date().toISOString()): ParticipantApplication | null {
  const application = applications.find(item => item.ownerUserId === ownerUserId && item.id === id)
  if (!application || !APPLICATION_TRANSITIONS[application.status].includes(status)) return null
  application.status = status
  application.updatedAt = now
  return cloneApplication(application)
}

export function listParticipantApplicationsForOwner(ownerUserId: string): ParticipantApplication[] {
  return applications.filter(item => item.ownerUserId === ownerUserId).map(cloneApplication)
}

export function enqueueParticipantQuestion(value: ParticipantQuestionQueueItem): ParticipantQuestionQueueItem|null {
  const opportunity=getIncomeLootOpportunityForOwner(value.ownerUserId,value.opportunityId)
  const application=value.applicationId?applications.find(item=>item.ownerUserId===value.ownerUserId&&item.id===value.applicationId):null
  if(!opportunity||value.question.opportunityId!==value.opportunityId||value.question.provider.trim().toLowerCase()!==opportunity.provider.trim().toLowerCase()||(value.applicationId&&!application))return null
  const existing = questions.find(item => item.ownerUserId === value.ownerUserId && item.id === value.id)
  if (existing) return cloneQuestion(existing)
  questions.unshift(cloneQuestion(value))
  if (questions.length > INCOME_LOOT_OPERATIONS_STORE_CAP) questions.splice(INCOME_LOOT_OPERATIONS_STORE_CAP)
  return cloneQuestion(value)
}

export type ResolveParticipantQuestionInput={ownerUserId:string;questionId:string;key:string;value:unknown;category:string;now?:string}
export function resolveParticipantQuestionWithCommanderAnswer(input:ResolveParticipantQuestionInput):'RECORDED'|'QUESTION_NOT_FOUND'|'ANSWER_REJECTED'{
  const index=questions.findIndex(item=>item.ownerUserId===input.ownerUserId&&item.id===input.questionId)
  if(index<0)return'QUESTION_NOT_FOUND'
  const queued=questions[index]
  const profile:ParticipantProfile={ownerUserId:input.ownerUserId,facts:profileFacts.filter(fact=>fact.ownerUserId===input.ownerUserId)}
  const result=recordCommanderAnswer(profile,{ownerUserId:input.ownerUserId,question:queued.question,key:input.key,value:input.value,category:input.category,approvedByCommander:true,now:input.now})
  if(result.code!=='RECORDED'||!result.fact)return'ANSWER_REJECTED'
  profileFacts.push(result.fact)
  questions.splice(index,1)
  return'RECORDED'
}

export function listParticipantProfileFactsForOwner(ownerUserId:string):ParticipantProfileFact[]{return profileFacts.filter(fact=>fact.ownerUserId===ownerUserId).map(fact=>({...fact}))}

export function listParticipantQuestionsForOwner(ownerUserId: string): ParticipantQuestionQueueItem[] {
  return questions.filter(item => item.ownerUserId === ownerUserId).map(cloneQuestion)
}

export function __resetIncomeLootOperationsStore(): void {
  applications.splice(0)
  connections.splice(0)
  questions.splice(0)
  profileFacts.splice(0)
  nextApplicationId = 1
}
