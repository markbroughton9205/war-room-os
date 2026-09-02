import type { VerificationState } from '@/lib/world-learning/types'

export type SourceClass = 'ELIGIBLE' | 'REQUIRES_REVIEW' | 'INELIGIBLE' | 'TEST_ONLY' | 'EVAL_ONLY'

export type ExampleFormat =
  | 'language_modeling'
  | 'code'
  | 'instruction_response'
  | 'tool_use'
  | 'retrieval_grounded'
  | 'source_grounded_research'
  | 'contradiction_handling'
  | 'temporal_reasoning'
  | 'spatial_terra_reasoning'
  | 'commander_correction'
  | 'structured_json'
  | 'project_memory_continuity'

export type QualityTier = 'A' | 'B' | 'C' | 'excluded'

export type Trainability = 'positive_training' | 'failure_curriculum' | 'eval_only' | 'test_only' | 'excluded'

export type CorpusSourceInventoryRow = {
  sourceId: string
  path: string
  class: SourceClass
  format: ExampleFormat
  capabilityTags: string[]
  rights: { licenseName: string; permitsTrainingUse: boolean; notes: string }
  provenanceRef: string
  contentHash: string
  normalizedHash: string
  byteLength: number
  estimatedTokens: number
  exclusionReasons: string[]
}

export type ObservableExample = {
  exampleId: string
  format: ExampleFormat
  qualityTier: QualityTier
  trainability: Trainability
  capabilityTags: string[]
  sourceClass: SourceClass
  sourceIds: string[]
  provenanceRefs: string[]
  rights: { licenseName: string; permitsTrainingUse: boolean }
  input: string
  contextRefs: string[]
  toolAction: string | null
  toolResult: string | null
  evidenceRefs: string[]
  finalResponse: string
  validator: string
  outcome: 'pass' | 'fail' | 'inconclusive' | 'corrected'
  correction: string | null
  claimStatus?: VerificationState
  contentHash: string
  lineageIds: string[]
}

export const EXAMPLE_FORMATS: ExampleFormat[] = [
  'language_modeling', 'code', 'instruction_response', 'tool_use', 'retrieval_grounded',
  'source_grounded_research', 'contradiction_handling', 'temporal_reasoning', 'spatial_terra_reasoning',
  'commander_correction', 'structured_json', 'project_memory_continuity',
]

export const CAPABILITY_CATEGORIES = [
  'code', 'engineering_evidence', 'tool_use', 'research', 'world_learning', 'terra',
  'commander_correction', 'structured_output', 'retrieval', 'language_modeling',
] as const

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]

export type EngineeringFamily =
  | 'repo_navigation'
  | 'diagnosis'
  | 'repair'
  | 'test_construction'
  | 'schema_reasoning'
  | 'build_reasoning'
  | 'type_lint_repair'
  | 'artifact_verification'
  | 'api_reasoning'
  | 'error_recovery'
  | 'tool_selection'

export const ENGINEERING_FAMILIES: EngineeringFamily[] = [
  'repo_navigation', 'diagnosis', 'repair', 'test_construction', 'schema_reasoning',
  'build_reasoning', 'type_lint_repair', 'artifact_verification', 'api_reasoning',
  'error_recovery', 'tool_selection',
]

export type ToolActionRecord = {
  tool: string
  arguments: Record<string, unknown>
  selected: boolean
}

export type ToolResultRecord = {
  tool: string
  result: string
  exitCode: number
}

export type ProvenanceRecord = {
  sourceOwner: string
  licenseName: string
  sourceRef: string
  retrievedAt: string
  contentHash: string
  transformation: string
}

export type ChunkRecord = {
  chunkId: string
  documentId: string
  sourceId: string
  sourceHash: string
  parentLineage: string
  path: string
  offsetStart: number
  offsetEnd: number
  text: string
  contentHash: string
  normalizedHash: string
  capabilityTags: string[]
  format: ExampleFormat
  qualityTier: QualityTier
  split: 'train' | 'validation' | 'test'
  byteLength: number
  tokenizerTokens: number | null
}

export type HardenedExample = ObservableExample & {
  toolActions: ToolActionRecord[]
  toolResults: ToolResultRecord[]
  renderedTrainingText: string
  renderedHash: string
  validatorSpec: { type: string; expected: string }
  provenance: ProvenanceRecord
  engineeringFamily?: EngineeringFamily
}

export type VerificationStatus = 'verified' | 'not_checked' | 'unknown'

export const WAVE8_PREDECESSOR_CORPUS_ID = 'WR-CORPUS-1-CANDIDATE'
export const WAVE8_PREDECESSOR_CORPUS_HASH = '36f357baa2e7b117d5f4bbf425469ad677e53b2af5a01de68e079d53cc62419e'
export const HARDENED_CORPUS_ID = 'WR-CORPUS-1-HARDENED-CANDIDATE'
export const WR_TOKENIZER_0_SHA = '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7'
export const WRIM0_CHECKPOINT_SHA = 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015'
