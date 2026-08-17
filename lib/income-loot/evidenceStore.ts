import type { EvidenceAttachment, EvidenceTruthState } from './types'
export const INCOME_LOOT_EVIDENCE_PERSISTENCE = 'session_only' as const
export const INCOME_LOOT_EVIDENCE_STORE_CAP = 500
const evidence: EvidenceAttachment[] = []; let sequence=1
export type NewEvidenceAttachment = Omit<EvidenceAttachment,'id'|'truthState'|'visibility'> & { visibility?: EvidenceAttachment['visibility'] }
export function insertIncomeLootEvidence(input:NewEvidenceAttachment):EvidenceAttachment { const record:EvidenceAttachment={...input,id:`loot_evidence_session_${sequence++}`,truthState:'CAPTURED',visibility:input.visibility??'commander_only'}; evidence.unshift(record); if(evidence.length>INCOME_LOOT_EVIDENCE_STORE_CAP)evidence.splice(INCOME_LOOT_EVIDENCE_STORE_CAP); return record }
export function getIncomeLootEvidenceForOwner(ownerUserId:string,id:string):EvidenceAttachment|null{return evidence.find(x=>x.ownerUserId===ownerUserId&&x.id===id)??null}
export function listIncomeLootEvidenceForOwner(ownerUserId:string):EvidenceAttachment[]{return evidence.filter(x=>x.ownerUserId===ownerUserId)}
export function listIncomeLootEvidenceForOpportunity(ownerUserId:string,opportunityId:string):EvidenceAttachment[]{return evidence.filter(x=>x.ownerUserId===ownerUserId&&x.linkedRecordType==='opportunity'&&x.linkedOpportunityId===opportunityId)}
export function findIncomeLootEvidenceDuplicateForOwner(ownerUserId:string,contentSha256:string):EvidenceAttachment|null{return evidence.find(x=>x.ownerUserId===ownerUserId&&x.contentSha256===contentSha256)??null}
export function applyIncomeLootEvidenceTruthStateForOwner(ownerUserId:string,id:string,truthState:EvidenceTruthState):EvidenceAttachment|null{const record=getIncomeLootEvidenceForOwner(ownerUserId,id);if(!record)return null;record.truthState=truthState;return record}
export function __resetIncomeLootEvidenceStore():void{evidence.splice(0);sequence=1}
