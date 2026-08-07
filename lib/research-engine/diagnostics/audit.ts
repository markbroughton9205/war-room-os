import 'server-only'

import type { ResearchProviderId } from '@/lib/research-engine/core/types'

/**
 * Safe audit metadata for a Research Engine call. No new Supabase table is
 * created for this build (not approved) — this writes structured, redacted
 * metadata to the server log only. Never includes the raw query text or any
 * secret value.
 */
export type ResearchAuditEvent = {
  operation: 'providers_list' | 'provider_health' | 'search'
  provider: ResearchProviderId | 'multi'
  queryHash: string | null
  startedAt: string
  durationMs: number
  resultCount: number | null
  outcome: 'success' | 'partial_failure' | 'failure'
  errorCategory: string | null
  requestedBy: string
}

function hashQueryText(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return `q_${Math.abs(hash).toString(36)}_len${text.length}`
}

export function redactedQueryHash(text: string | null | undefined): string | null {
  return text ? hashQueryText(text) : null
}

export function recordResearchAudit(event: ResearchAuditEvent): void {
  console.log('[research-engine-audit]', JSON.stringify(event))
}
