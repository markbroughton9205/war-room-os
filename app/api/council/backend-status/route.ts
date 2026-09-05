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
  providerDisplayName,
  resolveCouncilRoutingMode,
  safeOllamaBaseUrl,
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
 * Live Council chat (app/api/chat/execute.ts) IS wired to this backend layer as of the
 * council-live-routing mission — every seat call there now goes through invokeCouncilSeat(),
 * which resolves per-request from resolveCouncilRoutingMode() (env COUNCIL_ROUTING_MODE, unset
 * everywhere real -> EXTERNAL_ONLY). `liveRoutingWired: true` below reflects that real fact.
 *
 * This route is, and remains, a PASSIVE snapshot: it has no per-invocation telemetry and does not
 * observe what any individual live request actually did. Two fields make that boundary explicit
 * rather than papering over it:
 *   - `localReadyForLiveRouting` is a real, computable fact — "is a local candidate enabled,
 *     currently probed healthy, AND would the resolved mode even consider it" — but it is
 *     READINESS/ELIGIBILITY, not proof any live seat ran locally. False under EXTERNAL_ONLY by
 *     construction (invokeExternalBackend() never touches local); can be true under a non-default
 *     mode purely from config+health, independent of whether a real call has ever gone through it.
 *   - `localServingLiveSeats` is always the literal string 'UNKNOWN' here. Answering it for real
 *     would require per-invocation backend telemetry, which this mission deliberately does not
 *     add (see the council-live-routing-truth-hardening mission). Do not infer a boolean from
 *     `localReadyForLiveRouting` and present it as this field's answer.
 * Every seat below is reported by what is ACTUALLY live (external, resolved the same way a real
 * request would), plus an informational, clearly-labeled "local candidate" health check that is
 * never presented as currently serving Council calls.
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
    /** null = unknown/not observed (this route has no per-invocation telemetry), never a claim of "no fallback". */
    fallbackUsed: boolean | null
    fallbackReason: string | null
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
        provider: providerDisplayName(providerId),
        model: status === 'READY' || status === 'DEGRADED' || status === 'RATE_LIMITED' ? modelLabelForSeat(seat) : 'unconfigured',
        status,
        failureClass,
        latencyMs: providerStatus?.latencyMs ?? null,
        // This route is a passive health snapshot — it does not observe or persist the outcome of
        // any individual live invokeCouncilSeat() call, so real per-call fallback metadata
        // (BackendMetadata.fallbackFrom/fallbackReason) is not available here.
        // fallbackUsed: null means UNKNOWN / NOT OBSERVED — it is NOT a claim that no fallback
        // happened. Reporting `false` here would be a lie now that execute.ts genuinely routes
        // through invokeCouncilSeat(); this route simply has no visibility into what any given
        // live request actually did. `providerStatus.integrity.fallback_used` is a DIFFERENT,
        // pre-existing signal from lib/providers/health.ts's own retry/integrity pipeline — it
        // reflects that pipeline's internal fallback behavior, not this mission's Council
        // backend-routing fallback concept, and must never be reused here even though the names
        // coincide. A future mission that adds per-call invocation logging could read real
        // BackendMetadata.fallbackFrom/fallbackReason from that log instead of reporting unknown.
        fallbackUsed: null,
        fallbackReason: null,
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

  const resolvedMode = resolveCouncilRoutingMode()
  // READINESS/ELIGIBILITY, not proof of actual serving. Conservative by construction:
  // EXTERNAL_ONLY structurally never touches local (proven, not guessed —
  // invokeExternalBackend() is the only path invokeCouncilSeat() can take under it), so this is
  // false there regardless of local health. Under any other mode this turns true purely from
  // config+health — a local candidate is BOTH enabled AND currently probed healthy — which is
  // NOT proof any live seat has actually run locally. Do not present this value as an answer to
  // "is local serving live seats right now" — that question is answered by localServingLiveSeats
  // below, which stays the literal string 'UNKNOWN' until real per-invocation telemetry exists.
  const localReadyForLiveRouting =
    resolvedMode !== 'EXTERNAL_ONLY' && seats.some(row => row.localCandidate.enabled && row.localCandidate.health === 'READY')

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      routingFoundation: 'AVAILABLE',
      // True: app/api/chat/execute.ts calls invokeCouncilSeat() for every non-kimi seat. This is
      // NOT a claim that local models are active — see routingModeResolved/localServingLiveSeats.
      liveRoutingWired: true,
      routingModeResolved: resolvedMode,
      localBackendAvailable: probe.available,
      // Readiness/eligibility — real, computed, but NOT proof a live seat actually ran locally.
      localReadyForLiveRouting,
      // Always 'UNKNOWN': this route has no per-invocation telemetry. Never infer this from
      // localReadyForLiveRouting — readiness and "did it actually happen" are different questions.
      localServingLiveSeats: 'UNKNOWN' as const,
      routingModeNote:
        'routingModeResolved is what app/api/chat/execute.ts actually resolves per live request via ' +
        'invokeCouncilSeat() (env COUNCIL_ROUTING_MODE; unset -> EXTERNAL_ONLY). liveRoutingWired=true ' +
        'means the call happens for real. localReadyForLiveRouting is config+health readiness, not ' +
        'proof of serving; localServingLiveSeats stays UNKNOWN until real per-invocation telemetry exists.',
      localModelPool: probe.available ? 'CONFIGURED / NOT ACTIVATED' : 'CONFIGURED / NOT ACTIVATED / RUNTIME UNREACHABLE',
      ollama: {
        reachable: probe.available,
        // Reconstructed from protocol+hostname+port only — never the raw configured URL, so a
        // credential-bearing OLLAMA_BASE_URL (e.g. embedded basic-auth userinfo) can't leak here.
        baseUrl: safeOllamaBaseUrl(probe.baseUrl),
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
