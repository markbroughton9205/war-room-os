/** Model Forge: War Room Foundry's model registry, lineage, resource profiles and benchmark-driven routing evidence. */
export type ModelStatus = 'ACTIVE' | 'BASELINE' | 'FUTURE_HEAVY' | 'CANDIDATE' | 'RETIRED'
/** MEASURED = observed on this machine; ESTIMATED = derived from artifact size only; UNKNOWN = not determined. */
export type Residency = 'FULL_GPU' | 'PARTIAL_OFFLOAD' | 'CPU_ASSISTED' | 'REQUIRES_OFFLOAD' | 'CAN_RUN_SLOW' | 'UNKNOWN'
export type Basis = 'MEASURED' | 'ESTIMATED' | 'UNKNOWN'
export type TaskClass = 'complete_feature' | 'multi_file_implementation' | 'debugging' | 'review' | 'light_implementation' | 'structured_output'

export type ModelEntry = {
  id: string
  ref: string // exact tag the executor is called with
  family: string
  roles: string[]
  status: ModelStatus
  license: { statement: string; permissive: 'YES' | 'NO' | 'UNKNOWN' }
  lineage: { parent?: string; transformation?: string; note: string }
  routing: { eligible: boolean; reason: string } // BASELINE/FUTURE_HEAVY are never routed implicitly
  artifactBytes?: number
  digest?: string
}
export type ResourceProfile = {
  modelRef: string
  at: string
  basis: Basis
  residency: Residency
  artifactBytes: number | 'UNKNOWN'
  vramBytesLoaded: number | 'UNKNOWN' // from the runtime's own accounting
  gpuUsedMiBAfterLoad: number | 'UNKNOWN'
  systemRamUsedMiBAfterLoad: number | 'UNKNOWN'
  contextTokens: number
  loadMs: number | 'UNKNOWN'
  firstTokenMs: number | 'UNKNOWN'
  tokensPerSecond: number | 'UNKNOWN'
  note: string
}
export type SmokeResult = { modelRef: string; at: string; identity: { ok: boolean; detail: string }; responds: boolean; structured: boolean; coding: boolean; throughFoundryClient: boolean; passed: boolean; detail: string[] }
export type BenchmarkRecord = {
  modelRef: string
  executor: string
  fixture: string
  /** short git SHA of the engine code the run executed against */
  engineSha?: string
  at: string
  taskClass: TaskClass
  verifierScore: { pass: number; total: number } | 'UNKNOWN'
  completion: 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'BLOCKED'
  modelCalls: number
  repairs: number
  retries: number | 'UNKNOWN'
  regressions: number | 'UNKNOWN'
  elapsedMs: number
  manualIntervention: boolean
  contextTokens: number
  ramMiB: number | 'UNKNOWN'
  vramMiB: number | 'UNKNOWN'
  rootCause?: string
  evidencePath?: string
  historicalBaseline?: boolean
}
export type ForgeRecord =
  | ({ type: 'model'; rid: string; at: string } & ModelEntry)
  | ({ type: 'profile'; rid: string } & ResourceProfile)
  | ({ type: 'smoke'; rid: string } & SmokeResult)
  | ({ type: 'benchmark'; rid: string } & BenchmarkRecord)
