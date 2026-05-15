/** War Room runtime integrity dashboard — subsystem health classification (read-only diagnostics). */

export type OverallStatus = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'PARTIAL' | 'UNKNOWN'

export type SubsystemOperationalStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'FAILING'
  | 'UNWIRED'
  | 'MOCK'
  | 'UNKNOWN'
  | 'CONFIGURED_ONLY'

export type TruthLevel = 'VERIFIED' | 'PARTIAL' | 'DECLARED' | 'UNKNOWN'

export type SubsystemSource = 'fetch' | 'supabase' | 'import' | 'declared'

export type SubsystemRow = {
  id: string
  label: string
  status: SubsystemOperationalStatus
  truthLevel: TruthLevel
  evidence: string
  risk: 'low' | 'medium' | 'high'
  source: SubsystemSource
  mock: boolean
  unwired: boolean
  configured: boolean
  reachable: boolean
  recommendation: string
}

export type RuntimeIntegrityResponse = {
  generatedAt: string
  overallStatus: OverallStatus
  subsystems: SubsystemRow[]
}
