import type { InternetToolHealth, InternetToolId } from '@/lib/tools/internet/types'
import type { EngineStatus } from '@/lib/engine-control/types'

export type ProviderReadinessHeadline = 'Ready' | 'Needs API key' | 'Error — check key' | 'Not verified'

const INTERNET_ENV: Partial<Record<InternetToolId, string>> = {
  tavily: 'TAVILY_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  grok_xai: 'XAI_API_KEY',
}

const CLOUD_ENV: Partial<Record<string, string>> = {
  chatgpt: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  grok: 'XAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

/** Short operator-facing label for one internet tool row. */
export function internetToolReadinessLabel(tool: InternetToolHealth): string {
  if (tool.id === 'direct_fetch') {
    if (tool.status === 'reachable') return 'Ready'
    if (tool.status === 'error') return 'Error — check network'
    return 'Not verified'
  }
  if (tool.status === 'config_needed') return 'Needs API key'
  if (tool.status === 'reachable') return 'Ready'
  if (tool.status === 'error') return 'Error — check key'
  return 'Not verified'
}

export function internetToolReadinessParts(tool: InternetToolHealth): { headline: string; envHint?: string } {
  const headline = internetToolReadinessLabel(tool)
  const env = INTERNET_ENV[tool.id]
  if (headline === 'Needs API key' && env) return { headline, envHint: env }
  if (headline === 'Error — check key' && env) return { headline, envHint: env }
  return { headline }
}

export function cloudHeadline(e: Pick<EngineStatus, 'id' | 'configured' | 'reachable' | 'functional'>): ProviderReadinessHeadline {
  const env = CLOUD_ENV[e.id]
  if (!e.configured) return env ? 'Needs API key' : 'Not verified'
  if (e.functional) return 'Ready'
  if (e.configured && !e.functional) return 'Error — check key'
  return 'Not verified'
}

/** Map engine truth to header strip dots (no bare “offline”). */
export function cloudEngineStripStatus(
  e: Pick<EngineStatus, 'id' | 'configured' | 'reachable' | 'functional'>,
): 'online' | 'standby' | 'error' | 'not_connected' {
  const h = cloudHeadline(e)
  if (h === 'Ready') return 'online'
  if (h === 'Needs API key') return 'not_connected'
  if (h === 'Error — check key') return 'error'
  return 'standby'
}

/** Label for cloud engine rows / provider strip. */
export function cloudEngineReadinessLabel(e: Pick<EngineStatus, 'id' | 'configured' | 'reachable' | 'functional'>): string {
  const h = cloudHeadline(e)
  if (h === 'Needs API key') {
    const env = CLOUD_ENV[e.id]
    return env ? `Needs API key (${env})` : 'Needs API key'
  }
  if (h === 'Error — check key') return 'Error — check key'
  if (h === 'Ready') return 'Ready'
  return 'Not verified'
}

export function geminiInternetRowReadiness(gemini: {
  apiKeyPresent: boolean
  configured: boolean
  reachable: boolean
}): string {
  if (!gemini.apiKeyPresent && !gemini.configured) return 'Needs API key (GEMINI_API_KEY)'
  if (gemini.configured && gemini.reachable) return 'Ready'
  if (gemini.configured && !gemini.reachable) return 'Error — check key'
  return 'Not verified'
}
