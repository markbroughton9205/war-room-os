import type { FetchResponse,SafeFetch } from './types'
import { sanitizeSettlementUrl } from './urls'

const MAX_REDIRECTS=5
export const liveSafeFetch:SafeFetch=async(raw)=>{
  const initial=sanitizeSettlementUrl(raw)
  if(!initial)throw new Error('Unsafe settlement URL rejected.')
  let current:string=initial
  for(let hop=0;hop<=MAX_REDIRECTS;hop++){
    const response:Response=await fetch(current,{redirect:'manual',headers:{'user-agent':'WarRoomSettlementIntelligence/1.0 (+read-only discovery)','accept':'text/html,application/xhtml+xml,application/pdf;q=0.8'}})
    if(response.status>=300&&response.status<400){
      const next:string|null=response.headers.get('location');const safe:string|null=next?sanitizeSettlementUrl(next,current):null
      if(!safe)throw new Error('Unsafe or missing redirect target.');current=safe;continue
    }
    const contentType=response.headers.get('content-type')??''
    const text=await response.text()
    return {url:current,status:response.status,text,contentType} satisfies FetchResponse
  }
  throw new Error('Settlement source exceeded redirect limit.')
}
