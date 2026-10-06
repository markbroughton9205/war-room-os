/**
 * Commander-facing navigation view over existing EBC / deliberation source truth.
 * Not a second evidence store.
 */
export const COUNCIL_SOURCE_LINK_SCHEMA = 'council.source-link.v1' as const

export type SourceOpenMode = 'OPEN_INTERNAL' | 'OPEN_EXTERNAL' | 'COPY' | 'VIEW_EVIDENCE'
export type SourceFreshnessState = 'CURRENT' | 'STALE' | 'HISTORICAL' | 'UNKNOWN'
export type SourceAuthorityLabel = 'PRIMARY' | 'OFFICIAL' | 'ACADEMIC' | 'TECHNICAL' | 'NEWS' | 'SECONDARY' | 'UNKNOWN'
export type SourceBlockCode = 'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'MALFORMED_URL' | 'EMPTY_URL'

export type CouncilSourceLocation = {
  page?: number | null
  heading?: string | null
  anchor?: string | null
  text_fragment?: string | null
  section?: string | null
}

export type CouncilSourceLink = {
  schema: typeof COUNCIL_SOURCE_LINK_SCHEMA
  source_id: string
  title: string
  url: string | null
  domain: string | null
  source_type: string
  source_authority: SourceAuthorityLabel
  published_at: string | null
  observed_at: string | null
  freshness_state: SourceFreshnessState
  claim_ids: string[]
  evidence_ids: string[]
  mission_id: string | null
  session_id: string | null
  relevant_location: CouncilSourceLocation | null
  internal_open_supported: boolean
  external_open_supported: boolean
  copy_supported: boolean
  usable: boolean
  supporting: boolean
  rejection_reason: string | null
}

export type CouncilSourceOpenContext = {
  mission_id: string | null
  session_id: string | null
  source_id: string
  claim_ids: string[]
  evidence_ids: string[]
  url: string
  title: string
  verification_status: string | null
  source_authority: SourceAuthorityLabel
  freshness_state: SourceFreshnessState
  rejection_reason: string | null
  supporting: boolean
}

export type UrlSafetyDecision =
  | { ok: true; url: string; domain: string; protocol: 'http:' | 'https:' }
  | { ok: false; code: SourceBlockCode; reason: string }
