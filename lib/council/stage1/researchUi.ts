/**
 * Honest research HUD state from a Council Research report. Client-safe (no server imports).
 * Only sources that are URL-backed and live/cached count as accepted; historical-pattern and
 * unverified entries are shown as considered-but-not-counted.
 */
import type { ResearchReport } from '@/lib/council-research/types'

export type HonestResearchUi = {
  mode: 'unavailable' | 'partial' | 'verified'
  sourcesCount: number
  label: string
  accepted: number
  considered: number
  rejected: number
}

export function researchUiFromReport(report: Pick<ResearchReport, 'sources' | 'sourcesUnavailable' | 'unknowns'>): HonestResearchUi {
  const considered = report.sources.length
  const acceptedSources = report.sources.filter(s =>
    Boolean(s.url) && /^https?:\/\//i.test(s.url ?? '') && (s.evidenceLabel === 'LIVE_SIGNAL_BACKED' || s.evidenceLabel === 'CACHED'),
  )
  const accepted = acceptedSources.length
  const rejected = considered - accepted
  const live = acceptedSources.filter(s => s.evidenceLabel === 'LIVE_SIGNAL_BACKED').length
  const tail = rejected > 0 ? `; ${rejected} not counted (no URL, historical or unverified)` : ''
  if (report.sourcesUnavailable || accepted === 0) {
    return { mode: 'unavailable', sourcesCount: 0, accepted: 0, considered, rejected, label: `Research unavailable — 0 accepted of ${considered} considered${tail}` }
  }
  if (live >= 2 && report.unknowns.length === 0) {
    return { mode: 'verified', sourcesCount: accepted, accepted, considered, rejected, label: `Corroborated — ${accepted} accepted of ${considered} considered${tail}` }
  }
  return { mode: 'partial', sourcesCount: accepted, accepted, considered, rejected, label: `Research partial — ${accepted} accepted of ${considered} considered${tail}` }
}
