import type { DeadlineState,SettlementPriority } from './types'
export function parseOfficialDate(value:string|null):string|null{
  if(!value)return null;const timestamp=Date.parse(value);if(!Number.isFinite(timestamp))return null
  return new Date(timestamp).toISOString()
}
export function classifyDeadline(deadline:string|null,now=new Date()):DeadlineState{
  if(!deadline)return 'OPEN';const remaining=new Date(deadline).getTime()-now.getTime()
  if(remaining<0)return 'EXPIRED';if(remaining<=48*3600_000)return 'DUE_WITHIN_48_HOURS';if(remaining<=7*86400_000)return 'DUE_WITHIN_7_DAYS';if(remaining<=30*86400_000)return 'DUE_WITHIN_30_DAYS';return 'OPEN'
}
export function rankPriority(deadline:DeadlineState,verified:boolean):SettlementPriority{
  if(deadline==='EXPIRED')return 'EXPIRED';if(!verified)return 'REVIEW';if(deadline==='DUE_WITHIN_48_HOURS')return 'CLAIM_NOW';if(deadline==='DUE_WITHIN_7_DAYS')return 'HIGH_PRIORITY';if(deadline==='DUE_WITHIN_30_DAYS')return 'REVIEW';return 'LOW_PRIORITY'
}
export function formatTimeRemaining(deadline:string|null,now=new Date()):string{
  if(!deadline)return 'Official deadline unknown';const ms=new Date(deadline).getTime()-now.getTime();if(ms<=0)return 'Expired'
  const hours=Math.ceil(ms/3600_000);return hours<=72?`${hours} hours`:`${Math.ceil(hours/24)} days`
}
