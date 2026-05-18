import type { EvidenceSeverity, OverallStatus, SubsystemRow } from '@/lib/runtime/runtimeIntegrityTypes'

export type { EvidenceSeverity } from '@/lib/runtime/runtimeIntegrityTypes'

/**
 * Per-subsystem evidence weighting (read-only diagnostics).
 * CRITICAL/HIGH: core council path, persistence, or live engine plane.
 * LOW / INFORMATIONAL: credential hints, orchestrator bookkeeping, optional tooling.
 */
export function evidenceSeverityForSubsystemId(id: string): EvidenceSeverity {
  switch (id) {
    case 'action_queue':
    case 'supabase_conversations':
      return 'CRITICAL'
    case 'engine_control':
    case 'internet_layer':
      return 'HIGH'
    case 'deploy_status':
    case 'memory_proposals':
      return 'MEDIUM'
    case 'red_sentinel':
    case 'red_team_coder':
      return 'LOW'
    case 'orchestration':
    case 'providers_health':
      return 'INFORMATIONAL'
    default:
      return 'MEDIUM'
  }
}

function severityRank(s: EvidenceSeverity): number {
  switch (s) {
    case 'CRITICAL':
      return 4
    case 'HIGH':
      return 3
    case 'MEDIUM':
      return 2
    case 'LOW':
      return 1
    case 'INFORMATIONAL':
      return 0
    default:
      return 2
  }
}

function weightOf(row: SubsystemRow): EvidenceSeverity {
  return row.evidenceSeverity ?? evidenceSeverityForSubsystemId(row.id)
}

function isHardFailure(status: SubsystemRow['status']): boolean {
  return status === 'FAILING'
}

function isDegraded(status: SubsystemRow['status']): boolean {
  return status === 'DEGRADED' || status === 'MOCK'
}

function isSoftGap(status: SubsystemRow['status']): boolean {
  return status === 'UNKNOWN' || status === 'CONFIGURED_ONLY' || status === 'UNWIRED'
}

/**
 * Attach `evidenceSeverity` for UI / diagnostics; does not change operational classification.
 */
export function applySubsystemEvidenceSeverities(rows: SubsystemRow[]): SubsystemRow[] {
  return rows.map(r => ({
    ...r,
    evidenceSeverity: evidenceSeverityForSubsystemId(r.id),
  }))
}

/**
 * Collapse weighted subsystem states into a headline `overallStatus`.
 * PARTIAL is allowed when only LOW/INFORMATIONAL-weight rows are hard-failing or degraded while
 * higher-weight planes are healthy or only softly unknown.
 */
export function computeOverallStatusWeighted(subsystems: SubsystemRow[]): OverallStatus {
  if (!subsystems.length) return 'UNKNOWN'

  const failingRows = subsystems.filter(s => isHardFailure(s.status))
  if (failingRows.length) {
    const onlyOptionalFail = failingRows.every(s => {
      const w = weightOf(s)
      return w === 'LOW' || w === 'INFORMATIONAL'
    })
    if (onlyOptionalFail) return 'PARTIAL'
    return 'FAILING'
  }

  const degradedRows = subsystems.filter(s => isDegraded(s.status))
  if (degradedRows.length) {
    const onlyOptionalDegraded = degradedRows.every(s => {
      const w = weightOf(s)
      return w === 'LOW' || w === 'INFORMATIONAL'
    })
    if (onlyOptionalDegraded) return 'PARTIAL'
    return 'DEGRADED'
  }

  const softRows = subsystems.filter(s => isSoftGap(s.status))
  if (softRows.length) {
    const onlyOptionalSoft = softRows.every(s => {
      const w = weightOf(s)
      return w === 'LOW' || w === 'INFORMATIONAL'
    })
    if (onlyOptionalSoft) return 'PARTIAL'
    const anyMediumPlus = softRows.some(s => severityRank(weightOf(s)) >= severityRank('MEDIUM'))
    if (anyMediumPlus) return 'DEGRADED'
    return 'PARTIAL'
  }

  const allHealthy = subsystems.every(s => s.status === 'HEALTHY')
  if (allHealthy) return 'HEALTHY'

  return 'UNKNOWN'
}
