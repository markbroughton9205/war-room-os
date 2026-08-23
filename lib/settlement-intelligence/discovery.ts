import type { DiscoveryListing,SafeFetch } from './types'
import { extractUrls,isProbableOfficialUrl,sanitizeSettlementUrl } from './urls'

const CLASSACTION_SETTLEMENTS='https://www.classaction.org/settlements'
const strip=(value:string)=>value.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const isClassActionHost=(hostname:string)=>hostname==='classaction.org'||hostname.endsWith('.classaction.org')
const isPageUrl=(url:string)=>{
  const parsed=new URL(url)
  return isClassActionHost(parsed.hostname)&&!/^\/media\//i.test(parsed.pathname)&&!/\.(?:avif|gif|jpe?g|png|svg|webp|ico|pdf)$/i.test(parsed.pathname)
}
function selectListingUrl(urls:string[],sourceUrl:string,title:string):string{
  const titleWords=strip(title).toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>3&&!/^(class|action|settlement)$/.test(word))
  const pages=urls.filter(isPageUrl).map(url=>({url,score:(new URL(url).pathname.startsWith('/settlements/')?100:0)+titleWords.filter(word=>new URL(url).pathname.toLowerCase().includes(word)).length}))
  pages.sort((left,right)=>right.score-left.score)
  return pages[0]?.score?pages[0].url:sourceUrl
}
export async function discoverClassActionListings(fetcher:SafeFetch,now=new Date()):Promise<DiscoveryListing[]>{
  const response=await fetcher(CLASSACTION_SETTLEMENTS);if(response.status<200||response.status>=300)throw new Error(`ClassAction.org returned HTTP ${response.status}.`)
  const chunks=response.text.split(/<h[23][^>]*>/i).slice(1),items:DiscoveryListing[]=[]
  for(const chunk of chunks){
    const section=chunk.slice(0,12000),title=strip(section.split(/<\/h[23]>/i)[0]??'');if(!/settlement/i.test(title))continue
    const text=strip(section),deadline=/Deadline\s+([0-9]{1,2}\/[0-9]{1,2}\/\d{2,4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)?.[1]??null
    const proof=/Proof\s*Required\?\s*(Yes|No)/i.exec(text)?.[1]??null,urls=extractUrls(section,response.url)
    const listingUrl=selectListingUrl(urls,response.url,title)
    const candidateUrls=urls.filter(url=>isProbableOfficialUrl(url,new URL(response.url).hostname))
    items.push({title,defendant:title.split(/[-–—]/)[0]?.replace(/class action settlement/i,'').trim()||null,listingUrl,aggregatorDeadline:deadline,aggregatorProofClaim:proof,candidateUrls,retrievedAt:now.toISOString(),provenance:{kind:'AGGREGATOR',url:listingUrl,retrievedAt:now.toISOString(),httpStatus:response.status,evidence:[`Title: ${title}`,deadline?`Aggregator deadline: ${deadline}`:'Aggregator deadline unavailable',proof?`Aggregator proof claim: ${proof}`:'Aggregator proof claim unavailable']}})
  }
  const unique=new Map<string,DiscoveryListing>()
  for(const item of items){
    const key=`${item.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}|${item.aggregatorDeadline??''}`
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
