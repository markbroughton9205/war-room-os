import type { DiscoveryListing,SafeFetch } from './types'
import { extractUrls,isProbableOfficialUrl,sanitizeSettlementUrl } from './urls'

const CLASSACTION_SETTLEMENTS='https://www.classaction.org/settlements'
const strip=(value:string)=>value.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const attr=(attributes:string,name:string)=>new RegExp(`\\b${name}=["']([^"']+)["']`,'i').exec(attributes)?.[1]??null
const discoveryDeadlineExpired=(value:string|null,now:Date)=>{
  if(!value)return false
  const numeric=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value)
  const timestamp=numeric?Date.UTC(Number(numeric[3])<100?2000+Number(numeric[3]):Number(numeric[3]),Number(numeric[1])-1,Number(numeric[2]),23,59,59,999):Date.parse(`${value} 23:59:59 GMT`)
  return Number.isFinite(timestamp)&&timestamp<now.getTime()
}
export async function discoverClassActionListings(fetcher:SafeFetch,now=new Date()):Promise<DiscoveryListing[]>{
  const response=await fetcher(CLASSACTION_SETTLEMENTS);if(response.status<200||response.status>=300)throw new Error(`ClassAction.org returned HTTP ${response.status}.`)
  const linkPattern=/<a\b([^>]*\bclass=["'][^"']*\bjs-settlement-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi
  const matches=[...response.text.matchAll(linkPattern)],items:DiscoveryListing[]=[]
  for(let index=0;index<matches.length;index++){
    const match=matches[index],attributes=match[1]??'',slug=attr(attributes,'data-slug'),name=attr(attributes,'data-name'),officialUrl=attr(attributes,'href')
    if(!slug||!name||!officialUrl)continue
    const title=strip(match[2]??'');if(!/settlement/i.test(title))continue
    const section=response.text.slice(match.index??0,matches[index+1]?.index??response.text.length)
    const text=strip(section),deadline=/Deadline\s+([0-9]{1,2}\/[0-9]{1,2}\/\d{2,4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)?.[1]??null
    const proof=/Proof\s*Required\?\s*(Yes|No|N\/A)/i.exec(text)?.[1]??null
    if(discoveryDeadlineExpired(deadline,now))continue
    const safeOfficial=sanitizeSettlementUrl(officialUrl,response.url),listingUrl=`${response.url.split('#')[0]}#${encodeURIComponent(slug)}`
    const candidateUrls=safeOfficial&&isProbableOfficialUrl(safeOfficial,new URL(response.url).hostname)?[safeOfficial]:[]
    items.push({title,defendant:name.split(/[-–—]/)[0]?.trim()||null,listingUrl,aggregatorDeadline:deadline,aggregatorProofClaim:proof,candidateUrls,retrievedAt:now.toISOString(),provenance:{kind:'AGGREGATOR',url:listingUrl,retrievedAt:now.toISOString(),httpStatus:response.status,evidence:[`Listing slug: ${slug}`,`Title: ${title}`,deadline?`Aggregator deadline: ${deadline}`:'Aggregator deadline unavailable',proof?`Aggregator proof claim: ${proof}`:'Aggregator proof claim unavailable']}})
  }
  const unique=new Map<string,DiscoveryListing>()
  for(const item of items){
    const key=item.listingUrl
    const existing=unique.get(key)
    if(existing){existing.candidateUrls=[...new Set([...existing.candidateUrls,...item.candidateUrls])];continue}
    unique.set(key,item)
  }
  return [...unique.values()]
}
export async function hydrateListingCandidates(listing:DiscoveryListing,fetcher:SafeFetch):Promise<DiscoveryListing>{
  const page=await fetcher(listing.listingUrl);const host=new URL(page.url).hostname
  const candidates=extractUrls(page.text,page.url).filter(url=>isProbableOfficialUrl(url,host)).map(url=>sanitizeSettlementUrl(url)).filter((url):url is string=>Boolean(url))
  return {...listing,candidateUrls:[...new Set([...listing.candidateUrls,...candidates])]}
}
