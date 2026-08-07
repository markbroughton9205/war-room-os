import type { ResearchCitation, ResearchDocument } from '@/lib/research-engine/core/types'

const STRONG_IDENTIFIER_KEYS = [
  'doi', 'pmid', 'pmcid', 'arxiv_id', 'github_full_name', 'wikidata_qid',
  'usgs_event_id', 'gibs_layer_id', 'world_bank_indicator',
] as const

/**
 * Deduplication key for a document, in order of trust: the strongest typed
 * identifier, else canonical URL, else the provider's own stable record id
 * (scoped to that provider — the same record id from two different
 * providers is coincidence, not identity). Title and/or publication date are
 * never used as identity, alone or combined: two records that merely share a
 * normalized title and a publish date are not proven to be the same
 * document, whether they come from the same provider or different ones. If
 * none of the trustworthy identifiers exist, the document's own id is used
 * so it is never accidentally merged with anything else.
 */
function dedupeKey(doc: ResearchDocument): string {
  for (const key of STRONG_IDENTIFIER_KEYS) {
    const value = doc.identifiers[key]
    if (value) return `${key}:${value.toLowerCase()}`
  }
  if (doc.canonicalUrl) return `url:${doc.canonicalUrl.toLowerCase()}`
  if (doc.providerRecordId) return `record:${doc.provider}:${doc.providerRecordId.toLowerCase()}`
  return `unique:${doc.id}`
}

function citationKey(citation: ResearchCitation): string {
  if (citation.canonicalUrl) return `url:${citation.provider}:${citation.canonicalUrl.toLowerCase()}`
  if (citation.providerRecordId) return `record:${citation.provider}:${citation.providerRecordId.toLowerCase()}`
  return `title:${citation.provider}:${citation.title.toLowerCase()}:${citation.publishedAt ?? ''}`
}

/** Removes exact-duplicate citations (same provider + same source) while preserving distinct corroborating ones. */
function dedupeCitations(citations: ResearchCitation[]): ResearchCitation[] {
  const byKey = new Map<string, ResearchCitation>()
  for (const citation of citations) {
    const key = citationKey(citation)
    if (!byKey.has(key)) byKey.set(key, citation)
  }
  return Array.from(byKey.values())
}

export type DeduplicationResult = {
  documents: ResearchDocument[]
  duplicatesRemoved: number
}

function mergeWithinPartition(documents: ResearchDocument[]): DeduplicationResult {
  const byKey = new Map<string, ResearchDocument>()
  let duplicatesRemoved = 0

  for (const doc of documents) {
    const key = dedupeKey(doc)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, doc)
      continue
    }
    duplicatesRemoved += 1
    const merged: ResearchDocument = {
      ...existing,
      citations: dedupeCitations([...existing.citations, ...doc.citations]),
      warnings: Array.from(new Set([...existing.warnings, ...doc.warnings])),
      score: existing.score !== null && doc.score !== null ? Math.max(existing.score, doc.score) : existing.score ?? doc.score,
    }
    byKey.set(key, merged)
  }

  return { documents: Array.from(byKey.values()), duplicatesRemoved }
}

/**
 * Merges duplicate documents across providers while preserving every
 * provider's citation — corroboration is visible, not discarded. A
 * historical capture (`provenance.isHistorical`) and a current document are
 * partitioned apart before any identifier matching and are never merged into
 * one record, even when they otherwise share every identifier: they
 * represent different points in time, and collapsing them would silently
 * erase that distinction (see docs/RESEARCH_ENGINE_SECURITY.md).
 */
export function deduplicateDocuments(documents: ResearchDocument[]): DeduplicationResult {
  const current = documents.filter(doc => !doc.provenance.isHistorical)
  const historical = documents.filter(doc => doc.provenance.isHistorical)

  const currentResult = mergeWithinPartition(current)
  const historicalResult = mergeWithinPartition(historical)

  return {
    documents: [...currentResult.documents, ...historicalResult.documents],
    duplicatesRemoved: currentResult.duplicatesRemoved + historicalResult.duplicatesRemoved,
  }
}
