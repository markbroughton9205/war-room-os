/**
 * Reverse Engineer: a READ-ONLY analysis of an existing codebase area. It composes the existing Foundry code intelligence (AST index, symbol/reference/dependent lookup,
 * ownership ranking) with a few extra deterministic signals, and records every conclusion with its basis and evidence.
 * It is code/repository analysis only. Device / protocol reverse engineering is NOT part of this subsystem.
 */
export type Basis = 'FACT' | 'INFERENCE' | 'UNKNOWN'
export type Depth = 'quick' | 'standard' | 'deep'
export type OutputOption = 'explanation' | 'dependencyMap' | 'dataFlowMap' | 'changeImpact' | 'all'
export const DEPTHS: Depth[] = ['quick', 'standard', 'deep']
export const OUTPUT_OPTIONS: OutputOption[] = ['explanation', 'dependencyMap', 'dataFlowMap', 'changeImpact', 'all']

/** A pointer to the exact place a conclusion came from. */
export type Evidence = { id: string; kind: 'file' | 'symbol' | 'import' | 'route' | 'fetch' | 'persistence' | 'state' | 'ui' | 'test' | 'search' | 'count' | 'config'; file: string; line?: number; symbol?: string; note: string }
/** One statement the analysis makes. FACT = read directly from source; INFERENCE = derived by a stated rule; UNKNOWN = could not be established. */
export type Claim = { text: string; basis: Basis; evidence: string[] }

export type Layer = 'UI' | 'CLIENT' | 'API' | 'SERVICE' | 'STORE' | 'TEST' | 'SCRIPT' | 'OTHER'
export type FlowStep = { n: number; layer: Layer; file: string; line?: number; label: string; via: string; basis: Basis; evidence: string[] }
export type MapNode = { id: string; label: string; layer: Layer }
export type MapEdge = { from: string; to: string; kind: string; basis: Basis; evidence: string[] }
export type MapView = { title: string; nodes: MapNode[]; edges: MapEdge[]; text: string; truncated: boolean }

export type TargetKind = 'file' | 'group' | 'symbol' | 'route' | 'feature' | 'unresolved'
export type ResolvedTarget = { input: string; kind: TargetKind; owners: string[]; how: string; basis: Basis; candidates: { path: string; score: number }[] }

export type AnalysisRequest = { target: string; depth: Depth; outputs: OutputOption[]; question?: string }

export type RouteInfo = { path: string; file: string; methods: { method: string; line: number }[]; statuses: { status: number; line: number }[]; actions: { value: string; line: number }[]; callers: { file: string; line: number; method: string }[]; evidence: string[] }
export type UiConnection = { file: string; surfaces: { label: string; handler: string | null; line: number; reachesApi: string[]; testId?: string }[]; testIds: string[]; evidence: string[] }
export type StateInfo = {
  states: { name: string; file: string; line: number; values: string[]; evidence: string[] }[]
  assignments: { file: string; line: number; field: string; value: string; evidence: string[] }[]
  storage: { file: string; line: number; op: 'create' | 'change' | 'read' | 'delete' | 'ui-state' | 'browser-storage' | 'db' | 'env'; api: string; target: string; evidence: string[] }[]
}
export type TestCoverage = { relevant: { path: string; why: string; basis: Basis; evidence: string[] }[]; missing: Claim[] }
export type ChangeImpact = {
  perOwner: { file: string; directDependents: number; transitiveDependents: number; routesAffected: string[]; uiAffected: string[]; testsToRun: string[]; risk: 'LOW' | 'MEDIUM' | 'HIGH'; riskRule: string }[]
  summary: Claim[]
}

export type Provenance = {
  filesInspected: string[]
  symbolsInspected: string[]
  routesInspected: string[]
  methods: string[]
  deterministicTools: string[]
  /** The model that wrote the explanation. null = the explanation is template-built from the deterministic findings; no model was called. */
  model: string | null
  commandsRun: string[]
  snapshot: { root: string; fileCount: number; skipped: number; truncated: boolean; fingerprint: string; head: string | null }
}

export type AnalysisResult = {
  summary: Claim[]
  entryPoints: { file: string; line?: number; symbol?: string; kind: string; claim: Claim }[]
  flow: FlowStep[]
  dependencies: { file: string; internal: { path: string; evidence: string[] }[]; external: string[] }[]
  reverseDependents: { file: string; direct: { path: string; evidence: string[] }[]; transitive: { path: string; hops: number }[] }[]
  state: StateInfo
  routes: RouteInfo[]
  ui: UiConnection[]
  tests: TestCoverage
  changeImpact: ChangeImpact
  risks: Claim[]
  maps: { flow: MapView | null; imports: MapView | null; reverse: MapView | null; states: MapView | null }
}

export type AnalysisRecord = {
  schema: 1
  id: string
  createdAt: string
  createdBy: string
  request: AnalysisRequest
  target: ResolvedTarget
  /** sections the operator did not ask for are null; evidence, provenance and unknowns are always present */
  result: Partial<AnalysisResult> & { risks: Claim[] }
  omitted: string[]
  evidence: Evidence[]
  provenance: Provenance
  readOnly: { sourceModified: false; treeFingerprintBefore: string; treeFingerprintAfter: string; unchanged: boolean }
  /** what a follow-on build mission can be seeded with (the operator still approves the build) */
  handoff: { seedPaths: string[]; targetFiles: string[]; tests: string[]; contextLines: string[] }
  durationMs: number
}
