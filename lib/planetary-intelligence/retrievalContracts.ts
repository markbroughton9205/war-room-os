import type { DivergentProtocolSeat } from './identity'
import type { EvidenceClass, SourceClass } from './types'

export type RetrievalContract = {
  seat: DivergentProtocolSeat
  mission: string
  firstPassRetrieval: boolean
  mayRevisitReservedSources: boolean
  prioritize: string[]
  sourceTypes: SourceClass[]
  evidenceTypes: EvidenceClass[]
  novelty: 'PENALIZE_USED' | 'MAY_REVISIT' | 'READ_ALL'
  notes: string[]
}

export const RETRIEVAL_CONTRACTS: Record<DivergentProtocolSeat, RetrievalContract> = {
  PULSAR: {
    seat: 'PULSAR',
    mission: 'DISCOVERY / SIGNALS',
    firstPassRetrieval: true,
    mayRevisitReservedSources: false,
    prioritize: [
      'breaking events',
      'regional reporting',
      'local reporting',
      'weak signals',
      'emerging stories',
      'under-covered regions',
      'live feeds',
      'RSS',
      'regional news',
      'local journalism',
    ],
    sourceTypes: ['JOURNALISM', 'COMMUNITY_SOURCE', 'ALERT_FEED', 'PRIMARY_PUBLIC_SIGNAL'],
    evidenceTypes: ['LOCAL_REPORTING', 'REGIONAL_REPORTING', 'ALERT'],
    novelty: 'PENALIZE_USED',
    notes: ['Maximize discovery breadth. Soft-reserve used URLs/story clusters/origin clusters.'],
  },
  ORION: {
    seat: 'ORION',
    mission: 'SYSTEMS / OPERATIONS',
    firstPassRetrieval: true,
    mayRevisitReservedSources: false,
    prioritize: [
      'technology',
      'infrastructure',
      'energy',
      'transport',
      'engineering',
      'telecommunications',
      'cyber',
      'technical documentation',
      'standards',
      'incident reports',
      'operational consequences',
    ],
    sourceTypes: ['TRADE_SOURCE', 'OFFICIAL_RECORD', 'GOVERNMENT', 'REGULATOR'],
    evidenceTypes: ['TECHNICAL_DOCUMENT', 'PRIMARY_EVIDENCE', 'DATASET'],
    novelty: 'PENALIZE_USED',
    notes: ['Discovery lane. Cannot see PULSAR or NOVA findings during first pass.'],
  },
  NOVA: {
    seat: 'NOVA',
    mission: 'EXPLORATION / LONG TAIL',
    firstPassRetrieval: true,
    mayRevisitReservedSources: false,
    prioritize: [
      'science',
      'economics',
      'academia',
      'research',
      'regional-language reporting',
      'under-covered geography',
      'specialist publications',
      'alternative information paths',
    ],
    sourceTypes: ['SCIENTIFIC_SOURCE', 'ACADEMIC_SOURCE', 'JOURNALISM'],
    evidenceTypes: ['RESEARCH_PAPER', 'LOCAL_REPORTING', 'DATASET'],
    novelty: 'PENALIZE_USED',
    notes: ['NOVA is AUXILIARY_COUNCIL_MEMBER. First-pass exploration is live retrieval, not personality theater.'],
  },
  LUMEN: {
    seat: 'LUMEN',
    mission: 'VERIFICATION',
    firstPassRetrieval: false,
    mayRevisitReservedSources: true,
    prioritize: [
      'primary sources',
      'government records',
      'official statements',
      'regulators',
      'filings',
      'datasets',
      'direct documents',
      'source-of-record evidence',
    ],
    sourceTypes: ['OFFICIAL_RECORD', 'GOVERNMENT', 'REGULATOR'],
    evidenceTypes: ['PRIMARY_EVIDENCE', 'OFFICIAL_STATEMENT', 'DATASET'],
    novelty: 'MAY_REVISIT',
    notes: ['May intentionally revisit evidence already found. Initial lane cannot see other seats\' conclusions.'],
  },
  PHOENIX: {
    seat: 'PHOENIX',
    mission: 'ADVERSARIAL REVIEW',
    firstPassRetrieval: false,
    mayRevisitReservedSources: true,
    prioritize: [
      'contradictions',
      'missing stories',
      'false consensus',
      'disconfirming evidence',
      'source dependence',
      'uncovered geography',
      'alternative causal explanations',
    ],
    sourceTypes: ['JOURNALISM', 'OFFICIAL_RECORD', 'SCIENTIFIC_SOURCE'],
    evidenceTypes: ['PRIMARY_EVIDENCE', 'SECONDARY_EVIDENCE', 'CONTEXTUAL'],
    novelty: 'MAY_REVISIT',
    notes: ['Runs AFTER independent collection and ledger lock. Not a discovery personality.'],
  },
  AURORA: {
    seat: 'AURORA',
    mission: 'SYNTHESIS',
    firstPassRetrieval: false,
    mayRevisitReservedSources: true,
    prioritize: [
      'claims',
      'evidence',
      'origin clusters',
      'verification',
      'coverage',
      'uncertainty',
      'PHOENIX challenges',
      'LUMEN verification',
    ],
    sourceTypes: ['OFFICIAL_RECORD', 'JOURNALISM', 'SCIENTIFIC_SOURCE'],
    evidenceTypes: ['PRIMARY_EVIDENCE', 'SECONDARY_EVIDENCE', 'CONTEXTUAL'],
    novelty: 'READ_ALL',
    notes: [
      'AURORA does not perform first-pass retrieval.',
      'Synthesis starts from clean structured evidence, not from its own prior search anchor.',
    ],
  },
}

export function contractFor(seat: DivergentProtocolSeat): RetrievalContract {
  return RETRIEVAL_CONTRACTS[seat]
}

export function discoverySeatsPreferNovelEvidence(seat: DivergentProtocolSeat): boolean {
  return RETRIEVAL_CONTRACTS[seat].novelty === 'PENALIZE_USED'
}

export function auroraDoesNotFirstPassRetrieve(): boolean {
  return RETRIEVAL_CONTRACTS.AURORA.firstPassRetrieval === false
}

export function phoenixOperatesPostLedger(): boolean {
  return RETRIEVAL_CONTRACTS.PHOENIX.firstPassRetrieval === false
}

export function lumenMayRevisit(): boolean {
  return RETRIEVAL_CONTRACTS.LUMEN.mayRevisitReservedSources
}
