import { createHash } from 'node:crypto'
import { FIRST_PASS_DISCOVERY_SEATS, type DivergentProtocolSeat } from './identity'
import type { LanePacket, LedgerClaim, RetrievedDocument } from './types'

export type BlindStore = {
  missionId: string
  locked: boolean
  packets: Map<string, LanePacket>
}

export function createBlindStore(missionId: string): BlindStore {
  return { missionId, locked: false, packets: new Map() }
}

function packetFingerprint(input: {
  missionId: string
  taskId: string
  laneId: string
  seat: DivergentProtocolSeat
  timestamp: string
  queries: string[]
  documents: RetrievedDocument[]
  claims: LedgerClaim[]
}): string {
  return createHash('sha256').update(JSON.stringify({
    missionId: input.missionId,
    taskId: input.taskId,
    laneId: input.laneId,
    seat: input.seat,
    timestamp: input.timestamp,
    queries: input.queries,
    documentIds: input.documents.map(doc => doc.documentId),
    urls: input.documents.map(doc => doc.canonicalUrl),
    claimIds: input.claims.map(claim => claim.claimId),
  })).digest('hex')
}

export function commitLanePacket(store: BlindStore, packet: Omit<LanePacket, 'hash' | 'immutable' | 'lockedAt'>): LanePacket {
  if (store.packets.has(packet.laneId)) {
    throw new Error(`Lane ${packet.laneId} already committed. First-pass packets are immutable.`)
  }
  const hash = packetFingerprint(packet)
  const committed: LanePacket = {
    ...packet,
    hash,
    immutable: true,
    lockedAt: packet.timestamp,
  }
  store.packets.set(packet.laneId, committed)
  return committed
}

export function lockFirstPass(store: BlindStore): void {
  store.locked = true
}

export function isImmutable(packet: LanePacket): boolean {
  return packet.immutable === true && Boolean(packet.hash) && Boolean(packet.lockedAt)
}

export function mutatePacketRejected(packet: LanePacket, mutate: (next: LanePacket) => LanePacket): { rejected: true; original: LanePacket } {
  const attempted = mutate({ ...packet, documents: [...packet.documents] })
  if (packet.immutable) {
    return { rejected: true, original: packet }
  }
  return { rejected: true, original: attempted }
}

export type VisibleContext = {
  otherLaneQueries: string[]
  otherLaneClaims: string[]
  otherLaneEvidenceText: string[]
  otherLaneConclusions: string[]
}

export function visibleContextForLane(store: BlindStore, laneId: string, phase: 'FIRST_PASS' | 'POST_LOCK'): VisibleContext {
  if (phase === 'FIRST_PASS' || !store.locked) {
    return {
      otherLaneQueries: [],
      otherLaneClaims: [],
      otherLaneEvidenceText: [],
      otherLaneConclusions: [],
    }
  }
  const others = [...store.packets.values()].filter(packet => packet.laneId !== laneId)
  return {
    otherLaneQueries: others.flatMap(packet => packet.queries),
    otherLaneClaims: others.flatMap(packet => packet.claims.map(claim => claim.normalizedClaim)),
    otherLaneEvidenceText: others.flatMap(packet => packet.documents.map(doc => doc.originalText)),
    otherLaneConclusions: others.flatMap(packet => packet.claims.map(claim => claim.originalClaim)),
  }
}

export function assertNoCrossLaneLeak(prompt: string, others: VisibleContext): { pass: boolean; leaks: string[] } {
  const leaks: string[] = []
  const hay = prompt.toLowerCase()
  for (const query of others.otherLaneQueries) {
    if (query && hay.includes(query.toLowerCase()) && query.length > 24) leaks.push('other_lane_query')
  }
  for (const claim of others.otherLaneClaims) {
    if (claim && hay.includes(claim.toLowerCase()) && claim.length > 24) leaks.push('other_lane_claim')
  }
  for (const evidence of others.otherLaneEvidenceText) {
    const snippet = evidence.slice(0, 48).toLowerCase()
    if (snippet.length >= 24 && hay.includes(snippet)) leaks.push('other_lane_evidence')
  }
  for (const conclusion of others.otherLaneConclusions) {
    if (conclusion && hay.includes(conclusion.toLowerCase()) && conclusion.length > 24) leaks.push('other_lane_conclusion')
  }
  return { pass: leaks.length === 0, leaks: [...new Set(leaks)] }
}

export function firstPassSeat(seat: DivergentProtocolSeat): boolean {
  return (FIRST_PASS_DISCOVERY_SEATS as readonly string[]).includes(seat)
}

export function crossVerificationAllowed(store: BlindStore): boolean {
  return store.locked === true
}
