import type { DiscoveryListing,SafeFetch } from './types'
import { extractUrls,isProbableOfficialUrl,sanitizeSettlementUrl } from './urls'

const CLASSACTION_SETTLEMENTS='https://www.classaction.org/settlements'
const strip=(value:string)=>value.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const attr=(attributes:string,name:string)=>new RegExp(`\\b${name}=["']([^"']+)["']`,'i').exec(attributes)?.[1]??null
const decodeHtml=(value:string)=>value.replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
type AggregatorCard={slug:string;name:string;deadline:string|null;proof:string|null}
const parseAggregatorCards=(html:string):Map<string,AggregatorCard>=>{
  const encoded=/\bdata-settlements=["']([^"']+)["']/i.exec(html)?.[1]
  if(!encoded)return new Map()
  try{
    const value:unknown=JSON.parse(decodeHtml(encoded))
    if(!Array.isArray(value))return new Map()
    const cards=new Map<string,AggregatorCard>()
    for(const item of value){
      if(!item||typeof item!=='object')continue
      const record=item as Record<string,unknown>,slug=typeof record.slug==='string'?record.slug.trim():'',name=typeof record.name==='string'?decodeHtml(record.name).trim():''
      if(!slug||!name)continue
      cards.set(slug,{slug,name,deadline:typeof record.deadline==='string'?record.deadline:null,proof:typeof record.proof==='string'?record.proof:null})
    }
    return cards
  }catch{return new Map()}
}
const parseVisibleCards=(html:string):Map<string,AggregatorCard>=>{
  const cardPattern=/<div\b([^>]*\bid=["']([^"']+)["'][^>]*\bclass=["'][^"']*\bsettlement-card\b[^"']*["'][^>]*)>/gi
  const matches=[...html.matchAll(cardPattern)],cards=new Map<string,AggregatorCard>()
  for(let index=0;index<matches.length;index++){
    const match=matches[index],attributes=match[1]??'',slug=match[2]?.trim()??'',name=decodeHtml(attr(attributes,'data-name')??'').trim()
    if(!slug||!name)continue
    const section=strip(html.slice(match.index??0,matches[index+1]?.index??html.length))
    const deadline=/\bDeadline\s+([0-9]{1,2}\/[0-9]{1,2}\/\d{2,4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(section)?.[1]??null
    const proof=/\bProof\s*Required\?\s*(Yes|No|N\/A)/i.exec(section)?.[1]??null
    cards.set(slug,{slug,name,deadline,proof})
  }
  return cards
}
const discoveryDeadlineExpired=(value:string|null,now:Date)=>{
  if(!value)return false
  const numeric=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value)
  const timestamp=numeric?Date.UTC(Number(numeric[3])<100?2000+Number(numeric[3]):Number(numeric[3]),Number(numeric[1])-1,Number(numeric[2]),23,59,59,999):Date.parse(`${value} 23:59:59 GMT`)
  return Number.isFinite(timestamp)&&timestamp<now.getTime()
}
export async function discoverClassActionListings(fetcher:SafeFetch,now=new Date()):Promise<DiscoveryListing[]>{
  const response=await fetcher(CLASSACTION_SETTLEMENTS);if(response.status<200||response.status>=300)throw new Error(`ClassAction.org returned HTTP ${response.status}.`)
  const linkPattern=/<a\b([^>]*\bclass=["'][^"']*\bjs-settlement-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi
  const matches=[...response.text.matchAll(linkPattern)],structuredCards=parseAggregatorCards(response.text),visibleCards=parseVisibleCards(response.text),linksBySlug=new Map<string,{name:string;titles:string[];urls:string[]}>()
  for(const match of matches){
    const attributes=match[1]??'',slug=attr(attributes,'data-slug'),name=attr(attributes,'data-name'),officialUrl=attr(attributes,'href')
    if(!slug||!name||!officialUrl)continue
    const group=linksBySlug.get(slug)??{name:decodeHtml(name),titles:[],urls:[]},title=strip(match[2]??'')
    if(title)group.titles.push(title)
    group.urls.push(officialUrl);linksBySlug.set(slug,group)
  }
  const items:DiscoveryListing[]=[]
  for(const [slug,group] of linksBySlug){
    const structured=structuredCards.get(slug),visible=visibleCards.get(slug),name=structured?.name??visible?.name??group.name,deadline=structured?.deadline??visible?.deadline??null,proof=structured?.proof??visible?.proof??null
    if(discoveryDeadlineExpired(deadline,now))continue
    const descriptiveTitle=group.titles.find(title=>/settlement/i.test(title)&&!/^(?:visit\s+)?official settlement website$/i.test(title))
    const title=descriptiveTitle??`${name}${/settlement/i.test(name)?'':' Class Action Settlement'}`
    if(!/settlement/i.test(title))continue
    const listingUrl=`${response.url.split('#')[0]}#${encodeURIComponent(slug)}`,candidateUrls=group.urls.map(url=>sanitizeSettlementUrl(url,response.url)).filter((url):url is string=>url!==null).filter(url=>isProbableOfficialUrl(url,new URL(response.url).hostname))
    items.push({title,defendant:name.split(/[-–—]/)[0]?.trim()||null,listingUrl,aggregatorDeadline:deadline,aggregatorProofClaim:proof,candidateUrls:[...new Set(candidateUrls)],retrievedAt:now.toISOString(),provenance:{kind:'AGGREGATOR',url:listingUrl,retrievedAt:now.toISOString(),httpStatus:response.status,evidence:[`Listing slug: ${slug}`,`Title: ${title}`,deadline?`Aggregator deadline: ${deadline}`:'Aggregator deadline unavailable',proof?`Aggregator proof claim: ${proof}`:'Aggregator proof claim unavailable']}})
  }
  return items
}
export async function hydrateListingCandidates(listing:DiscoveryListing,fetcher:SafeFetch):Promise<DiscoveryListing>{
  const page=await fetcher(listing.listingUrl);const host=new URL(page.url).hostname
  const candidates=extractUrls(page.text,page.url).filter(url=>isProbableOfficialUrl(url,host)).map(url=>sanitizeSettlementUrl(url)).filter((url):url is string=>Boolean(url))
  return {...listing,candidateUrls:[...new Set([...listing.candidateUrls,...candidates])]}
}
