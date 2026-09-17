'use client'

import { useEffect, useState } from 'react'
import { nativeHlsPlaybackSupported } from '@/lib/terra/liveIntelMedia'
import {
  areaLiveNativeVideoMuted,
  areaLiveYoutubeIframeSrc,
  isAreaLivePlayableVideo,
  type AreaLiveCameraMedia,
} from '@/lib/terra/godsEye/areaLiveMedia'

export function AreaLiveMediaViewer({
  media,
  expanded,
  playVideo,
  onRefresh,
  onSource,
  onGoToLocation,
  onStreetView,
  onSendToCouncil,
  canSendToCouncil,
  onExpand,
  onClose,
}: {
  media: AreaLiveCameraMedia
  expanded: boolean
  playVideo?: boolean
  onRefresh?: () => void
  onSource?: () => void
  onGoToLocation?: () => void
  onStreetView?: () => void
  onSendToCouncil?: () => void
  canSendToCouncil?: boolean
  onExpand: () => void
  onClose: () => void
}) {
  const mediaKey = media.intelItemId ?? media.cameraId ?? media.name
  const [commanderPlay, setCommanderPlay] = useState(false)

  useEffect(() => {
    setCommanderPlay(false)
  }, [mediaKey])

  const youtubeId = media.kind === 'YOUTUBE' ? media.youtubeVideoId : null
  const youtubeSrc = youtubeId ? areaLiveYoutubeIframeSrc(youtubeId, commanderPlay) : null
  const hlsSrc = media.kind === 'HLS' ? media.hlsUrl : null
  const embedSrc = media.kind === 'OFFICIAL_EMBED' ? media.embedUrl : null
  const streamSrc = media.kind === 'CAMERA_STREAM' ? media.streamHref : null
  const showPlayer = media.kind === 'CAMERA_STREAM' || Boolean(playVideo || expanded || commanderPlay)
  const iframeSrc = showPlayer ? (youtubeSrc || embedSrc) : null
  const videoSrc = showPlayer ? (streamSrc || (hlsSrc && nativeHlsPlaybackSupported() ? hlsSrc : null)) : null
  const poster = media.posterUrl
  const nativeMuted = areaLiveNativeVideoMuted(commanderPlay)
  const playable = isAreaLivePlayableVideo(media.kind)
  const label = media.intelItemId ? 'Area Live · Media' : 'Area Live · Camera'

  return (
    <aside
      className={`pointer-events-auto overflow-hidden rounded-xl border border-cyan-300/40 bg-black/78 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl ${
        expanded ? 'w-[min(46rem,72vw)]' : 'w-[min(28rem,86vw)]'
      }`}
      data-testid="area-live-media-viewer"
      data-media-kind={media.kind}
      data-provider={media.provider}
      data-catalog-status={media.catalogStatus}
      data-capture-freshness={media.captureFreshness}
      data-commander-play={commanderPlay ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">{label}</p>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {(media.kind === 'CAMERA_STILL' || media.kind === 'CAMERA_STREAM') && onRefresh ? (
            <button type="button" onClick={onRefresh} data-testid="area-live-refresh" className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 hover:text-cyan-200">
              Refresh
            </button>
          ) : null}
          {onSource ? (
            <button type="button" onClick={onSource} data-testid="area-live-source" className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 hover:text-cyan-200">
              Source
            </button>
          ) : null}
          {onGoToLocation ? (
            <button type="button" onClick={onGoToLocation} data-testid="area-live-go-to-location" className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300 hover:text-emerald-200">
              Go to location
            </button>
          ) : null}
          {onStreetView ? (
            <button type="button" onClick={onStreetView} data-testid="area-live-street-view" className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 hover:text-cyan-100">
              Street View
            </button>
          ) : null}
          {onSendToCouncil ? (
            <button type="button" onClick={onSendToCouncil} disabled={!canSendToCouncil} data-testid="area-live-send-to-council" className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 disabled:border-white/10 disabled:text-slate-600">
              Send to Council
            </button>
          ) : null}
          {playable ? (
            <button
              type="button"
              onClick={() => setCommanderPlay(value => !value)}
              data-testid="area-live-play"
              aria-label={commanderPlay ? 'Mute video' : 'Play video'}
              className="rounded border border-cyan-400/50 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200"
            >
              {commanderPlay ? 'Mute' : 'Play'}
            </button>
          ) : null}
          <button type="button" onClick={onExpand} data-testid="area-live-expand" className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 hover:text-cyan-200">
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button type="button" onClick={onClose} data-testid="area-live-close" className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
      </div>
      <div className="border-t border-white/10">
        {media.kind === 'CAMERA_STILL' && media.stillHref ? (
          // eslint-disable-next-line @next/next/no-img-element -- selected camera still only; not a Next-optimizable asset.
          <img
            src={media.stillHref}
            alt={`${media.name} camera still`}
            className={`w-full bg-black object-contain ${expanded ? 'max-h-[min(28rem,46vh)]' : 'max-h-[min(16rem,32vh)]'}`}
            data-testid="area-live-camera-still"
          />
        ) : media.kind === 'CAMERA_STREAM' && videoSrc ? (
          <video
            key={`${videoSrc}:${commanderPlay ? 'a' : 'm'}`}
            src={videoSrc}
            className={`w-full bg-black object-contain ${expanded ? 'max-h-[min(28rem,46vh)]' : 'max-h-[min(16rem,32vh)]'}`}
            muted={nativeMuted}
            defaultMuted={nativeMuted}
            playsInline
            autoPlay
            controls={commanderPlay}
            data-testid="area-live-camera-stream"
          />
        ) : iframeSrc ? (
          <div className={`relative w-full bg-black ${expanded ? 'h-[min(28rem,46vh)]' : 'h-[min(16rem,32vh)]'}`}>
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
            ) : null}
            <iframe
              key={`${media.intelItemId ?? media.cameraId ?? media.name}:${commanderPlay ? 'a' : 'm'}`}
              title={media.name}
              src={iframeSrc}
              className="relative h-full w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture"
              data-testid={youtubeSrc ? 'area-live-youtube-iframe' : 'area-live-official-embed'}
            />
          </div>
        ) : videoSrc ? (
          <video
            key={`${videoSrc}:${commanderPlay ? 'a' : 'm'}`}
            src={videoSrc}
            className={`w-full bg-black object-contain ${expanded ? 'max-h-[min(28rem,46vh)]' : 'max-h-[min(16rem,32vh)]'}`}
            muted={nativeMuted}
            defaultMuted={nativeMuted}
            playsInline
            autoPlay
            controls={commanderPlay}
            poster={poster ?? undefined}
            data-testid="area-live-hls-video"
          />
        ) : poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster}
            alt=""
            className={`w-full bg-black object-cover ${expanded ? 'max-h-[min(28rem,46vh)]' : 'max-h-[min(16rem,32vh)]'}`}
            data-testid="area-live-poster"
          />
        ) : media.kind === 'OFFICIAL_VIEWER' && media.officialViewerUrl ? (
          <div className="px-2.5 py-3" data-testid="area-live-official-viewer">
            <p className="text-[11px] text-amber-200">No redistributable still. Open the official viewer — Terra will not invent a camera image.</p>
            <a
              href={media.officialViewerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block rounded border border-cyan-400/40 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-cyan-200 hover:border-cyan-300/70"
              data-testid="area-live-open-official-viewer"
            >
              Open official view
            </a>
          </div>
        ) : media.kind === 'POSTER_ONLY' || media.intelItemId ? (
          <p className="px-2.5 py-3 text-[11px] text-slate-400" data-testid="area-live-poster-only">
            No verified playable video. Headline and source only.
          </p>
        ) : (
          <p className="px-2.5 py-3 text-[11px] text-slate-400" data-testid="area-live-unavailable">
            Camera media unavailable. No still is invented.
          </p>
        )}
      </div>
      <div className="space-y-0.5 border-t border-white/10 px-2.5 py-2 font-mono text-[10px] text-slate-400">
        <p className="text-[12px] font-semibold text-slate-100">{media.name}</p>
        {media.englishHeadline && media.englishHeadline !== media.name ? (
          <p data-testid="area-live-english">{media.englishHeadline}</p>
        ) : null}
        <p data-testid="area-live-provider">{media.provider} · {media.agency}</p>
        <p data-testid="area-live-road">{media.road || media.location || 'Location not reported'}</p>
        {media.originalLanguage ? (
          <p data-testid="area-live-language">LANG {media.originalLanguage}</p>
        ) : null}
        {media.latitude != null && media.longitude != null ? (
          <p data-testid="area-live-coordinates">{media.latitude.toFixed(5)}, {media.longitude.toFixed(5)}</p>
        ) : null}
        <p data-testid="area-live-catalog">CATALOG {media.catalogStatus}</p>
        <p data-testid="area-live-capture">CAPTURE {media.captureFreshness}{media.captureTimestamp ? ` · ${media.captureTimestamp}` : ' · UNKNOWN'}</p>
        <p className="text-[9px] uppercase tracking-widest text-slate-500" data-testid="area-live-capture-note">{media.captureNote}</p>
        {media.verificationState ? (
          <p data-testid="area-live-verification">VERIFY {media.verificationState}</p>
        ) : null}
        <p data-testid="area-live-provenance">SOURCE {media.sourceUrl ?? media.officialViewerUrl ?? 'none'}</p>
        <p data-testid="area-live-retrieved">RETRIEVED {media.retrievedAt ?? 'UNKNOWN'}</p>
      </div>
    </aside>
  )
}
