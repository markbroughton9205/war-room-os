import type { DivergentProtocolSeat } from './identity'
import { contractFor } from './retrievalContracts'
import type { RetrievedDocument } from './types'

export type ReservationKey = {
  url: string
  storyClusterId: string
  originClusterId: string
}

export type SoftReservationLedger = {
  used: ReservationKey[]
}

export function createReservationLedger(): SoftReservationLedger {
  return { used: [] }
}

export function reservationKeysFor(document: RetrievedDocument): ReservationKey {
  return {
    url: document.canonicalUrl || document.url,
    storyClusterId: document.contentHash,
    originClusterId: document.independentOriginId || document.sourceOriginId || document.publisher,
  }
}

export function isReserved(ledger: SoftReservationLedger, document: RetrievedDocument): boolean {
  const key = reservationKeysFor(document)
  return ledger.used.some(item => item.url === key.url || item.storyClusterId === key.storyClusterId || item.originClusterId === key.originClusterId)
}

export function recordUse(ledger: SoftReservationLedger, document: RetrievedDocument): void {
  ledger.used.push(reservationKeysFor(document))
}

/**
 * Soft source reservation: discovery lanes get a strong novelty penalty for used
 * URL / story cluster / origin cluster. Verification, adversarial review, and
 * synthesis may revisit. No hard global URL mutex.
 */
export function noveltyScore(input: {
  seat: DivergentProtocolSeat
  document: RetrievedDocument
  ledger: SoftReservationLedger
  baseScore: number
}): { score: number; penalized: boolean; forbidden: boolean } {
  const contract = contractFor(input.seat)
  const reserved = isReserved(input.ledger, input.document)
  if (!reserved) return { score: input.baseScore, penalized: false, forbidden: false }
  if (contract.novelty === 'READ_ALL' || contract.novelty === 'MAY_REVISIT') {
    return { score: input.baseScore, penalized: false, forbidden: false }
  }
  return { score: input.baseScore * 0.12, penalized: true, forbidden: false }
}

export function rankWithNovelty(input: {
  seat: DivergentProtocolSeat
  documents: RetrievedDocument[]
  ledger: SoftReservationLedger
}): RetrievedDocument[] {
  return input.documents
    .map(document => ({ document, scored: noveltyScore({ seat: input.seat, document, ledger: input.ledger, baseScore: 1 }) }))
    .sort((a, b) => b.scored.score - a.scored.score)
    .map(row => row.document)
}

export function noHardUrlMutex(documents: RetrievedDocument[], seat: DivergentProtocolSeat): boolean {
  return documents.length >= 0 && (contractFor(seat).novelty !== 'PENALIZE_USED' || contractFor(seat).mayRevisitReservedSources === false)
}
