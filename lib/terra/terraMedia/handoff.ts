import { TERRA_HANDOFF_ACTION, type TerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import type { TerraMediaCandidate } from './types'

export function canSendTerraMediaCandidateToCouncil(candidate: TerraMediaCandidate | null | undefined): boolean {
  if (!candidate) return false
  return Boolean(candidate.sourceUrl || candidate.watchUrl || candidate.location || candidate.eventTitle)
}

export function buildTerraMediaCouncilHandoff(candidate: TerraMediaCandidate, commanderPrompt?: string): TerraCouncilHandoffPayload | null {
  if (!canSendTerraMediaCandidateToCouncil(candidate)) return null
  const handedOffAt = new Date().toISOString()
  return {
    action: TERRA_HANDOFF_ACTION,
    commanderPrompt: commanderPrompt?.trim() || 'Preserve this Terra Media Emergency Report as Observed Data only. Do not invent a live stream or unobserved fact.',
    lineage: {
      objectId: candidate.eventId,
      layer: 'intelligence_events',
      type: candidate.eventType,
      title: candidate.eventTitle,
      provider: candidate.source,
      evidenceId: candidate.id,
      sourceUrl: candidate.sourceUrl ?? candidate.watchUrl,
      latitude: null,
      longitude: null,
      coordinateOrigin: null,
      freshness: candidate.mediaState === 'LIVE' ? 'LIVE' : candidate.mediaState === 'RECENT' ? 'RECENT' : candidate.mediaState === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'STALE',
      observedAt: candidate.timestamp,
      receivedAt: candidate.queuedAt,
      handedOffAt,
      sourceFamily: candidate.family,
      country: null,
      region: candidate.location,
      jurisdiction: candidate.publisher,
      commanderAction: TERRA_HANDOFF_ACTION,
    },
    observedFacts: [
      `TERRA MEDIA EMERGENCY REPORT`,
      `EVENT: ${candidate.eventTitle}`,
      `TYPE: ${candidate.eventType}`,
      `FAMILY: ${candidate.family}`,
      `SEVERITY: ${candidate.severity ?? 'not reported'}`,
      `LOCATION: ${candidate.location ?? 'not reported'}`,
      `SOURCE: ${candidate.source}`,
      `PUBLISHER: ${candidate.publisher}`,
      `MEDIA STATE: ${candidate.mediaState}`,
      `MEDIA STATE REASON: ${candidate.mediaStateReason}`,
      `LIVE EVIDENCE: ${candidate.liveEvidence ?? 'none'}`,
      `AVAILABILITY: ${candidate.availability}`,
      `AUTH: ${candidate.authRequirement}`,
      `SOURCE URL: ${candidate.sourceUrl ?? 'none'}`,
      `WATCH URL: ${candidate.watchUrl ?? 'none'}`,
      `AUTOPLAY: false`,
      candidate.provenance,
    ].join('\n'),
  }
}
