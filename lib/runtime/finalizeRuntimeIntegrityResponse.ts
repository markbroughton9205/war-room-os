import { getOrchestrationQueueDepth } from '@/lib/orchestration/taskOrchestrator'
import { buildRuntimeHealthRollup } from '@/lib/runtime/runtimeIntegrityMapper'
import {
  dedupeRuntimeContradictions,
  detectProviderHintVsEngineProbeContradictions,
} from '@/lib/runtime/runtimeContradiction'
import {
  applySubsystemEvidenceSeverities,
  computeOverallStatusWeighted,
  evidenceSeverityForSubsystemId,
} from '@/lib/runtime/runtimeEvidenceWeighting'
import type {
  DeploymentIntegrityRollup,
  InternetLayerRollup,
  PersistenceRollup,
  ProviderIntegritySlot,
  RuntimeContradiction,
  RuntimeIntegrityFailureView,
  RuntimeIntegrityLiveVerifiedItem,
  RuntimeIntegrityResponse,
  RuntimeIntegrityWarningView,
  SubsystemRow,
  ToolsLayerRollup,
} from '@/lib/runtime/runtimeIntegrityTypes'

export type RuntimeIntegrityPartial = {
  generatedAt: string
  subsystems: SubsystemRow[]
  attendanceParticipation: 'UNKNOWN'
  providers: ProviderIntegritySlot[]
  internetRollup: InternetLayerRollup | null
  persistence: PersistenceRollup
  toolsLayer: ToolsLayerRollup
  deployment: DeploymentIntegrityRollup
  councilMode?: string | null
}

const WARNING_STALE_MS = 120_000

function buildDashboardSlices(
  generatedAt: string,
  subsystems: SubsystemRow[],
  providers: ProviderIntegritySlot[],
  internetRollup: InternetLayerRollup | null,
  persistence: PersistenceRollup,
): Pick<
  RuntimeIntegrityResponse,
  'currentFailures' | 'historicalWarnings' | 'optionalUnwired' | 'liveVerified'
> {
  const staleAfter = new Date(Date.parse(generatedAt) + WARNING_STALE_MS).toISOString()

  const currentFailures: RuntimeIntegrityFailureView[] = subsystems
    .filter(s => s.status === 'FAILING')
    .map(s => ({
      subsystemId: s.id,
      label: s.label,
      evidence: s.evidence,
      severity: s.evidenceSeverity ?? evidenceSeverityForSubsystemId(s.id),
    }))

  const historicalWarnings: RuntimeIntegrityWarningView[] = subsystems
    .filter(s => s.status === 'DEGRADED' || s.status === 'MOCK')
    .map(s => ({
      subsystemId: s.id,
      label: s.label,
      message: s.evidence,
      severity: s.evidenceSeverity ?? evidenceSeverityForSubsystemId(s.id),
      staleAfter,
    }))

  const optionalUnwired: RuntimeIntegrityWarningView[] = subsystems
    .filter(s => {
      const w = s.evidenceSeverity ?? evidenceSeverityForSubsystemId(s.id)
      const optional = w === 'LOW' || w === 'INFORMATIONAL'
      const soft = s.unwired || s.status === 'UNWIRED' || s.status === 'CONFIGURED_ONLY'
      return optional && soft
    })
    .map(s => ({
      subsystemId: s.id,
      label: s.label,
      message: s.recommendation,
      severity: s.evidenceSeverity ?? evidenceSeverityForSubsystemId(s.id),
      staleAfter,
    }))

  const liveVerified: RuntimeIntegrityLiveVerifiedItem[] = []
  for (const p of providers) {
    if (!p.functional) continue
    liveVerified.push({
      kind: 'provider',
      label: p.displayName ?? p.id,
      detail: `${p.id}: functional=true${p.lastSuccess ? ` · lastSuccess=${p.lastSuccess}` : ''}`,
    })
  }
  if (internetRollup?.overallStatus === 'live') {
    liveVerified.push({
      kind: 'internet',
      label: 'Internet / research',
      detail: `overallStatus=${internetRollup.overallStatus ?? 'live'}`,
    })
  }
  const persOk =
    persistence.conversations === 'HEALTHY'
    && persistence.messages === 'HEALTHY'
    && persistence.actions === 'HEALTHY'
    && persistence.audit === 'HEALTHY'
  if (persOk) {
    liveVerified.push({
      kind: 'persistence',
      label: 'Supabase tables',
      detail: 'conversations, messages, actions, audit probes HEALTHY',
    })
  }

  return { currentFailures, historicalWarnings, optionalUnwired, liveVerified }
}

export function finalizeRuntimeIntegrityResponse(
  partial: RuntimeIntegrityPartial,
  opts?: { gatherContradictions?: RuntimeContradiction[] },
): RuntimeIntegrityResponse {
  const subsystems = applySubsystemEvidenceSeverities(partial.subsystems)
  const overallStatus = computeOverallStatusWeighted(subsystems)
  const runtimeHealth = buildRuntimeHealthRollup({
    councilModeFromQuery: partial.councilMode ?? null,
    orchestrationQueueDepth: getOrchestrationQueueDepth(),
    subsystems,
  })
  const internal = detectProviderHintVsEngineProbeContradictions(partial.providers)
  const gather = opts?.gatherContradictions ?? []
  const contradictions = dedupeRuntimeContradictions([...internal, ...gather])
  const slices = buildDashboardSlices(
    partial.generatedAt,
    subsystems,
    partial.providers,
    partial.internetRollup,
    partial.persistence,
  )
  return {
    generatedAt: partial.generatedAt,
    overallStatus,
    subsystems,
    attendanceParticipation: partial.attendanceParticipation,
    providers: partial.providers,
    internetRollup: partial.internetRollup,
    persistence: partial.persistence,
    runtimeHealth,
    toolsLayer: partial.toolsLayer,
    deployment: partial.deployment,
    contradictions,
    ...slices,
  }
}
