import { NextResponse } from 'next/server'

import { collectCanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProviderFamilyKey = 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'kimi' | 'redteam'

/** Presence/config classification — does not assert live API connectivity without canonical CONNECTED. */
export type ProviderAvailability = 'configured' | 'not_configured' | 'probe_required' | 'live_connected' | 'degraded' | 'rate_limited' | 'invalid_key'

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

export async function GET(req: Request) {
  const canonical = await collectCanonicalRuntimeStatus(req)
  const canonicalProviders = canonical.providers
  const byFamily = Object.fromEntries(canonicalProviders.map(provider => [provider.family, provider]))
  const availability: Record<ProviderFamilyKey, ProviderAvailability> = {
    claude: availabilityFromCanonical(byFamily.claude?.availability),
    chatgpt: availabilityFromCanonical(byFamily.chatgpt?.availability),
    grok: availabilityFromCanonical(byFamily.grok?.availability),
    gemini: availabilityFromCanonical(byFamily.gemini?.availability),
    kimi: availabilityFromCanonical(byFamily.kimi?.availability),
    redteam: availabilityFromCanonical(byFamily.redteam?.availability),
  }

  const providers = {
    claude: byFamily.claude?.connectionStatus ?? legacyConnectionStatus(availability.claude),
    chatgpt: byFamily.chatgpt?.connectionStatus ?? legacyConnectionStatus(availability.chatgpt),
    grok: byFamily.grok?.connectionStatus ?? legacyConnectionStatus(availability.grok),
    gemini: byFamily.gemini?.connectionStatus ?? legacyConnectionStatus(availability.gemini),
    kimi: byFamily.kimi?.connectionStatus ?? legacyConnectionStatus(availability.kimi),
    redteam: byFamily.redteam?.connectionStatus ?? 'standby' as const,
  }

  const labels = {
    claude: byFamily.claude?.label ?? 'Anthropic · Claude · unknown',
    chatgpt: byFamily.chatgpt?.label ?? 'OpenAI · ChatGPT · unknown',
    grok: byFamily.grok?.label ?? 'xAI · Grok · unknown',
    gemini: byFamily.gemini?.label ?? 'Google · Gemini · unknown',
    kimi: byFamily.kimi?.label ?? 'Moonshot · Kimi · unknown',
    redteam: byFamily.redteam?.label ?? 'War Room · Red Team · unknown',
  }

  return NextResponse.json({
    tool: 'provider-health',
    status: 'complete',
    source: '/api/runtime/canonical-status',
    generatedAt: canonical.generatedAt,
    availability,
    providers,
    labels,
    canonicalProviders,
    engineControl: canonical.engineControl,
    signalAvailability: {
      liveSignalsAvailable: canonical.subsystems.find(subsystem => subsystem.id === 'signal_radar')?.health === 'healthy',
    },
    guidance:
      '`availability` reflects the canonical runtime snapshot with live bounded server-side probes. API keys are never serialized.',
    deprecatedSemantics: {
      providersOnlineFromKeysOnly:
        'Removed: keys alone no longer imply `providers.* === "online"`; only CONNECTED live checks map to online.',
    },
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-canonical-runtime': canonical.summary.health,
    },
  })
}
