import type { CanonicalRuntimeStatus } from './canonicalStatus'

export type WarRoomStatusSigilState = 'green' | 'yellow' | 'red'

export type WarRoomStatusSigil = {
  state: WarRoomStatusSigilState
  ariaLabel: string
  reason: string
  criticalProbeSummary: { id: string; health: string; confidence: number; stale: boolean }[]
}

const REQUIRED_CRITICAL_PROBES = ['provider_runtime', 'signal_radar', 'persistence', 'approval_gate'] as const
const STATUS_STALE_MS = 5 * 60 * 1000

function isStale(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return true
  const parsed = Date.parse(iso)
  return !Number.isFinite(parsed) || nowMs - parsed > STATUS_STALE_MS
}

function criticalRows(status: CanonicalRuntimeStatus, nowMs: number) {
  const byId = new Map(status.subsystems.map(row => [row.id, row]))
  return REQUIRED_CRITICAL_PROBES.map(id => {
    const row = byId.get(id)
    return {
      id,
      row,
      health: row?.health ?? 'unknown',
      confidence: row?.confidence ?? 0,
      stale: isStale(row?.lastChecked ?? status.generatedAt, nowMs),
    }
  })
}

function hasSecurityFailure(status: CanonicalRuntimeStatus): boolean {
  return status.guardrails.apiKeysExposed
    || status.guardrails.hiddenExecution
    || status.guardrails.autonomousFinancialAction
    || status.guardrails.browserShellExecution
    || status.guardrails.deploymentMutation
    || status.guardrails.fakeConnectedStates
    || status.guardrails.fakeSourceBackedClaims
}

export function resolveWarRoomStatusSigil(status: CanonicalRuntimeStatus | null, nowMs = Date.now()): WarRoomStatusSigil {
  if (!status) {
    return {
      state: 'yellow',
      ariaLabel: 'War Room status unknown. Runtime telemetry has not been loaded.',
      reason: 'No canonical runtime telemetry loaded.',
      criticalProbeSummary: REQUIRED_CRITICAL_PROBES.map(id => ({ id, health: 'unknown', confidence: 0, stale: true })),
    }
  }
  const rows = criticalRows(status, nowMs)
  const missing = rows.filter(item => !item.row)
  const stale = rows.filter(item => item.stale)
  const unavailable = rows.filter(item => item.health === 'unavailable')
  const degraded = rows.filter(item => item.health === 'degraded' || item.health === 'unknown')
  if (hasSecurityFailure(status) || unavailable.length > 0 || status.summary.health === 'unavailable') {
    const reason = hasSecurityFailure(status)
      ? 'Security or integrity guardrail failure reported by canonical runtime.'
      : `Critical probe failure: ${unavailable.map(item => item.id).join(', ')}.`
    return { state: 'red', ariaLabel: `War Room status red. ${reason}`, reason, criticalProbeSummary: rows.map(({ id, health, confidence, stale: isProbeStale }) => ({ id, health, confidence, stale: isProbeStale })) }
  }
  if (missing.length || stale.length || degraded.length || status.summary.health !== 'healthy') {
    const reason = missing.length
      ? `Missing critical telemetry: ${missing.map(item => item.id).join(', ')}.`
      : stale.length
        ? `Stale critical telemetry: ${stale.map(item => item.id).join(', ')}.`
        : `Runtime degraded or unverified: ${degraded.map(item => item.id).join(', ') || status.summary.health}.`
    return { state: 'yellow', ariaLabel: `War Room status yellow. ${reason}`, reason, criticalProbeSummary: rows.map(({ id, health, confidence, stale: isProbeStale }) => ({ id, health, confidence, stale: isProbeStale })) }
  }
  return {
    state: 'green',
    ariaLabel: 'War Room status green. Required critical probes recently passed.',
    reason: 'Required critical probes are healthy and fresh.',
    criticalProbeSummary: rows.map(({ id, health, confidence, stale: isProbeStale }) => ({ id, health, confidence, stale: isProbeStale })),
  }
}

export function buildStatusSigilDiagnostics(status: CanonicalRuntimeStatus | null): string[] {
  const sigil = resolveWarRoomStatusSigil(status)
  return [sigil.reason, ...sigil.criticalProbeSummary.map(row => `${row.id}: ${row.health}, confidence ${row.confidence}, stale ${row.stale}`)]
}
