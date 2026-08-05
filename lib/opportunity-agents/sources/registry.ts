import type { SourceConnectionDescriptor, SourceConnectionHealth, SourceConnectionState } from './types'

export const SOURCE_CONNECTIONS: SourceConnectionDescriptor[] = [
  { id: 'openai', displayName: 'OpenAI', category: 'ai_provider', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['OPENAI_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'AI provider for council responses; status comes from canonical provider probes.' },
  { id: 'anthropic', displayName: 'Anthropic', category: 'ai_provider', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['ANTHROPIC_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'AI provider for Claude family responses.' },
  { id: 'gemini', displayName: 'Gemini', category: 'ai_provider', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['GEMINI_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'Google Gemini provider; only connected after live probe succeeds.' },
  { id: 'xai', displayName: 'xAI', category: 'ai_provider', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['XAI_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'Grok provider for realtime radar and signal synthesis.' },
  { id: 'kimi', displayName: 'Kimi Open Platform', category: 'ai_provider', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['KIMI_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'Kimi provider is unavailable until credentials and route probes exist.' },
  { id: 'tavily', displayName: 'Tavily', category: 'retrieval', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['TAVILY_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'Current-source discovery and evidence links.' },
  { id: 'firecrawl', displayName: 'Firecrawl', category: 'retrieval', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['FIRECRAWL_API_KEY'], accountRequired: true, commanderApprovalRequired: true, notes: 'Lawful page extraction only; no paywall/CAPTCHA bypass.' },
  { id: 'sam_gov', displayName: 'SAM.gov Opportunities', category: 'opportunity', accessMethod: 'official Opportunities v2 API', costClass: 'free', requiredEnv: ['SAM_GOV_API_KEY'], accountRequired: true, commanderApprovalRequired: false, notes: 'Open federal notices only; expired notices are never active.' },
  { id: 'usaspending', displayName: 'USAspending historical awards', category: 'opportunity', accessMethod: 'official public API', costClass: 'free', requiredEnv: [], accountRequired: false, commanderApprovalRequired: false, notes: 'Historical intelligence only, not current open opportunities.' },
  { id: 'walmart_load_board', displayName: 'Walmart Inbound Load Board', category: 'opportunity', accessMethod: 'official carrier portal credentials', costClass: 'manual', requiredEnv: ['WALMART_LOAD_BOARD_CARRIER_ID'], accountRequired: true, commanderApprovalRequired: true, notes: 'Carrier approval and credentials required; no scraping, bidding, or load acceptance.' },
  { id: 'nws', displayName: 'National Weather Service', category: 'public_intelligence', accessMethod: 'api.weather.gov with identifying User-Agent', costClass: 'free', requiredEnv: ['WAR_ROOM_NWS_USER_AGENT'], accountRequired: false, commanderApprovalRequired: false, notes: 'Weather alerts/forecast risk context only when material to an opportunity.' },
  { id: 'cloudflare_r2', displayName: 'Cloudflare R2', category: 'media', accessMethod: 'S3-compatible storage credentials', costClass: 'metered', requiredEnv: ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_BUCKET'], accountRequired: true, commanderApprovalRequired: true, notes: 'Storage adapter boundary only; no publishing.' },
  { id: 'replicate', displayName: 'Replicate', category: 'media', accessMethod: 'server API token', costClass: 'metered', requiredEnv: ['REPLICATE_API_TOKEN'], accountRequired: true, commanderApprovalRequired: true, notes: 'Media generation adapter boundary only; no automatic generation.' },
  { id: 'elevenlabs', displayName: 'ElevenLabs', category: 'media', accessMethod: 'server API key', costClass: 'metered', requiredEnv: ['ELEVENLABS_API_KEY'], accountRequired: true, commanderApprovalRequired: true, notes: 'Voice generation adapter boundary only; no automatic generation or publishing.' },
]

export function envConfigured(descriptor: SourceConnectionDescriptor, env: NodeJS.ProcessEnv = process.env): boolean {
  return descriptor.requiredEnv.every(key => typeof env[key] === 'string' && env[key]?.trim())
}

export function configuredStateFor(descriptor: SourceConnectionDescriptor, env: NodeJS.ProcessEnv = process.env): SourceConnectionState {
  if (descriptor.id === 'walmart_load_board') return envConfigured(descriptor, env) ? 'CONNECTION_UNVERIFIED' : 'ACCOUNT_REQUIRED'
  if (descriptor.requiredEnv.length === 0) return 'CONNECTION_UNVERIFIED'
  return envConfigured(descriptor, env) ? 'CONNECTION_UNVERIFIED' : 'KEY_MISSING'
}

export function browserSafeConnectionRows(env: NodeJS.ProcessEnv = process.env): SourceConnectionHealth[] {
  const now = new Date().toISOString()
  return SOURCE_CONNECTIONS.map(descriptor => ({
    ...descriptor,
    configuredState: configuredStateFor(descriptor, env),
    connectionState: configuredStateFor(descriptor, env) === 'KEY_MISSING' || configuredStateFor(descriptor, env) === 'ACCOUNT_REQUIRED'
      ? configuredStateFor(descriptor, env)
      : 'CONNECTION_UNVERIFIED',
    lastTest: null,
    lastSuccessfulResponse: null,
    lastRefresh: null,
    currentFailure: null,
    requiredCommanderAction: descriptor.accountRequired && !envConfigured(descriptor, env)
      ? `Configure ${descriptor.requiredEnv.join(', ') || 'account access'} before connection testing.`
      : descriptor.commanderApprovalRequired
        ? 'Commander approval required before operational use.'
        : `Run a server-side connection test after ${now}.`,
  }))
}

export function descriptorById(id: string): SourceConnectionDescriptor | null {
  return SOURCE_CONNECTIONS.find(source => source.id === id) ?? null
}
