import { NextResponse } from 'next/server'

import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { snapshotLocalModelArbiter, backendExecutionLabel } from '@/lib/native-builder/localModelArbiter'
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
  resolveCouncilRoutingPreference,
  safeOllamaBaseUrl,
  type LocalCandidateHealth,
} from '@/lib/council/live-orchestration/backends'
import { localCouncilModelReadyFromProbe, probeNetworkEgress, probeTerraConnection } from '@/lib/council/live-orchestration/rosterHealth.server'
import {
  classifyCloudProviderStateFromHealth,
  classifyCouncilOperationalState,
  classifyResearchProviders,
  councilOperationalLabel,
  councilRoutingDisplay,
  EXTERNAL_COUNCIL_PROVIDER_TOTAL,
} from '@/lib/council/live-orchestration/councilContinuity'
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { nebulaAgentForSeat } from '@/lib/council/nebula/identity'
import { NEBULA_SHARED_BRAIN_SUMMARY } from '@/lib/council/nebula/modelProfile'
import { projectCouncilMemberIdentity } from '@/lib/council/live-orchestration/councilIdentity'

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
 * which resolves per-request from resolveCouncilRoutingMode() (packaged AppData, env
 * COUNCIL_ROUTING_MODE, else AUTO). `liveRoutingWired: true` below reflects that real fact.
 *
 * This route is, and remains, a PASSIVE snapshot: it has no per-invocation telemetry and does not
 * observe what any individual live request actually did. Two fields make that boundary explicit
 * rather than papering over it:
 *   - `localReadyForLiveRouting` is a real, computable fact — "is a local candidate enabled,
 *     currently probed healthy, AND would the resolved mode even consider it" — but it is
 *     READINESS/ELIGIBILITY, not proof any live seat ran locally. False under EXTERNAL_ONLY by
 *     construction (invokeExternalBackend() never touches local); can be true under AUTO/LOCAL_FIRST/
 *     HYBRID/LOCAL_ONLY purely from config+health, independent of whether a real call has ever gone through it.
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
  /** Nebula Council identity for this seat (e.g. 'AURORA'), or null when this seat has no Nebula
   * mapping yet (bridge_architect, baby — see lib/council/nebula/identity.ts). This is the ONLY
   * field a UI should render as the agent's name; `active.provider`/`active.model` below are
   * backend provenance for Inspector/diagnostics, never a substitute identity. */
  agentIdentity: string | null
  memberIdentityStatus?: 'READY' | 'PRESENT_BACKEND_UNAVAILABLE'
  backingRuntimeStatus?: 'LOCAL' | 'EXTERNAL' | 'HYBRID' | 'BACKEND_UNAVAILABLE'
  optionalExternal?: string | null
  cloudState: ReturnType<typeof classifyCloudProviderStateFromHealth> | null
  active: {
    backendType: 'LOCAL' | 'EXTERNAL'
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
    runtime: string | null
    sharedBacking: boolean
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
  if (status.health === 'MISSING_KEY') return { status: 'UNAVAILABLE' }
  if (status.health === 'INVALID_KEY') return { status: 'UNAVAILABLE', failureClass: 'AUTH' }
  return { status: 'UNKNOWN' }
}

export async function GET() {
  const probeStarted = Date.now()
  const [probe, providerRuntime, terraConnection, networkEgress, localModelArbiter] = await Promise.all([
    probeOllama(),
    getProviderRuntimeHealth(),
    probeTerraConnection(),
    probeNetworkEgress(),
    snapshotLocalModelArbiter(),
  ])
  const probeLatencyMs = Date.now() - probeStarted

  const providerByEid = new Map(providerRuntime.providers.map(p => [p.id, p]))
  const resolvedMode = resolveCouncilRoutingMode()
  const routingPreference = resolveCouncilRoutingPreference()
  const localCouncilReady = localCouncilModelReadyFromProbe(probe)
  const externalConfiguredCount = [
    envHasUsableProviderSecret('OPENAI_API_KEY'),
    envHasUsableProviderSecret('ANTHROPIC_API_KEY'),
    envHasUsableProviderSecret('XAI_API_KEY'),
    envHasUsableProviderSecret('GEMINI_API_KEY'),
  ].filter(Boolean).length
  const primaryHealth = ['openai', 'anthropic', 'xai', 'google'] as const
  const externalAvailableCount = primaryHealth.filter(id => providerByEid.get(id)?.health === 'CONNECTED').length
  const configuredProviderFailed = primaryHealth.some(id => {
    const health = providerByEid.get(id)?.health
    return health === 'INVALID_KEY' || health === 'RATE_LIMITED' || health === 'DEGRADED'
  })
  const operationalState = classifyCouncilOperationalState({
    externalConfiguredCount,
    externalAvailableCount,
    localReady: localCouncilReady && resolvedMode !== 'EXTERNAL_ONLY',
    configuredProviderFailed,
  })

  const seats: SeatStatusRow[] = COUNCIL_ROSTER.map(rosterEntry => {
    const seat = rosterEntry.id
    const providerId = EXTERNAL_PROVIDER_BY_SEAT[seat] ?? seat
    const providerStatus = providerByEid.get(providerId as ProviderRuntimeStatus['id'])
    const { status, failureClass } = activeStatusFromProviderHealth(providerStatus)

    const slot = SEAT_LOCAL_ROLE_SLOT[seat] ?? null
    const entry = slot ? localRegistryEntryForSlot(slot) : null
    const localHealth = localCandidateHealthFromProbe(entry, probe)
    const sharedBacking = Boolean(slot) && Object.values(SEAT_LOCAL_ROLE_SLOT).filter(item => item === slot).length > 1
    const cloudReady = status === 'READY' || status === 'DEGRADED' || status === 'RATE_LIMITED'
    const useLocalBacking =
      resolvedMode !== 'EXTERNAL_ONLY'
      && localHealth === 'READY'
      && !cloudReady
    const configured = seat === 'nova' || seat === 'bridge_architect'
      ? false
      : envHasUsableProviderSecret(
          seat === 'chatgpt' || seat === 'baby'
            ? 'OPENAI_API_KEY'
            : seat === 'claude' || seat === 'red_team'
              ? 'ANTHROPIC_API_KEY'
              : seat === 'grok'
                ? 'XAI_API_KEY'
                : seat === 'gemini'
                  ? 'GEMINI_API_KEY'
                  : '',
        )
    const cloudState = seat === 'nova' || seat === 'bridge_architect'
      ? null
      : classifyCloudProviderStateFromHealth(providerStatus?.health, configured)

    const identity = projectCouncilMemberIdentity({
      family: seat,
      cloudState,
      localReady: useLocalBacking || (seat === 'nova' && localHealth === 'READY'),
      localModel: entry?.modelId ?? null,
    })

    return {
      seat,
      label: rosterEntry.label,
      agentIdentity: nebulaAgentForSeat(seat)?.name ?? identity.identityName,
      memberIdentityStatus: identity.memberIdentityStatus,
      backingRuntimeStatus: identity.backingRuntimeStatus,
      optionalExternal: identity.optionalExternalLine,
      cloudState,
      active: useLocalBacking
        ? {
            backendType: 'LOCAL' as const,
            provider: 'ollama',
            model: entry?.modelId ?? 'local',
            status: 'READY' as const,
            latencyMs: probeLatencyMs,
            fallbackUsed: null,
            fallbackReason: null,
            // fallbackUsed null means UNKNOWN / NOT OBSERVED. providerStatus.integrity.fallback_used
            // is a different pipeline signal and must never be reused here.
            note: 'LOCAL BACKING · seat identity unchanged',
          }
        : {
            backendType: 'EXTERNAL' as const,
            provider: providerDisplayName(providerId),
            model: cloudReady ? modelLabelForSeat(seat) : 'unconfigured',
            status,
            failureClass,
            latencyMs: providerStatus?.latencyMs ?? null,
            fallbackUsed: null,
            fallbackReason: null,
            // fallbackUsed null means UNKNOWN / NOT OBSERVED. providerStatus.integrity.fallback_used
            // is a different pipeline signal and must never be reused here.
            note: providerStatus?.note ?? 'No canonical provider entry for this seat.',
          },
      localCandidate: {
        roleSlot: slot,
        repo: entry?.repo ?? null,
        modelId: entry?.modelId ?? null,
        quantization: entry?.quant ?? null,
        runtime: entry?.runtime ?? null,
        sharedBacking,
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
          backendType: row.active.backendType,
          provider: row.active.provider,
          model: row.active.model,
          host: row.active.backendType === 'LOCAL' ? safeOllamaBaseUrl(probe.baseUrl) : 'cloud',
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

  const localReadyForLiveRouting =
    resolvedMode !== 'EXTERNAL_ONLY' && seats.some(row => row.localCandidate.enabled && row.localCandidate.health === 'READY')

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      routingFoundation: 'AVAILABLE',
      liveRoutingWired: true,
      routingPreference,
      routingModeResolved: resolvedMode,
      operationalState,
      operationalLabel: councilOperationalLabel(operationalState),
      routingDisplay: councilRoutingDisplay(resolvedMode, operationalState),
      externalProviderCount: { configured: externalConfiguredCount, total: EXTERNAL_COUNCIL_PROVIDER_TOTAL },
      localCouncil: {
        ready: localCouncilReady,
        novaReady: localCouncilReady,
        label: localCouncilReady ? 'NOVA READY' : 'UNAVAILABLE',
      },
      terraConnection,
      networkEgress,
      researchProviders: classifyResearchProviders({
        tavilyConfigured: envHasUsableProviderSecret('TAVILY_API_KEY'),
        firecrawlConfigured: envHasUsableProviderSecret('FIRECRAWL_API_KEY'),
        xaiConfigured: envHasUsableProviderSecret('XAI_API_KEY'),
      }),
      localBackendAvailable: probe.available,
      localReadyForLiveRouting,
      localServingLiveSeats: 'UNKNOWN' as const,
      backendExecutionState: localModelArbiter.councilBackendExecutionState,
      backendExecutionLabel: backendExecutionLabel(localModelArbiter.councilBackendExecutionState),
      gpuOwner: localModelArbiter.gpuOwner,
      foundryActive: localModelArbiter.foundryActive,
      localModelArbiter: {
        owners: localModelArbiter.owners,
        councilModel: localModelArbiter.councilModel,
        foundryCoderModel: localModelArbiter.foundryCoderModel,
        gpuOwner: localModelArbiter.gpuOwner,
        foundryActive: localModelArbiter.foundryActive,
        councilBackendExecutionState: localModelArbiter.councilBackendExecutionState,
        resident: localModelArbiter.resident.map(row => ({ name: row.name, owner: row.owner })),
        detail: localModelArbiter.detail,
      },
      routingModeNote:
        'routingPreference is AUTO by default for sovereign packaged War Room. routingModeResolved is the effective invoke mode ' +
        '(AUTO with 0 cloud keys → LOCAL_FIRST; AUTO with any cloud keys → HYBRID). liveRoutingWired=true means execute.ts ' +
        'calls invokeCouncilSeat(). localReadyForLiveRouting is config+health readiness, not proof of serving; ' +
        'localServingLiveSeats stays UNKNOWN until real per-invocation telemetry exists.',
      localModelPool: localReadyForLiveRouting
        ? 'CONFIGURED / READY FOR LIVE ROUTING'
        : probe.available
          ? 'CONFIGURED / NOT ACTIVATED'
          : 'CONFIGURED / NOT ACTIVATED / RUNTIME UNREACHABLE',
      ollama: {
        reachable: probe.available,
        baseUrl: safeOllamaBaseUrl(probe.baseUrl),
        installedModelCount: probe.models.length,
        probeLatencyMs,
      },
      seats,
      diversity,
      nebulaSharedBrain: NEBULA_SHARED_BRAIN_SUMMARY,
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
