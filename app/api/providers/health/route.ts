import { NextResponse } from 'next/server'
import { getProviderRuntimeHealth } from '@/lib/providers/health'
import { buildCanonicalProviderFamilies } from '@/lib/runtime/canonicalStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProviderFamilyKey = 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'redteam'

/** Presence/config classification — does not assert live API connectivity. */
export type ProviderAvailability = 'configured' | 'not_configured' | 'probe_required' | 'live_connected' | 'degraded' | 'rate_limited' | 'invalid_key'

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

function availabilityFromCanonical(value: string | undefined): ProviderAvailability {
  if (value === 'CONNECTED') return 'live_connected'
  if (value === 'NOT_CONFIGURED') return 'not_configured'
  if (value === 'INVALID_KEY') return 'invalid_key'
  if (value === 'RATE_LIMITED') return 'rate_limited'
  if (value === 'DEGRADED') return 'degraded'
  if (value === 'CONFIGURED') return 'configured'
  return 'probe_required'
}

export async function GET() {
  const runtime = await getProviderRuntimeHealth()
  const canonicalProviders = buildCanonicalProviderFamilies(runtime)
  const byFamily = Object.fromEntries(canonicalProviders.map(provider => [provider.family, provider]))
  const availability: Record<ProviderFamilyKey, ProviderAvailability> = {
    claude: availabilityFromCanonical(byFamily.claude?.availability),
    chatgpt: availabilityFromCanonical(byFamily.chatgpt?.availability),
    grok: availabilityFromCanonical(byFamily.grok?.availability),
    gemini: availabilityFromCanonical(byFamily.gemini?.availability),
    redteam: availabilityFromCanonical(byFamily.redteam?.availability),
  }

  const providers = {
    claude: byFamily.claude?.connectionStatus ?? legacyConnectionStatus(availability.claude),
    chatgpt: byFamily.chatgpt?.connectionStatus ?? legacyConnectionStatus(availability.chatgpt),
    grok: byFamily.grok?.connectionStatus ?? legacyConnectionStatus(availability.grok),
    gemini: byFamily.gemini?.connectionStatus ?? legacyConnectionStatus(availability.gemini),
    redteam: byFamily.redteam?.connectionStatus ?? 'standby' as const,
  }

  const labels = {
    claude: byFamily.claude?.label ?? 'Anthropic · Claude · unknown',
    chatgpt: byFamily.chatgpt?.label ?? 'OpenAI · ChatGPT · unknown',
    grok: byFamily.grok?.label ?? 'xAI · Grok · unknown',
    gemini: byFamily.gemini?.label ?? 'Google · Gemini · unknown',
    redteam: byFamily.redteam?.label ?? 'War Room · Red Team · unknown',
  }

  return NextResponse.json({
    tool: 'provider-health',
    status: 'complete',
    availability,
    providers,
    labels,
    canonicalProviders,
    runtimeProviders: runtime.providers,
    signalAvailability: runtime.signalAvailability,
    guidance:
      '`availability` now reflects live bounded server-side probes for OpenAI, Anthropic, xAI/Grok, Google/Gemini, Tavily, and Firecrawl where configured. API keys are never serialized.',
    deprecatedSemantics: {
      providersOnlineFromKeysOnly:
        'Removed: keys alone no longer imply `providers.* === "online"`; only CONNECTED live checks map to online.',
    },
  })
}
