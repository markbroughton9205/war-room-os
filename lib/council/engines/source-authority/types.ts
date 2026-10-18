import type { FreshnessDecision, SourceAuthorityClass } from '@/lib/browser-broker/researchPolicy'
import type { EngineReceipt } from '../types'

export type SourceDecision =
  | 'ACCEPT'
  | 'REJECT_OFF_TOPIC'
  | 'REJECT_STALE'
  | 'REJECT_WRONG_AUTHORITY'
  | 'REJECT_DUPLICATE'
  | 'REJECT_EXTRACTION_FAILED'
  | 'REJECT_UNSAFE_OR_INVALID'
  | 'DATE_UNKNOWN'

export type IndependenceState = 'INDEPENDENT' | 'DUPLICATE' | 'SYNDICATED' | 'UNKNOWN'
export type ExtractabilityState = 'USABLE' | 'FAILED' | 'INSUFFICIENT' | 'UNSAFE'

export type SourceAssessment = {
  candidate_id: string
  url: string
  relevance_score: number
  authority_score: number
  primaryness_score: number
  freshness_state: FreshnessDecision
  independence_state: IndependenceState
  extractability_state: ExtractabilityState
  source_class: SourceAuthorityClass
  decision: SourceDecision
  reasons: string[]
}

export type SourceAuthorityInput = {
  mission_id: string
  prompt: string
  url: string
  title?: string
  text?: string
  published_at?: string | null
  updated_at?: string | null
  retrieved_at?: string | null
  duplicate?: boolean
  extraction_ok?: boolean
  content_hash?: string | null
  accepted_identities?: readonly string[]
  now?: number
}

export type SourceAuthorityResult = {
  assessment: SourceAssessment
  receipt: EngineReceipt
}
