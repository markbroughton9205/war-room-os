'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { TERRA_HANDOFF_STORAGE_KEY } from '@/lib/terra/councilHandoff'
import { getMediaPlaybackController } from '@/lib/media/playback/controller'
import { isPlaybackEligible } from '@/lib/media/provenance'
import { getMediaStationById } from '@/lib/media/stationRegistry'
import { TERRA_MEDIA_DEFAULT_SIZE, TERRA_MEDIA_PANEL_ID } from '@/lib/terra/workspace/panelIds'
import {
  buildTerraMediaCouncilHandoff,
  canSendTerraMediaCandidateToCouncil,
  getTerraMediaStore,
  type TerraMediaCandidate,
} from '@/lib/terra/terraMedia'
import { terraMediaStateIsLive } from '@/lib/terra/terraMedia/broadcastState'
import { useTerraWorkspaceLayoutApiOptional } from '@/components/war-room/terra/workspace/TerraWorkspaceLayoutProvider'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="truncate text-right text-slate-200">{value}</dd>
    </div>
  )
}

export function TerraEmergencyReportBody({
  candidate,
  commanderQuestion,
}: {
  candidate: TerraMediaCandidate
  commanderQuestion?: string
}) {
  const workspace = useTerraWorkspaceLayoutApiOptional()
  const live = terraMediaStateIsLive(candidate.mediaState)
  const watchEnabled = Boolean(candidate.watchUrl) && candidate.mediaState !== 'UNAVAILABLE'
  const listenStation = candidate.listenStationId ? getMediaStationById(candidate.listenStationId) : null
  const listenEnabled = isPlaybackEligible(listenStation)
  const sourceEnabled = Boolean(candidate.sourceUrl || candidate.watchUrl)
  const councilEnabled = canSendTerraMediaCandidateToCouncil(candidate)

  const watch = useCallback(() => {
    if (!candidate.watchUrl) return
    window.open(candidate.watchUrl, '_blank', 'noopener,noreferrer')
  }, [candidate.watchUrl])

  const listen = useCallback(() => {
    if (!candidate.listenStationId) return
    const controller = getMediaPlaybackController()
    controller.selectStation(candidate.listenStationId)
    workspace?.store.openOrFocus(TERRA_MEDIA_PANEL_ID, workspace.getViewport(), TERRA_MEDIA_DEFAULT_SIZE)
    controller.playFromCommanderGesture()
  }, [candidate.listenStationId, workspace])

  const openSource = useCallback(() => {
    const href = candidate.sourceUrl ?? candidate.watchUrl
    if (!href) return
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [candidate.sourceUrl, candidate.watchUrl])

  const sendToCouncil = useCallback(() => {
    const payload = buildTerraMediaCouncilHandoff(candidate, commanderQuestion)
    if (!payload) return
    try {
      sessionStorage.setItem(TERRA_HANDOFF_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      return
    }
    window.location.href = '/?terraAnalyze=1'
  }, [candidate, commanderQuestion])

  return (
    <div
      className="space-y-2 px-2 py-2"
      data-testid="terra-emergency-report"
      data-media-state={candidate.mediaState}
      data-event-family={candidate.family}
      data-autoplay="false"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Emergency Report</p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-amber-100">
        {candidate.severity ?? 'SEVERITY NOT REPORTED'}
      </p>
      <p className="text-[13px] font-semibold text-slate-100">{candidate.eventTitle}</p>
      <p className="text-[10px] uppercase tracking-widest text-slate-400">{candidate.eventType}</p>
      <p className="text-[11px] text-slate-300">{candidate.location ?? 'Location not reported'}</p>
      <dl className="space-y-0.5 font-mono text-[10px] text-slate-400">
        <Row label="source" value={candidate.source} />
        <Row label="publisher" value={candidate.publisher} />
        <Row label="status" value={candidate.mediaState} />
        <Row label="availability" value={candidate.availability} />
        <Row label="auth" value={candidate.authRequirement} />
        <Row label="time" value={candidate.timestamp ?? 'not reported'} />
        <Row label="relevance" value={candidate.locationRelevance ?? 'not reported'} />
      </dl>
      <p className="text-[9px] leading-snug text-slate-500" data-testid="terra-media-state-reason">{candidate.mediaStateReason}</p>
      <p className="text-[9px] leading-snug text-slate-600">{candidate.provenance}</p>
      {live ? (
        <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-300" data-testid="terra-media-live-evidence">
          LIVE evidence: {candidate.liveEvidence ?? 'SOURCE_DECLARED_LIVE'}
        </p>
      ) : (
        <p className="text-[9px] uppercase tracking-widest text-slate-500" data-testid="terra-media-not-live">
          Not a verified live broadcast
        </p>
      )}
      <div className="flex flex-wrap gap-1 pt-1">
        <button
          type="button"
          disabled={!watchEnabled}
          onClick={watch}
          className="rounded border border-cyan-300/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-30"
          data-testid="terra-media-watch"
        >
          Watch
        </button>
        <button
          type="button"
          disabled={!listenEnabled}
          onClick={listen}
          className="rounded border border-cyan-300/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-30"
          data-testid="terra-media-listen"
          data-emergency-handoff="listen"
          data-media-play-gate="commander-gesture"
        >
          Listen
        </button>
        <button
          type="button"
          disabled={!sourceEnabled}
          onClick={openSource}
          className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30"
          data-testid="terra-media-open-source"
        >
          Open Source
        </button>
        <button
          type="button"
          disabled={!councilEnabled}
          onClick={sendToCouncil}
          className="rounded border border-cyan-300/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 disabled:opacity-30"
          data-testid="terra-media-send-to-council"
        >
          Send to Council
        </button>
      </div>
    </div>
  )
}

export function TerraEmergencyReportPanel({
  commanderQuestion,
}: {
  commanderQuestion?: string
}) {
  const store = getTerraMediaStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const candidate = snapshot.candidate

  return (
    <div
      className="w-[min(22rem,92vw)] overflow-hidden rounded-b-lg border border-t-0 border-white/15 bg-black/80"
      data-testid="terra-emergency-report-panel"
    >
      {candidate ? (
        <TerraEmergencyReportBody candidate={candidate} commanderQuestion={commanderQuestion} />
      ) : (
        <div className="space-y-2 px-2 py-3" data-testid="terra-emergency-report-idle">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Emergency Report</p>
          <p className="text-[11px] leading-snug text-slate-400">
            Verified Terra events queue here. This panel is not a music player. LISTEN hands verified audio to War Room Media.
          </p>
        </div>
      )}
    </div>
  )
}
