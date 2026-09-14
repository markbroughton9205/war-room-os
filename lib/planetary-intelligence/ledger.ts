import { createHash } from 'node:crypto'
import type { DivergentProtocolSeat } from './identity'
import type {
  EvidenceEdge,
  EvidenceEdgeRelation,
  LedgerClaim,
  PlanetaryGeography,
  PlanetaryTopic,
  RetrievedDocument,
} from './types'

export type ClaimEvidenceLedger = {
  missionId: string
  claims: LedgerClaim[]
  edges: EvidenceEdge[]
  documents: RetrievedDocument[]
}

export function createLedger(missionId: string): ClaimEvidenceLedger {
  return { missionId, claims: [], edges: [], documents: [] }
}

export function normalizeClaimText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function claimIdFor(missionId: string, normalized: string, laneId: string): string {
  return `claim-${createHash('sha256').update(`${missionId}|${laneId}|${normalized}`).digest('hex').slice(0, 16)}`
}

export function addDocument(ledger: ClaimEvidenceLedger, document: RetrievedDocument): ClaimEvidenceLedger {
  if (ledger.documents.some(item => item.documentId === document.documentId || item.canonicalUrl === document.canonicalUrl && item.contentHash === document.contentHash)) {
    return ledger
  }
  return { ...ledger, documents: [...ledger.documents, document] }
}

export function addClaim(ledger: ClaimEvidenceLedger, input: {
  laneId: string
  agent: DivergentProtocolSeat
  originalClaim: string
  originalLanguage?: string
  topic?: PlanetaryTopic | null
  geography?: PlanetaryGeography | null
  time?: string | null
  confidence?: number
  documentIds?: string[]
  relation?: EvidenceEdgeRelation
}): ClaimEvidenceLedger {
  const normalized = normalizeClaimText(input.originalClaim)
  if (!normalized) return ledger
  const claim: LedgerClaim = {
    claimId: claimIdFor(ledger.missionId, normalized, input.laneId),
    missionId: ledger.missionId,
    laneId: input.laneId,
    agent: input.agent,
    normalizedClaim: normalized,
    originalClaim: input.originalClaim.trim(),
    originalLanguage: input.originalLanguage ?? 'und',
    topic: input.topic ?? null,
    geography: input.geography ?? null,
    time: input.time ?? null,
    confidence: input.confidence ?? 0.4,
    verificationState: 'UNVERIFIED',
    storyClusterId: null,
    independentOriginIds: [],
  }
  const existing = ledger.claims.find(item => item.claimId === claim.claimId)
  const claims = existing ? ledger.claims : [...ledger.claims, claim]
  const edges = [...ledger.edges]
  for (const documentId of input.documentIds ?? []) {
    const edgeId = `edge-${createHash('sha256').update(`${claim.claimId}|${documentId}|${input.relation ?? 'REPORTS'}`).digest('hex').slice(0, 12)}`
    if (!edges.some(edge => edge.edgeId === edgeId)) {
      const document = ledger.documents.find(item => item.documentId === documentId)
      edges.push({
        edgeId,
        missionId: ledger.missionId,
        claimId: claim.claimId,
        documentId,
        relation: input.relation ?? 'REPORTS',
        originId: document?.independentOriginId ?? document?.sourceOriginId ?? null,
      })
    }
  }
  return { ...ledger, claims, edges }
}

export function attachOrigins(ledger: ClaimEvidenceLedger): ClaimEvidenceLedger {
  const claims = ledger.claims.map(claim => {
    const originIds = [...new Set(
      ledger.edges
        .filter(edge => edge.claimId === claim.claimId && edge.originId)
        .map(edge => edge.originId as string),
    )]
    return { ...claim, independentOriginIds: originIds }
  })
  return { ...ledger, claims }
}

export function setVerification(ledger: ClaimEvidenceLedger, claimId: string, state: LedgerClaim['verificationState'], confidence?: number): ClaimEvidenceLedger {
  return {
    ...ledger,
    claims: ledger.claims.map(claim => claim.claimId === claimId
      ? { ...claim, verificationState: state, confidence: confidence ?? claim.confidence }
      : claim),
  }
}

export const LEDGER_ENTITIES = [
  'MISSION',
  'INVESTIGATION_TASK',
  'SOURCE',
  'OUTLET',
  'PUBLISHER',
  'PARENT_COMPANY',
  'SOURCE_ENDPOINT',
  'DOCUMENT',
  'STORY_CLUSTER',
  'STORY_ORIGIN',
  'SYNDICATION_CLUSTER',
  'CLAIM',
  'CLAIM_CLUSTER',
  'EVIDENCE_EDGE',
  'COVERAGE_CELL',
] as const
