import { NextResponse } from 'next/server'

import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { getProviderRuntimeHealth } from '@/lib/providers/health'
import { buildCouncilBackendStatusSnapshot } from '@/lib/council/live-orchestration/backends/backendStatusSnapshot'
import { resolveCouncilRoutingMode } from '@/lib/council/live-orchestration/backends/routingMode'
import { LIVE_COUNCIL_ROUTING_WIRED } from '@/lib/council/live-orchestration/backends/uiStatusProjection'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Read-only Council backend status snapshot. Visibility only.
 *
 * Does not invoke Council seats, does not run completions, does not pull models,
 * and does not change app/api/chat/execute.ts routing.
 */

export async function GET() {
  const [probe, providerRuntime] = await Promise.all([
    probeOllama(),
    getProviderRuntimeHealth().catch(() => null),
  ])

  const providerHealthById = new Map(
    (providerRuntime?.providers ?? []).map(provider => [
      provider.id,
      { health: provider.health, latencyMs: provider.latencyMs },
    ]),
  )

  const snapshot = buildCouncilBackendStatusSnapshot({
    ollamaProbe: probe,
    providerHealthById,
    routingMode: resolveCouncilRoutingMode(),
    liveRoutingWired: LIVE_COUNCIL_ROUTING_WIRED,
  })

  return NextResponse.json(snapshot, { headers: { 'cache-control': 'no-store' } })
}
