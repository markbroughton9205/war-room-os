import type { EvidenceOriginType, IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { tokenizeForRelevance, relevanceScore } from '@/lib/intelligence/relevance'

export type ComparisonStatus =
  | 'STILL_SUPPORTED'
  | 'UPDATED'
  | 'CONTRADICTED'
  | 'STALE'
  | 'UNVERIFIED'
  | 'NEW_INFORMATION'

export type ComparedClaim = {
  id: string
  priorClaim: string
  priorOrigin: Extract<EvidenceOriginType, 'KIMI_WAVE' | 'STORED_RESEARCH'> | 'LIVE_WEB'
  status: ComparisonStatus
  liveEvidenceIds: string[]
  notes: string
}

export type OldVsNewComparison = {
  priorClaims: ComparedClaim[]
  newInformation: ComparedClaim[]
  staleCount: number
  contradictedCount: number
  updatedCount: number
  stillSupportedCount: number
  unverifiedCount: number
}

const CONTRADICTION_HINTS = [
  [/\boperational\b/i, /\bdiscontinued|sunset|shut down|deprecated|no longer\b/i],
  [/\bno api\b/i, /\brest api|official api\b/i],
  [/\brequired\b/i, /\bno longer required|removed\b/i],
]

export function compareOldVsNew(args: {
  prior: IntelligenceEvidenceItem[]
  live: IntelligenceEvidenceItem[]
}): OldVsNewComparison {
  const prior = args.prior.filter(item => item.origin_type === 'KIMI_WAVE' || item.origin_type === 'STORED_RESEARCH')
  const live = args.live.filter(item => item.origin_type === 'LIVE_WEB')

  const priorClaims: ComparedClaim[] = prior.map((item, index) => {
    const origin = item.origin_type === 'STORED_RESEARCH' ? 'STORED_RESEARCH' : 'KIMI_WAVE'
    const supporting = live.filter(liveItem => relevanceScore(item.claim || item.title, `${liveItem.title} ${liveItem.claim} ${liveItem.content}`) >= 0.18)
    const contradicted = supporting.some(liveItem => looksContradicted(item, liveItem))
      || (item.contradiction_flags.length > 0 && supporting.length > 0)

    let status: ComparisonStatus
    let notes: string
    if (!live.length) {
      status = item.freshness === 'stale' || item.freshness === 'unknown' || origin === 'KIMI_WAVE' ? 'STALE' : 'UNVERIFIED'
      notes = 'No live evidence this round to revalidate this prior claim. Do not treat it as current.'
    } else if (contradicted) {
      status = 'CONTRADICTED'
      notes = 'Live evidence conflicts with the prior claim.'
    } else if (supporting.length && (item.freshness === 'stale' || origin === 'KIMI_WAVE')) {
      status = 'UPDATED'
      notes = 'Prior intelligence overlaps current live evidence but remains historical until the live source is treated as the current fact.'
    } else if (supporting.length) {
      status = 'STILL_SUPPORTED'
      notes = 'Current live evidence still supports this prior claim.'
    } else if (item.freshness === 'stale' || origin === 'KIMI_WAVE') {
      status = 'STALE'
      notes = 'Prior claim was not corroborated by this round\'s live evidence.'
    } else {
      status = 'UNVERIFIED'
      notes = 'Prior claim lacks current live verification this round.'
    }

    return {
      id: `cmp-${origin}-${index + 1}`,
      priorClaim: (item.claim || item.title).slice(0, 420),
      priorOrigin: origin,
      status,
      liveEvidenceIds: supporting.map(liveItem => liveItem.id).slice(0, 4),
      notes,
    }
  })

  const covered = new Set(priorClaims.flatMap(claim => claim.liveEvidenceIds))
  const newInformation: ComparedClaim[] = live
    .filter(item => !covered.has(item.id) && tokenizeForRelevance(`${item.title} ${item.claim}`).length > 0)
    .slice(0, 8)
    .map((item, index) => ({
      id: `cmp-new-${index + 1}`,
      priorClaim: (item.claim || item.title).slice(0, 420),
      priorOrigin: 'LIVE_WEB',
      status: 'NEW_INFORMATION' as const,
      liveEvidenceIds: [item.id],
      notes: 'Live evidence with no matching prior Kimi/stored claim.',
    }))

  return {
    priorClaims,
    newInformation,
    staleCount: priorClaims.filter(claim => claim.status === 'STALE').length,
    contradictedCount: priorClaims.filter(claim => claim.status === 'CONTRADICTED').length,
    updatedCount: priorClaims.filter(claim => claim.status === 'UPDATED').length,
    stillSupportedCount: priorClaims.filter(claim => claim.status === 'STILL_SUPPORTED').length,
    unverifiedCount: priorClaims.filter(claim => claim.status === 'UNVERIFIED').length,
  }
}

function looksContradicted(prior: IntelligenceEvidenceItem, live: IntelligenceEvidenceItem): boolean {
  const priorText = `${prior.claim} ${prior.content}`
  const liveText = `${live.claim} ${live.content}`
  for (const [left, right] of CONTRADICTION_HINTS) {
    if (left.test(priorText) && right.test(liveText)) return true
    if (right.test(priorText) && left.test(liveText)) return true
  }
  return false
}
