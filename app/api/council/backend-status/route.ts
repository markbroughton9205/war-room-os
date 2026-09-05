import { NextResponse } from 'next/server'

import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { getProviderRuntimeHealth, type ProviderRuntimeStatus } from '@/lib/providers/health'
import {
  EXTERNAL_PROVIDER_BY_SEAT,
  LOCAL_MODEL_REGISTRY,
  SEAT_LOCAL_ROLE_SLOT,
  computeModelDiversity,
  localCandidateHealthFromProbe,
  localRegistryEntryForSlot,
  modelLabelForSeat,
  resolveCouncilRoutingMode,
  type LocalCandidateHealth,
} from '@/lib/council/live-orchestration/backends'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Read-only Council backend status snapshot. Visibility only.
 *
 * External seat status/latency/fallback come from lib/providers/health.ts's
 * getProviderRuntimeHealth() — the SAME canonical, cached provider-health source
 * ProviderRuntimePanel and /api/war-room/diagnostics already read (see that panel's own
 * "Canonical provider status is shared by runtime panels and council summaries" note). This route
 * adds no new cloud probing of its own: getProviderRuntimeHealth() caches with a TTL, so most
 * calls here just read the existing cache rather than triggering fresh provider checks.
 *
 * Local candidate health comes from a real, fresh probeOllama() call every request (cheap,
 * localhost-only, 2s timeout) — never inferred from registry config alone. No completion/generation
 * is ever run by this route, local or cloud — the external side only ever reuses a cached, no-cost
 * models-list probe (see guardrails.cloudProviderProbeNote below), never a real Council response.
 * No API keys, auth headers, or raw provider payloads are read or returned.
 *
 * Live Council chat (app/api/chat/execute.ts) is NOT wired to this backend layer yet — every seat
 * below is reported by what is ACTUALLY live (external), plus an informational, clearly-labeled
 * "local candidate" health check that is never presented as currently serving Council calls.
 */

type SeatActiveStatus = 'READY' | 'DEGRADED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UNKNOWN'

type SeatStatusRow = {
  seat: CouncilOrchestrationFamily
  label: string
  active: {
    backendType: 'EXTERNAL'
    provider: string
    model: string
    status: SeatActiveStatus
    failureClass?: 'AUTH' | 'RATE_LIMIT'
    latencyMs: number | null
    fallbackUsed: boolean
    note: string
  }
  localCandidate: {
    roleSlot: string | null
    repo: string | null
    modelId: string | null
    quantization: string | null
    enabled: boolean
    health: LocalCandidateHealth
  }
}

function activeStatusFromProviderHealth(status: ProviderRuntimeStatus | undefined): {
  status: SeatActiveStatus
  failureClass?: 'AUTH' | 'RATE_LIMIT'
} {
  if (!status) return { status: 'UNKNOWN' }
  if (status.health === 'CONNECTED') return { status: 'READY' }
  if (status.health === 'DEGRADED') return { status: 'DEGRADED' }
  if (status.health === 'RATE_LIMITED') return { status: 'RATE_LIMITED', failureClass: 'RATE_LIMIT' }
  if (status.health === 'MISSING_KEY' || status.health === 'INVALID_KEY') return { status: 'UNAVAILABLE', failureClass: 'AUTH' }
  return { status: 'UNKNOWN' }
}

export async function GET() {
  const probeStarted = Date.now()
  const [probe, providerRuntime] = await Promise.all([probeOllama(), getProviderRuntimeHealth()])
  const probeLatencyMs = Date.now() - probeStarted

  const providerByEid = new Map(providerRuntime.providers.map(p => [p.id, p]))

  const seats: SeatStatusRow[] = COUNCIL_ROSTER.map(rosterEntry => {
    const seat = rosterEntry.id
    const providerId = EXTERNAL_PROVIDER_BY_SEAT[seat] ?? seat
    const providerStatus = providerByEid.get(providerId as ProviderRuntimeStatus['id'])
    const { status, failureClass } = activeStatusFromProviderHealth(providerStatus)

    const slot = SEAT_LOCAL_ROLE_SLOT[seat] ?? null
    const entry = slot ? localRegistryEntryForSlot(slot) : null
    const localHealth = localCandidateHealthFromProbe(entry, probe)

    return {
      seat,
      label: rosterEntry.label,
      active: {
        backendType: 'EXTERNAL',
        provider: providerId,
        model: status === 'READY' || status === 'DEGRADED' || status === 'RATE_LIMITED' ? modelLabelForSeat(seat) : 'unconfigured',
        status,
        failureClass,
        latencyMs: providerStatus?.latencyMs ?? null,
        fallbackUsed: providerStatus?.integrity.fallback_used ?? false,
        note: providerStatus?.note ?? 'No canonical provider entry for this seat.',
      },
      localCandidate: {
        roleSlot: slot,
        repo: entry?.repo ?? null,
        modelId: entry?.modelId ?? null,
        quantization: entry?.quant ?? null,
        enabled: Boolean(entry),
        health: localHealth,
      },
    }
  })

  // "Would-respond" diversity snapshot: what the CURRENTLY LIVE (external) backend selection
  // would look like right now, computed from real configuration state — never fabricated.
  const diversity = computeModelDiversity(
    seats
      .filter(row => row.active.status === 'READY')
      .map(row => ({
        seat: row.seat,
        backend: {
          backendType: 'EXTERNAL' as const,
          provider: row.active.provider,
          model: row.active.model,
          host: 'cloud',
          latencyMs: 0,
          status: 'OK' as const,
        },
      })),
  )

  const localRegistry = LOCAL_MODEL_REGISTRY.map(entry => ({
    slot: entry.slot,
    repo: entry.repo,
    modelId: entry.modelId,
    quantization: entry.quant,
    runtime: entry.runtime,
    residentPolicy: entry.residentPolicy,
    enabled: entry.enabled,
    health: localCandidateHealthFromProbe(entry.enabled ? entry : null, probe),
  }))

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      routingFoundation: 'AVAILABLE',
      liveRouting: 'EXTERNAL_ONLY',
      routingModeResolved: resolveCouncilRoutingMode(),
      routingModeNote:
        'routingModeResolved reflects lib/council/live-orchestration/backends config only. ' +
        'app/api/chat/execute.ts is not wired to it yet, so liveRouting stays EXTERNAL_ONLY regardless.',
      localModelPool: probe.available ? 'CONFIGURED / NOT ACTIVATED' : 'CONFIGURED / NOT ACTIVATED / RUNTIME UNREACHABLE',
      ollama: {
        reachable: probe.available,
        baseUrl: probe.baseUrl,
        installedModelCount: probe.models.length,
        probeLatencyMs,
      },
      seats,
      diversity,
      localRegistry,
      guardrails: {
        apiKeysExposed: false,
        authHeadersExposed: false,
        rawProviderPayloadsExposed: false,
        secretsExposed: false,
        cloudCompletionGenerated: false,
        localCompletionGenerated: false,
        cloudProviderProbeMayOccur: true,
        cloudProviderProbeNote:
          'External status/latency reuses lib/providers/health.ts (5 min cache) — the same lightweight, ' +
          'no-completion models-list probe ProviderRuntimePanel already triggers. Never a chat/completion call.',
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
