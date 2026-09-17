'use client'

import { useMediaPlayback } from './MediaPlaybackProvider'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[10px]">
      <dt className="uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  )
}

export function SourceInfo() {
  const { state } = useMediaPlayback()
  const source = state.source
  const station = state.station

  if (!state.sourceInfoOpen) return null

  return (
    <section className="rounded-xl border border-cyan-400/20 bg-black/40 p-3" data-testid="media-source-info">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">Station Info</h3>
      {!source || !station ? (
        <p className="text-[11px] text-slate-500">Select a station to inspect provenance.</p>
      ) : (
        <dl className="space-y-1.5">
          <Row label="Provider" value={source.provider} />
          <Row label="Region" value={source.region} />
          <Row label="Playback type" value={source.playbackType} />
          <Row label="Source class" value={source.sourceClass} />
          <Row label="Verification" value={source.verificationState} />
          <Row label="Last verified" value={source.lastVerifiedAt ?? 'never'} />
          <Row label="Why surfaced" value={station && state.surfaceReason ? state.surfaceReason : 'not recorded'} />
          <Row label="Homepage" value={source.homepage ?? 'not recorded'} />
          <Row label="Listen page" value={source.listenPage ?? 'not recorded'} />
          <Row label="Attribution" value={source.attribution ?? 'not recorded'} />
          <Row label="Stream URL" value={source.streamUrlRecorded ? 'recorded' : 'not recorded'} />
          {source.codePresentIsNotVerified ? (
            <p className="pt-1 text-[10px] text-amber-300">CODE_PRESENT is not VERIFIED. Playback stays blocked.</p>
          ) : null}
          <p className="pt-1 text-[10px] leading-relaxed text-slate-500">{station.notes}</p>
        </dl>
      )}
    </section>
  )
}
