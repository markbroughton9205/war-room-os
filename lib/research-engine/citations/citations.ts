import type { ResearchCitation, ResearchDocument } from '@/lib/research-engine/core/types'

/**
 * Builds a citation strictly from fields already present on the document —
 * never fabricates an author, date, or identifier that the provider did not
 * supply. See docs/RESEARCH_ENGINE_SECURITY.md ("no fabricated citations").
 */
export function buildCitation(doc: ResearchDocument): ResearchCitation {
  const datasetOrSeriesId =
    doc.identifiers.fred_series_id
    ?? doc.identifiers.world_bank_indicator
    ?? doc.identifiers.gibs_layer_id
    ?? null

  return {
    provider: doc.provider,
    title: doc.title,
    canonicalUrl: doc.canonicalUrl,
    providerRecordId: doc.providerRecordId,
    authorOrOrganization: doc.authors[0] ?? doc.organization,
    publishedAt: doc.publishedAt,
    retrievedAt: doc.retrievedAt,
    datasetOrSeriesId,
    identifiers: doc.identifiers,
    captureTimestamp: doc.provenance.isHistorical ? doc.retrievedAt : null,
    licenseOrAccessWarning: doc.license ?? (doc.accessStatus === 'restricted' ? 'Access restricted per source metadata.' : null),
  }
}

export function attachCitations(documents: ResearchDocument[]): ResearchDocument[] {
  return documents.map(doc => ({ ...doc, citations: doc.citations.length > 0 ? doc.citations : [buildCitation(doc)] }))
}
