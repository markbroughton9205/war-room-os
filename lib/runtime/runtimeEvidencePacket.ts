import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import { dedupeRuntimeContradictions } from '@/lib/runtime/runtimeContradiction'
import type { OverallStatus, RuntimeContradiction, RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'

export type RuntimeEvidencePacket = {
  generatedAt: string
  overallStatus: OverallStatus
  currentProviders: { id: string; displayName?: string; functional: boolean; lastSuccess: string | null }[]
  lastSuccesses: { id: string; at: string | null }[]
  internetTruth: RuntimeIntegrityResponse['internetRollup']
  persistence: RuntimeIntegrityResponse['persistence']
  activeDegraded: { id: string; label: string; status: string }[]
  historicalWarnings: RuntimeIntegrityResponse['historicalWarnings']
  currentFailures: RuntimeIntegrityResponse['currentFailures']
  optionalUnwired: RuntimeIntegrityResponse['optionalUnwired']
  liveVerified: RuntimeIntegrityResponse['liveVerified']
  contradictions: RuntimeContradiction[]
  councilRuntimeStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>
}

export function buildRuntimeEvidencePacket(
  integrity: RuntimeIntegrityResponse,
  councilRuntimeStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>,
  extraContradictions?: RuntimeContradiction[],
): RuntimeEvidencePacket {
  const activeDegraded = integrity.subsystems
    .filter(s => s.status === 'DEGRADED' || s.status === 'MOCK' || s.status === 'CONFIGURED_ONLY')
    .map(s => ({ id: s.id, label: s.label, status: s.status }))

  const contradictions = dedupeRuntimeContradictions([...integrity.contradictions, ...(extraContradictions ?? [])])

  return {
    generatedAt: integrity.generatedAt,
    overallStatus: integrity.overallStatus,
    currentProviders: integrity.providers.map(p => ({
      id: p.id,
      displayName: p.displayName,
      functional: p.functional,
      lastSuccess: p.lastSuccess,
    })),
    lastSuccesses: integrity.providers
      .filter(p => p.lastSuccess)
      .map(p => ({ id: p.id, at: p.lastSuccess })),
    internetTruth: integrity.internetRollup,
    persistence: integrity.persistence,
    activeDegraded,
    historicalWarnings: integrity.historicalWarnings,
    currentFailures: integrity.currentFailures,
    optionalUnwired: integrity.optionalUnwired,
    liveVerified: integrity.liveVerified,
    contradictions,
    ...(councilRuntimeStates && Object.keys(councilRuntimeStates).length
      ? { councilRuntimeStates }
      : {}),
  }
}

/**
 * Concise grounding block for sequential diagnostics — prepended to the council user prompt server-side.
 */
export function buildRuntimeDiagnosticGroundingBlock(
  packet: RuntimeEvidencePacket,
  opts?: { forbidTotalCollapse?: boolean },
): string {
  const lines: string[] = ['### Runtime evidence grounding (server-built, read-only)']
  lines.push(`- overallStatus: ${packet.overallStatus} · generatedAt: ${packet.generatedAt}`)
  if (packet.currentFailures.length) {
    lines.push(
      `- currentFailures: ${packet.currentFailures.map(f => `${f.subsystemId}(${f.severity})`).join(', ')}`,
    )
  } else {
    lines.push('- currentFailures: none')
  }
  if (packet.activeDegraded.length) {
    lines.push(`- activeDegraded: ${packet.activeDegraded.map(d => d.id).join(', ')}`)
  }
  if (packet.contradictions.length) {
    for (const c of packet.contradictions) {
      lines.push(`- contradiction[${c.kind}]: ${c.summary}`)
    }
  }
  if (packet.councilRuntimeStates && Object.keys(packet.councilRuntimeStates).length) {
    const bits = Object.entries(packet.councilRuntimeStates)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    lines.push(`- councilRuntimeStates: ${bits}`)
  }
  if (opts?.forbidTotalCollapse) {
    lines.push(
      '- Instruction: Do not claim the entire council or all providers are totally offline / fully collapsed when `overallStatus` is PARTIAL or healthier; acknowledge partial operation, live-verified slots, and any contradictions above.',
    )
  }
  return lines.join('\n')
}
