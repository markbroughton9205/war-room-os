import type { NotificationRecord,SettlementRecord } from './types'
import { formatTimeRemaining } from './deadlines'
const memory=new Map<string,NotificationRecord>()
export const notificationFingerprint=(record:SettlementRecord)=>[record.id,record.officialSourceState,record.terms.documentationRequirement,record.terms.claimDeadline,record.workflowState].join('|')
export function generateNotification(record:SettlementRecord,now=new Date()):NotificationRecord|null{
  if(record.officialSourceState!=='OFFICIAL_SOURCE_VERIFIED')return null;const fingerprint=notificationFingerprint(record);if(memory.has(fingerprint))return null
  const message=['URGENT SETTLEMENT OPPORTUNITY',`Case: ${record.name}`,`Deadline: ${record.terms.claimDeadline??'Unknown'}`,`Time remaining: ${formatTimeRemaining(record.terms.claimDeadline,now)}`,`Proof requirement: ${record.terms.documentationRequirement}`,'Eligibility: COMMANDER REVIEW REQUIRED',`Potential benefit: ${record.terms.estimatedBenefit??'Not officially stated'}`,`Official claim page: ${record.terms.claimFormUrl??record.officialUrl??'Unavailable'}`,'Official source: VERIFIED','','NO CLAIM HAS BEEN SUBMITTED.'].join('\n')
  const item={id:`notice_${record.id}_${memory.size+1}`,settlementId:record.id,fingerprint,createdAt:now.toISOString(),state:'NOTIFICATION_GENERATED',delivery:'EXTERNAL_DELIVERY_NOT_ATTEMPTED',message} as const;memory.set(fingerprint,item);return item
}
export function resetNotificationMemory(){memory.clear()}
