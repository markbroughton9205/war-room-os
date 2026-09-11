import { NextResponse } from 'next/server'

import { collectCanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProviderFamilyKey = 'claude' | 'chatgpt' | 'grok' | 'gemini' | 'redteam'

function legacyConnectionStatus(availability: string): 'online' | 'standby' | 'error' | 'not_connected' {
  if (availability === 'CONNECTED') return 'online'
  if (availability === 'NOT_CONFIGURED') return 'not_connected'
  if (availability === 'INVALID_KEY' || availability === 'RATE_LIMITED' || availability === 'DEGRADED') return 'error'
  return 'standby'
}

export async function GET(req: Request) {
  try {
    const canonical = await collectCanonicalRuntimeStatus(req)
    const providers = Object.fromEntries(
      canonical.providers.map(provider => [provider.family, legacyConnectionStatus(provider.availability)]),
    ) as Record<ProviderFamilyKey, 'online' | 'standby' | 'error' | 'not_connected'>
    const labels = Object.fromEntries(
      canonical.providers.map(provider => [provider.family, provider.label]),
    ) as Record<ProviderFamilyKey, string>
    const availability = Object.fromEntries(
      canonical.providers.map(provider => {
        const value = provider.availability === 'CONNECTED'
          ? 'live_connected'
          : provider.availability === 'NOT_CONFIGURED'
            ? 'not_configured'
            : provider.availability === 'INVALID_KEY'
              ? 'invalid_key'
              : provider.availability === 'RATE_LIMITED'
                ? 'rate_limited'
                : provider.availability === 'DEGRADED'
                  ? 'degraded'
                  : provider.configured
                    ? 'configured'
                    : 'probe_required'
        return [provider.family, value]
      }),
    ) as Record<ProviderFamilyKey, string>

    const providerSubsystem = canonical.subsystems.find(subsystem => subsystem.id === 'provider_runtime')
    const engineSubsystem = canonical.subsystems.find(subsystem => subsystem.id === 'engine_control')

    return NextResponse.json({
      tool: 'provider-status',
      status: 'complete',
      source: '/api/runtime/canonical-status',
      generatedAt: canonical.generatedAt,
      availability,
      providers,
      labels,
      canonicalProviders: canonical.providers,
      engineControl: canonical.engineControl,
      summary: {
        providerRuntimeHealth: providerSubsystem?.health ?? 'unknown',
        engineControlHealth: engineSubsystem?.health ?? 'unknown',
        routingReadiness: canonical.engineControl.routingReadiness,
        connectedFamilies: canonical.providers.filter(provider => provider.connected).length,
      },
      signalAvailability: {
        liveSignalsAvailable: canonical.subsystems.find(subsystem => subsystem.id === 'signal_radar')?.health === 'healthy',
      },
      guidance:
        'Provider status is derived from the canonical runtime snapshot. CONNECTED requires a successful live server-side probe; keys alone never imply online.',
      guardrails: canonical.guardrails,
    }, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-canonical-runtime': canonical.summary.health,
        'x-war-room-provider-runtime': canonical.providers.some(provider => provider.connected) ? 'connected' : 'degraded',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        tool: 'provider-status',
        status: 'unavailable',
        source: '/api/runtime/canonical-status',
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 200) : 'Canonical provider status failed.',
        availability: {},
        providers: {},
        labels: {},
      },
      { status: 503, headers: { 'cache-control': 'no-store', 'x-war-room-provider-runtime': 'unavailable' } },
    )
  }
}
