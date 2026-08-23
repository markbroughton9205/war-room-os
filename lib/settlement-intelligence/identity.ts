export const normalizeIdentity=(value:string)=>value.toLowerCase().replace(/\b(class action|settlement|incorporated|corporation|corp|llc)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()
export function stableSettlementId(name:string,defendant:string|null,caseNumber:string|null):string{
  const input=normalizeIdentity(caseNumber||`${defendant??''} ${name}`);let hash=2166136261
  for(const char of input){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return `settlement_${(hash>>>0).toString(16).padStart(8,'0')}`
}
export function identityScore(listing:{title:string;defendant:string|null},official:{settlementName:string|null;defendant:string|null;caseNumber:string|null},officialText:string):number{
  const needles=[listing.defendant,...normalizeIdentity(listing.title).split(' ').filter(word=>word.length>4)].filter(Boolean) as string[]
  const haystack=normalizeIdentity(`${official.settlementName??''} ${official.defendant??''} ${officialText.slice(0,5000)}`)
  return needles.length?needles.filter(value=>haystack.includes(normalizeIdentity(value))).length/needles.length:0
}
