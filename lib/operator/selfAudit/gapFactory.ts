import type { GapStatus, OperatorGap } from '../gapFinder'
import type { SelfAuditCategory, SelfAuditFindingKind } from './types'

export function selfAuditGap(
  partial: Omit<OperatorGap, 'id' | 'status' | 'plainLanguage' | 'kind'> & {
    id?: string
    status?: GapStatus
    plainLanguage: string
    kind?: SelfAuditFindingKind
    category: SelfAuditCategory
  },
): OperatorGap {
  const id =
    partial.id ??
    `self-audit-${partial.category}-${partial.title}`.replace(/\s+/g, '-').toLowerCase()
  return {
    ...partial,
    id,
    status: partial.status ?? 'open',
    kind: partial.kind ?? 'issue',
    plainLanguage: partial.plainLanguage,
  }
}

export const JARGON_REPLACEMENTS: { pattern: RegExp; plain: string; suggestion: string }[] = [
  { pattern: /\bpacket\b/i, plain: 'summary bundle', suggestion: 'Rename “packet” to “summary” or “brief” in operator UI.' },
  { pattern: /\bschema\b/i, plain: 'database shape', suggestion: 'Say “database tables” instead of “schema” in commander-facing copy.' },
  { pattern: /\bruntime\b/i, plain: 'live system status', suggestion: 'Use “live status” instead of “runtime” in ribbons and badges.' },
  { pattern: /\bcanonical\b/i, plain: 'official status', suggestion: 'Label as “official status” or “system health snapshot”.' },
  { pattern: /\bsubsystem\b/i, plain: 'feature area', suggestion: 'Name the feature (e.g. memory, signals) instead of “subsystem”.' },
  { pattern: /\bdegraded\b/i, plain: 'lower quality', suggestion: 'Explain what failed and what still works.' },
  { pattern: /\bfederation\b/i, plain: 'combined sources', suggestion: 'Say “combined news sources” in Command Intel.' },
  { pattern: /\btelemetry\b/i, plain: 'live readings', suggestion: 'Use “live readings” or “status checks” for operators.' },
]
