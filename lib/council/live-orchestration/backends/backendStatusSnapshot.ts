import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import type { OllamaProbeResult } from '@/lib/native-builder/ollamaClient'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { EXTERNAL_PROVIDER_BY_SEAT, externalBackendConfigured, modelLabelForSeat } from './externalBackend'
import { localCandidateHealthFromProbe } from './localBackend'
import { LOCAL_MODEL_REGISTRY } from './localModelRegistry'
import { SEAT_LOCAL_ROLE_SLOT } from './seatRoleSlot'
import { computeModelDiversity } from './diversity'
import { resolveCouncilRoutingMode } from './routingMode'
import {
  LIVE_COUNCIL_ROUTING_WIRED,
  LOCAL_BACKEND_FOUNDATION_READY,
  projectSeatBackendStatusRows,
  stripSecretBearingValue,
  type CouncilBackendStatusSnapshot,
  type LocalModelPoolRow,
  type SeatBackendStatusRow,
} from './uiStatusProjection'
import type { BackendMetadata, CouncilRoutingMode, SeatInvokeStatus } from './types'

export type ProviderHealthLite = {
  health: string
  latencyMs: number | null
}

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  moonshot: 'Moonshot',
  ollama: 'ollama',
  unknown: 'unconfigured',
}

function displayProvider(providerId: string): string {
  return PROVIDER_DISPLAY[providerId] ?? providerId
}

function metadataFromProviderHealth(
  seat: CouncilOrchestrationFamily,
  health: ProviderHealthLite | undefined,
): BackendMetadata {
  const providerId = EXTERNAL_PROVIDER_BY_SEAT[seat] ?? seat
  const configured = externalBackendConfigured(seat)
  if (!configured) {
    return {
      backendType: 'EXTERNAL',
      provider: displayProvider(providerId),
      model: 'unconfigured',
      host: 'cloud',
      latencyMs: 0,
      status: 'UNAVAILABLE',
      failureClass: 'AUTH',
    }
  }

  const model = modelLabelForSeat(seat)
  if (!health) {
    return {
      backendType: 'EXTERNAL',
      provider: displayProvider(providerId),
      model,
      host: 'cloud',
      latencyMs: 0,
      status: 'UNAVAILABLE',
      failureClass: 'UNKNOWN',
    }
  }

  if (health.health === 'CONNECTED') {
    return {
      backendType: 'EXTERNAL',
      provider: displayProvider(providerId),
      model,
      host: 'cloud',
      latencyMs: 0,
      status: 'OK',
    }
  }

  if (health.health === 'RATE_LIMITED') {
    return {
      backendType: 'EXTERNAL',
      provider: displayProvider(providerId),
      model,
      host: 'cloud',
      latencyMs: 0,
      status: 'FAILED',
      failureClass: 'RATE_LIMIT',
    }
  }

  if (health.health === 'MISSING_KEY' || health.health === 'INVALID_KEY') {
    return {
      backendType: 'EXTERNAL',
      provider: displayProvider(providerId),
      model: 'unconfigured',
      host: 'cloud',
      latencyMs: 0,
      status: 'UNAVAILABLE',
      failureClass: 'AUTH',
    }
  }

  return {
    backendType: 'EXTERNAL',
    provider: displayProvider(providerId),
    model,
    host: 'cloud',
    latencyMs: 0,
    status: 'UNAVAILABLE',
    failureClass: 'UNKNOWN',
  }
}

function poolHealthFromCandidate(
  health: ReturnType<typeof localCandidateHealthFromProbe>,
): LocalModelPoolRow['health'] {
  if (health === 'READY') return 'READY'
  if (health === 'MODEL_NOT_INSTALLED') return 'MODEL_NOT_INSTALLED'
  if (health === 'NOT_CONFIGURED') return 'NOT_CONFIGURED'
  return 'UNAVAILABLE'
}

function buildLocalModelPool(probe: OllamaProbeResult): LocalModelPoolRow[] {
  return LOCAL_MODEL_REGISTRY.map(entry => {
    const health = localCandidateHealthFromProbe(entry.enabled ? entry : null, probe)
    return {
      slot: entry.slot,
      candidateModel: entry.repo,
      repo: entry.repo,
      enabled: entry.enabled,
      runtime: entry.runtime === 'ollama' ? 'Ollama' : entry.runtime,
      health: poolHealthFromCandidate(health),
      residentPolicy: entry.residentPolicy,
      quantization: entry.quant,
      reuseNote: entry.slot === 'RESEARCH' && !entry.enabled
        ? 'Disabled on day 1 — reuses General'
        : null,
    }
  })
}

function configuredDiversity(seats: SeatBackendStatusRow[]): CouncilBackendStatusSnapshot['diversity'] {
  const configured = seats.filter(row => row.model !== 'unconfigured')
  const summary = computeModelDiversity(
    configured.map(row => ({
      seat: row.seat,
      backend: {
        backendType: row.backendType,
        provider: row.provider,
        model: row.model,
        host: row.backendType === 'LOCAL' ? 'local' : 'cloud',
        latencyMs: 0,
        status: 'OK' as SeatInvokeStatus,
      },
    })),
  )
  return {
    classification: 'CONFIGURED',
    uniqueModels: summary.uniqueModels,
    totalRespondingSeats: summary.totalRespondingSeats,
    sharedModelGroups: summary.sharedModelGroups,
  }
}

function liveDiversity(
  results: { seat: CouncilOrchestrationFamily; backend: BackendMetadata }[],
): CouncilBackendStatusSnapshot['diversity'] {
  const summary = computeModelDiversity(results)
  return {
    classification: 'LIVE',
    uniqueModels: summary.uniqueModels,
    totalRespondingSeats: summary.totalRespondingSeats,
    sharedModelGroups: summary.sharedModelGroups,
  }
}

export function buildCouncilBackendStatusSnapshot(args: {
  ollamaProbe: OllamaProbeResult
  providerHealthById?: Map<string, ProviderHealthLite>
  invocationResults?: { seat: CouncilOrchestrationFamily; backend: BackendMetadata }[]
  routingMode?: CouncilRoutingMode
  liveRoutingWired?: boolean
  generatedAt?: string
}): CouncilBackendStatusSnapshot {
  const routingMode = args.routingMode ?? resolveCouncilRoutingMode()
  const liveRoutingWired = args.liveRoutingWired ?? LIVE_COUNCIL_ROUTING_WIRED
  const localModelPool = buildLocalModelPool(args.ollamaProbe)

  let seats: SeatBackendStatusRow[]
  if (args.invocationResults && args.invocationResults.length > 0 && liveRoutingWired) {
    seats = projectSeatBackendStatusRows(
      args.invocationResults.map(result => ({
        ...result,
        localRoleSlot: SEAT_LOCAL_ROLE_SLOT[result.seat] ?? null,
      })),
    )
  } else {
    seats = projectSeatBackendStatusRows(
      COUNCIL_ROSTER.map(rosterEntry => {
        const providerId = EXTERNAL_PROVIDER_BY_SEAT[rosterEntry.id] ?? rosterEntry.id
        const backend = metadataFromProviderHealth(
          rosterEntry.id,
          args.providerHealthById?.get(providerId),
        )
        return {
          seat: rosterEntry.id,
          backend,
          localRoleSlot: SEAT_LOCAL_ROLE_SLOT[rosterEntry.id] ?? null,
        }
      }),
    ).map(row => ({
      ...row,
      // Live execute.ts is not wired through invokeCouncilSeat — do not present
      // provider-health probe timing as Council backend latency.
      latencyMs: null,
      fallbackUsed: false,
      fallbackFrom: null,
      fallbackReason: null,
    }))
  }

  const snapshot: CouncilBackendStatusSnapshot = {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    routingMode,
    liveRoutingWired,
    foundationReady: LOCAL_BACKEND_FOUNDATION_READY,
    seats,
    localModelPool,
    diversity:
      liveRoutingWired && args.invocationResults && args.invocationResults.length > 0
        ? liveDiversity(args.invocationResults)
        : configuredDiversity(seats),
  }

  return stripSecretBearingValue(snapshot)
}
