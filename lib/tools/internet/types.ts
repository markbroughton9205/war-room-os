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
   * (same as overallStatus === 'live'). This is SEARCH provider liveness, not network egress.
   */
  canUseInternet: boolean
  lastChecked: string
  overallStatus: InternetResearchOverallStatus
  label: string
  tavily: InternetResearchAdapterSummary
  firecrawl: InternetResearchAdapterSummary
  /** Direct outbound HTTPS (example.com HEAD). Independent of paid search keys. */
  NETWORK_EGRESS?: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'
  /** Grok/Tavily/Firecrawl credential presence. Independent of egress. */
  SEARCH_PROVIDER_CONFIGURATION?: 'CONFIGURED' | 'CONFIG_NEEDED'
  /** OpenAI/Anthropic/xAI/Gemini Council cloud keys. Independent of Foundry and egress. */
  COUNCIL_PROVIDER_CONFIGURATION?: { configured: number; total: number }
}
