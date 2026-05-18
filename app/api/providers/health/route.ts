import { NextResponse } from 'next/server'
import { getProviderRuntimeHealth, type ProviderRuntimeHealth } from '@/lib/providers/health'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProviderFamilyKey = 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'redteam'

/** Presence/config classification — does not assert live API connectivity. */
export type ProviderAvailability = 'configured' | 'not_configured' | 'probe_required' | 'live_connected' | 'degraded' | 'rate_limited' | 'invalid_key'

function trimmedEnv(key: string): boolean {
  return Boolean(process.env[key]?.trim())
}

/**
 * Maps availability to the legacy `providers` map consumed by older UI code.
 * Avoids reporting `online` from credential presence alone.
 */
function legacyConnectionStatus(avail: ProviderAvailability): 'online' | 'standby' | 'error' | 'not_connected' {
  if (avail === 'live_connected') return 'online'
  if (avail === 'not_configured') return 'not_connected'
  if (avail === 'invalid_key') return 'error'
  if (avail === 'rate_limited' || avail === 'degraded') return 'error'
  return 'standby'
}

function availabilityFromRuntime(health: ProviderRuntimeHealth | undefined): ProviderAvailability {
  if (health === 'CONNECTED') return 'live_connected'
  if (health === 'MISSING_KEY') return 'not_configured'
  if (health === 'INVALID_KEY') return 'invalid_key'
  if (health === 'RATE_LIMITED') return 'rate_limited'
  if (health === 'DEGRADED') return 'degraded'
  return 'probe_required'
}

export async function GET() {
  const runtime = await getProviderRuntimeHealth()
  const byId = Object.fromEntries(runtime.providers.map(provider => [provider.id, provider]))
  const availability: Record<ProviderFamilyKey, ProviderAvailability> = {
    claude: availabilityFromRuntime(byId.anthropic?.health),
    chatgpt: availabilityFromRuntime(byId.openai?.health),
    grok: trimmedEnv('XAI_API_KEY') ? 'configured' : 'not_configured',
    gemini: availabilityFromRuntime(byId.google?.health),
    redteam: 'probe_required',
  }

  const providers = {
    claude: legacyConnectionStatus(availability.claude),
    chatgpt: legacyConnectionStatus(availability.chatgpt),
    grok: legacyConnectionStatus(availability.grok),
    gemini: legacyConnectionStatus(availability.gemini),
    redteam: 'standby' as const,
  }

  const labels = {
    claude:
      availability.claude === 'live_connected'
        ? 'Anthropic · Claude · live connected'
        : availability.claude === 'not_configured'
          ? 'Anthropic · Claude · not configured'
          : `Anthropic · Claude · ${availability.claude}`,
    chatgpt:
      availability.chatgpt === 'live_connected'
        ? 'OpenAI · ChatGPT · live connected'
        : availability.chatgpt === 'not_configured'
          ? 'OpenAI · ChatGPT · not configured'
          : `OpenAI · ChatGPT · ${availability.chatgpt}`,
    grok:
      availability.grok === 'not_configured'
        ? 'xAI · Grok · not configured'
        : 'xAI · Grok · key configured (live probe required)',
    gemini:
      availability.gemini === 'live_connected'
        ? 'Google · Gemini · live connected'
        : availability.gemini === 'not_configured'
          ? 'Google · Gemini · not configured'
          : `Google · Gemini · ${availability.gemini}`,
    redteam: 'War Room · Red Team · standby',
  }

  return NextResponse.json({
    tool: 'provider-health',
    status: 'complete',
    availability,
    providers,
    labels,
    runtimeProviders: runtime.providers,
    signalAvailability: runtime.signalAvailability,
    guidance:
      '`availability` now reflects live bounded server-side probes for OpenAI, Anthropic, Google/Gemini, Tavily, and Firecrawl where configured. API keys are never serialized.',
    deprecatedSemantics: {
      providersOnlineFromKeysOnly:
        'Removed: keys alone no longer imply `providers.* === "online"`; only CONNECTED live checks map to online.',
    },
  })
}
