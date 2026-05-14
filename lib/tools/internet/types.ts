export type InternetToolId = 'tavily' | 'firecrawl' | 'grok_xai' | 'direct_fetch'

export type InternetToolStatus = 'configured' | 'reachable' | 'config_needed' | 'error'

export type InternetToolHealth = {
  id: InternetToolId
  name: string
  status: InternetToolStatus
  lastChecked: string
  notes: string
}

export type InternetStatusResponse = {
  tools: Record<InternetToolId, InternetToolHealth>
  serverSideOnly: true
  canUseInternet: boolean
  lastChecked: string
}
