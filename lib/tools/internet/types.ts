export type InternetToolId = 'tavily' | 'firecrawl' | 'grok_xai' | 'direct_fetch'

export type InternetToolStatus = 'configured' | 'reachable' | 'config_needed' | 'error'

export type InternetToolHealth = {
  id: InternetToolId
  name: string
  status: InternetToolStatus
  lastChecked: string
  notes: string
}

/** Tavily / Firecrawl env-backed adapters only (see internetResearchSummary). */
export type InternetResearchOverallStatus =
  | 'live'
  | 'configured_only'
  | 'partial'
  | 'needs_api_key'
  | 'unwired'
  | 'unknown'

export type InternetResearchAdapterSummary = {
  keyPresent: boolean
  configured: boolean
  reachable?: boolean
  notes: string
}

export type InternetStatusResponse = {
  tools: Record<InternetToolId, InternetToolHealth>
  serverSideOnly: true
  /**
   * True when at least one of Tavily / Firecrawl responded OK to the cheap server probe
   * (same as overallStatus === 'live').
   */
  canUseInternet: boolean
  lastChecked: string
  overallStatus: InternetResearchOverallStatus
  label: string
  tavily: InternetResearchAdapterSummary
  firecrawl: InternetResearchAdapterSummary
}
