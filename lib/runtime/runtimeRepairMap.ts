import type { SubsystemRow } from '@/lib/runtime/runtimeIntegrityTypes'

export type RepairSeverity = 'low' | 'medium' | 'high' | 'critical'

export type RepairRecommendation = {
  subsystemId: string
  title: string
  summary: string
  severity: RepairSeverity
  /** Always true — runtime repair map never executes actions. */
  approvalRequired: true
}

function severityForRow(row: SubsystemRow): RepairSeverity {
  if (row.risk === 'high') return row.status === 'FAILING' ? 'critical' : 'high'
  if (row.risk === 'medium') return 'medium'
  return 'low'
}

/** Maps integrity rows to human-readable repair hints (approval-gated; no execution). */
export function mapIntegrityRowsToRepairs(rows: SubsystemRow[]): RepairRecommendation[] {
  const out: RepairRecommendation[] = []
  for (const row of rows) {
    if (row.status === 'HEALTHY' && row.truthLevel === 'VERIFIED') continue
    out.push({
      subsystemId: row.id,
      title: `${row.label}: review`,
      summary: row.recommendation,
      severity: severityForRow(row),
      approvalRequired: true,
    })
  }
  return out
}
