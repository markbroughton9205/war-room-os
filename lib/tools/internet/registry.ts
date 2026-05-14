import type { InternetToolId } from './types'

export type InternetToolRegistryEntry = {
  id: InternetToolId
  name: string
  envKey: string | null
  notes: string
}

export const INTERNET_TOOL_REGISTRY: InternetToolRegistryEntry[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    envKey: 'TAVILY_API_KEY',
    notes: 'Primary intelligent opportunity and research search provider.',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    envKey: 'FIRECRAWL_API_KEY',
    notes: 'Page extraction and cleanup provider.',
  },
  {
    id: 'grok_xai',
    name: 'Grok / xAI',
    envKey: 'XAI_API_KEY',
    notes: 'Grok intelligence provider; X/web intelligence requires explicit provider support and prompts.',
  },
  {
    id: 'direct_fetch',
    name: 'Direct Fetch',
    envKey: null,
    notes: 'Server-side outbound fetch capability check.',
  },
]
