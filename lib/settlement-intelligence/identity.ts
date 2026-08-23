export const normalizeIdentity=(value:string)=>value.toLowerCase().replace(/\b(class action|settlement|incorporated|corporation|corp|llc)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
const identityTokens=(value:string)=>normalizeIdentity(value).split(' ').filter(word=>word.length>4).map(word=>word.endsWith('s')?word.slice(0,-1):word)
export function stableSettlementId(name:string,defendant:string|null,caseNumber:string|null):string{
  const input=normalizeIdentity(caseNumber||`${defendant??''} ${name}`);let hash=2166136261
  for(const char of input){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return `settlement_${(hash>>>0).toString(16).padStart(8,'0')}`
}
export function identityScore(listing:{title:string;defendant:string|null},official:{settlementName:string|null;defendant:string|null;caseNumber:string|null},officialText:string):number{
  const needles=[...new Set(identityTokens(`${listing.defendant??''} ${listing.title}`))]
  const visibleText=officialText.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')
  const haystack=new Set(identityTokens(`${official.settlementName??''} ${official.defendant??''} ${visibleText.slice(0,100000)}`))
  return needles.length?needles.filter(value=>haystack.has(value)).length/needles.length:0
}
