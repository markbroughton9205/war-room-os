import { createNewsOpportunityWorkPacket } from './agents'
import { fetchFederalRegisterDocuments, fetchGdeltSignals } from './connectors'
import type { NewsOpportunityWorkPacket } from './types'

export async function runNewsOpportunityPipeline(input: {
  query: string
  knownFacts?: Record<string, unknown>
  fetchImpl?: typeof fetch
}): Promise<NewsOpportunityWorkPacket> {
  const news = await fetchGdeltSignals(input.query, input.fetchImpl)
  const official = await fetchFederalRegisterDocuments(input.query, input.fetchImpl)
  return createNewsOpportunityWorkPacket({
    signal: news.records[0] ?? null,
    officialSources: official.records,
    sourceText: input.query,
    knownFacts: input.knownFacts,
  })
}

export const NEWS_OPPORTUNITY_PIPELINE_STAGES = [
  'NEWS_SIGNAL',
  'SOURCE_PERMISSION_CHECK',
  'DUPLICATE_CHECK',
  'SOURCE_RELIABILITY',
  'OFFICIAL_SOURCE_CORROBORATION',
  'LEGAL_STATUS_CLASSIFICATION',
  'LAWFUL_PATHWAY_IDENTIFICATION',
  'ELIGIBILITY_ANALYSIS',
  'STACKING_AND_CONFLICT_CHECK',
  'VALUE_ANALYSIS',
  'FRAUD_AND_ABUSE_REVIEW',
  'PROFESSIONAL_ESCALATION',
  'WORK_PACKET',
  'AWAIT_COMMANDER_APPROVAL',
] as const
