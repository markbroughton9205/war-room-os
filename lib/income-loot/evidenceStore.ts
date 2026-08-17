import type { EvidenceAttachment } from './types'
export const INCOME_LOOT_EVIDENCE_PERSISTENCE = 'session_only' as const
export const INCOME_LOOT_EVIDENCE_STORE_CAP = 500
const evidence: EvidenceAttachment[] = []; let sequence=1
export type NewEvidenceAttachment = Omit<EvidenceAttachment,'id'|'truthState'|'visibility'> & { truthState?: EvidenceAttachment['truthState']; visibility?: EvidenceAttachment['visibility'] }
export function insertIncomeLootEvidence(input:NewEvidenceAttachment):EvidenceAttachment { const record:EvidenceAttachment={...input,id:`loot_evidence_session_${sequence++}`,truthState:input.truthState??'CAPTURED',visibility:input.visibility??'commander_only'}; evidence.unshift(record); if(evidence.length>INCOME_LOOT_EVIDENCE_STORE_CAP)evidence.splice(INCOME_LOOT_EVIDENCE_STORE_CAP); return record }
export function getIncomeLootEvidenceForOwner(ownerUserId:string,id:string):EvidenceAttachment|null{return evidence.find(x=>x.ownerUserId===ownerUserId&&x.id===id)??null}
export function listIncomeLootEvidenceForOwner(ownerUserId:string):EvidenceAttachment[]{return evidence.filter(x=>x.ownerUserId===ownerUserId)}
export function listIncomeLootEvidenceForOpportunity(ownerUserId:string,opportunityId:string):EvidenceAttachment[]{return evidence.filter(x=>x.ownerUserId===ownerUserId&&x.linkedRecordType==='opportunity'&&x.linkedOpportunityId===opportunityId)}
export function __resetIncomeLootEvidenceStore():void{evidence.splice(0);sequence=1}
