import type { EngineReceipt } from '../types'

export type CompiledFactState = 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED' | 'CONFLICTING' | 'STALE'
export type CompiledTemporalLabel = 'CURRENT' | 'HISTORICAL' | 'STALE' | 'SUPERSEDED' | 'UNVERIFIED' | 'TIME_UNKNOWN'

export type CompiledFact = {
  text: string
  evidence_ref: string | null
  state: CompiledFactState
  freshness?: string | null
  temporal_label?: CompiledTemporalLabel
  mission_id: string
}

export type CompiledContext = {
  mission_summary: string
  task_objective: string
  required_facts: CompiledFact[]
  relevant_evidence_refs: string[]
  open_questions: string[]
  conflicts: string[]
  hypotheses: string[]
  constraints: string[]
  tool_state: string[]
  authority_state: string[]
  prior_outputs: string[]
  excluded_context: string[]
  token_budget: number
  tokens_used: number
  role: string
  compiler_receipt: EngineReceipt
}

export type ContextCompilerInput = {
  mission_id: string
  role: 'PULSAR' | 'ORION' | 'LUMEN' | 'PHOENIX' | 'AURORA' | 'ATLAS' | 'JANUS' | 'SENTINEL'
  objective: string
  task_objective: string
  token_budget?: number
  verified_facts?: CompiledFact[]
  supported_facts?: CompiledFact[]
  unverified_facts?: CompiledFact[]
  conflicts?: string[]
  questions?: string[]
  hypotheses?: string[]
  source_assessments?: string[]
  work_products?: string[]
  tool_state?: string[]
  authority?: string[]
  constraints?: string[]
  foreign_mission_facts?: CompiledFact[]
  history?: string[]
  memory_facts?: CompiledFact[]
}
