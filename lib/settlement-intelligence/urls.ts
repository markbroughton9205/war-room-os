const SECRET_KEYS=/^(token|access_token|api[_-]?key|key|secret|signature|sig|code|auth|authorization|session|password|pin|claimid|claim_id)$/i
const TRACKING_KEYS=/^(utm_.+|fbclid|gclid|msclkid|ref|source)$/i

export function sanitizeSettlementUrl(raw:string,base?:string):string|null{
  try{
    const url=new URL(raw,base)
    if(url.protocol!=='https:'&&url.protocol!=='http:')return null
    if(url.username||url.password)return null
    url.hash=''
    for(const key of [...url.searchParams.keys()])if(SECRET_KEYS.test(key)||TRACKING_KEYS.test(key))url.searchParams.delete(key)
    return url.toString()
  }catch{return null}
}

export function extractUrls(html:string,base:string):string[]{
  const urls=new Set<string>()
  const pattern=/(?:href|src)\s*=\s*["']([^"']+)["']/gi
  for(const match of html.matchAll(pattern)){const safe=sanitizeSettlementUrl(match[1],base);if(safe)urls.add(safe)}
  return [...urls]
}

export function isProbableOfficialUrl(candidate:string,aggregatorHost:string):boolean{
  const url=new URL(candidate)
  if(url.hostname===aggregatorHost||url.hostname.endsWith(`.${aggregatorHost}`))return false
  if(/doubleclick|googlesyndication|google-analytics|facebook|twitter|instagram|youtube|linkedin/i.test(url.hostname))return false
  if(/\/privacy|\/advertis|\/about|\/news|\/blog|\/contact\/?$/i.test(url.pathname))return false
  return /settlement|claim|notice|administrator|verita|angeion|kroll|epiq|analytics/i.test(`${url.hostname}${url.pathname}`)
}
