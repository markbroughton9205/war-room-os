'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  canRetainTrafficCameraFrame,
  radarCameraDeltaMs,
  type TerraTrafficCamera,
  type TerraTrafficCameraFreshness,
} from '@/lib/terra/trafficCameraContract'
import type { RadarActiveDetails } from '@/lib/terra/weather'

export type TerraTrafficCamPlayerMode = 'COMPACT' | 'FULL' | 'MINIMIZED'

/** The player reads the same radar truth object the radar panel renders — no second model. */
export type TerraTrafficCamRadar = RadarActiveDetails

function ageLabel(timestamp: string | null, nowMs: number): string {
  if (!timestamp) return 'UNKNOWN'
  const timestampMs = Date.parse(timestamp)
  if (!Number.isFinite(timestampMs)) return 'UNKNOWN'
  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000))
  if (seconds < 60) return `${seconds} sec ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} hr ago`
}

function frameUrl(url: string, nonce: number): string {
  if (!nonce) return url
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}_terra_frame=${nonce}`
}

function deltaLabel(deltaMs: number | null): string {
  if (deltaMs === null) return 'UNKNOWN'
  const sign = deltaMs >= 0 ? '+' : '−'
  const seconds = Math.round(Math.abs(deltaMs) / 1000)
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${sign}${minutes}m${String(remaining).padStart(2, '0')}s`
}

function truthCopy(state: TerraTrafficCameraFreshness): string {
  if (state === 'OFFLINE') return 'CAMERA OFFLINE'
  if (state === 'NO_VIDEO') return 'NO VIDEO · Provider exposes metadata or an official page only'
  if (state === 'AUTH_REQUIRED') return 'AUTH REQUIRED · Provider authorization needed'
  if (state === 'LICENSE_RESTRICTED') return 'LICENSE RESTRICTED · Direct display is not permitted'
  if (state === 'RATE_LIMITED') return 'RATE LIMITED · Provider throttled this request; no current frame'
  if (state === 'NO_DATA') return 'NO DATA · Provider is wired here but returned no camera data'
  if (state === 'NO_COVERAGE') return 'NO COVERAGE · No wired provider covers this location'
  if (state === 'STALE') return 'STALE · The latest reported frame is older than expected'
  if (state === 'UNKNOWN') return 'UNKNOWN · Provider did not report a frame timestamp'
  return state
}

export function TerraTrafficCamPlayer({
  camera,
  radar,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onSelect,
  onSource,
  onSendToCouncil,
  onClose,
}: {
  camera: TerraTrafficCamera
  radar: TerraTrafficCamRadar
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  onSelect?: () => void
  onSource: () => void
  onSendToCouncil: () => void
  onClose: () => void
}) {
  const cameraKey = `${camera.providerId}:${camera.id}`
  const [mode, setMode] = useState<TerraTrafficCamPlayerMode>('COMPACT')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [frameNonce, setFrameNonce] = useState(0)
  const [frameFailures, setFrameFailures] = useState(0)
  const [runtimeFreshness, setRuntimeFreshness] = useState<TerraTrafficCameraFreshness>(camera.freshness)
  const [lastGoodUrl, setLastGoodUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const reset = window.setTimeout(() => {
      setMode('COMPACT')
      setAutoRefresh(true)
      setFrameNonce(0)
      setFrameFailures(0)
      setRuntimeFreshness(camera.freshness)
      setLastGoodUrl(null)
      setFailedUrl(null)
    }, 0)
    return () => window.clearTimeout(reset)
  }, [cameraKey, camera.freshness])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const refreshSeconds = Math.max(20, camera.expectedRefreshSeconds ?? 60)
  useEffect(() => {
    if (camera.transport !== 'SNAPSHOT' || !autoRefresh || frameFailures >= 3 || !camera.mediaUrl) return
    const timer = window.setInterval(() => setFrameNonce(value => value + 1), refreshSeconds * 1_000)
    return () => window.clearInterval(timer)
  }, [camera.transport, camera.mediaUrl, autoRefresh, frameFailures, refreshSeconds, cameraKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !camera.mediaUrl || (camera.transport !== 'HLS' && camera.transport !== 'DASH')) return
    let destroyed = false
    let cleanup: () => void = () => {}
    const attach = async () => {
      try {
        if (camera.transport === 'HLS') {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = camera.mediaUrl as string
            return
          }
          const hlsModule = await import('hls.js')
          if (destroyed || !hlsModule.default.isSupported()) return
          const hls = new hlsModule.default({ enableWorker: true, maxBufferLength: 30 })
          hls.loadSource(camera.mediaUrl as string)
          hls.attachMedia(video)
          cleanup = () => hls.destroy()
          return
        }
        const dashjs = await import('dashjs')
        if (destroyed) return
        const player = dashjs.MediaPlayer().create()
        player.initialize(video, camera.mediaUrl as string, false)
        cleanup = () => player.reset()
      } catch {
        if (!destroyed) setRuntimeFreshness('OFFLINE')
      }
    }
    void attach()
    return () => {
      destroyed = true
      cleanup()
      video.removeAttribute('src')
      video.load()
    }
  }, [camera.transport, camera.mediaUrl, cameraKey])

  const requestedFrameUrl = camera.mediaUrl ? frameUrl(camera.mediaUrl, frameNonce) : null
  const retainLastGood = canRetainTrafficCameraFrame(camera)
  const displayedFrameUrl = requestedFrameUrl === failedUrl && retainLastGood && lastGoodUrl ? lastGoodUrl : requestedFrameUrl
  const deltaMs = radarCameraDeltaMs(radar.frameAt, camera.observedAt)
  const isVideo = camera.transport === 'HLS' || camera.transport === 'DASH'
  const canDisplay = Boolean(camera.mediaUrl)
    && camera.freshness !== 'LICENSE_RESTRICTED'
    && camera.freshness !== 'AUTH_REQUIRED'
    && camera.freshness !== 'RATE_LIMITED'
    && camera.freshness !== 'NO_DATA'
    && camera.freshness !== 'NO_COVERAGE'
  const panelWidth = mode === 'FULL' ? 'w-[min(48rem,78vw)]' : 'w-[min(30rem,88vw)]'
  const mediaHeight = mode === 'FULL' ? 'max-h-[min(30rem,50vh)]' : 'max-h-[min(17rem,32vh)]'
  const frameAge = ageLabel(camera.observedAt, nowMs)
  const syncRows = useMemo(() => ({
    radar: radar.frameAt
      ? `${radar.frameTime.utc}${radar.frameTime.local ? ` · ${radar.frameTime.local} ${radar.frameTime.localZone ?? 'local'}` : ''}`
      : radar.status,
    camera: camera.observedAt ? camera.observedAt.replace('.000Z', 'Z') : runtimeFreshness,
    delta: radar.frameAt && camera.observedAt ? deltaLabel(deltaMs) : 'UNKNOWN',
  }), [radar.frameAt, radar.frameTime, radar.status, camera.observedAt, runtimeFreshness, deltaMs])

  if (mode === 'MINIMIZED') {
    return (
      <aside className="pointer-events-auto w-[min(22rem,80vw)] rounded-xl border border-cyan-300/40 bg-black/85 p-2 shadow-2xl backdrop-blur-xl" data-testid="terra_traffic_cam_player" data-player-mode="MINIMIZED">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-widest text-cyan-200">Traffic Cam · {camera.name}</p>
          <span className="font-mono text-[9px] text-slate-400">{runtimeFreshness}</span>
          <button type="button" onClick={() => setMode('COMPACT')} className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase text-cyan-200" data-testid="terra-traffic-cam-restore">Restore</button>
          <button type="button" onClick={onClose} className="text-[10px] text-slate-400">Close</button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`pointer-events-auto overflow-hidden rounded-xl border border-cyan-300/40 bg-black/85 shadow-[0_20px_64px_rgba(0,0,0,0.62)] backdrop-blur-xl ${panelWidth}`}
      data-testid="terra_traffic_cam_player"
      data-player-mode={mode}
      data-camera-id={camera.id}
      data-camera-transport={camera.transport}
      data-camera-freshness={runtimeFreshness}
      data-radar-status={radar.status}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-cyan-200">Traffic Cam</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMode(mode === 'FULL' ? 'COMPACT' : 'FULL')} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300" data-testid="terra-traffic-cam-expand">{mode === 'FULL' ? 'Compact' : 'Expand'}</button>
          <button type="button" onClick={() => setMode('MINIMIZED')} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300" data-testid="terra-traffic-cam-minimize">Minimize</button>
          <button type="button" onClick={onClose} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-400" data-testid="terra-traffic-cam-close">Close</button>
        </div>
      </div>

      <div className="border-t border-white/10 bg-black">
        {canDisplay && camera.transport === 'SNAPSHOT' && displayedFrameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- selected provider still; media is policy-gated.
          <img
            key={displayedFrameUrl}
            src={displayedFrameUrl}
            alt={`${camera.name} current traffic-camera frame`}
            className={`w-full object-contain ${mediaHeight}`}
            onLoad={() => {
              if (displayedFrameUrl !== requestedFrameUrl) return
              setLastGoodUrl(displayedFrameUrl)
              setFailedUrl(null)
              setFrameFailures(0)
              setRuntimeFreshness(camera.freshness === 'UNKNOWN' ? 'UNKNOWN' : camera.freshness)
            }}
            onError={() => {
              setFailedUrl(requestedFrameUrl)
              setFrameFailures(value => value + 1)
              setRuntimeFreshness(retainLastGood && lastGoodUrl ? 'STALE' : 'OFFLINE')
            }}
            data-testid="terra-traffic-cam-snapshot"
          />
        ) : canDisplay && camera.transport === 'MJPEG' && camera.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- browser-compatible lawful MJPEG.
          <img src={camera.mediaUrl} alt={`${camera.name} MJPEG traffic camera`} className={`w-full object-contain ${mediaHeight}`} data-testid="terra-traffic-cam-mjpeg" />
        ) : canDisplay && isVideo ? (
          <video ref={videoRef} controls muted playsInline className={`w-full ${mediaHeight}`} data-testid={`terra-traffic-cam-${camera.transport.toLowerCase()}`} />
        ) : canDisplay && camera.transport === 'EMBED' && camera.mediaUrl ? (
          <iframe title={camera.name} src={camera.mediaUrl} className={`w-full border-0 ${mode === 'FULL' ? 'h-[min(30rem,50vh)]' : 'h-[min(17rem,32vh)]'}`} allow="fullscreen; picture-in-picture" data-testid="terra-traffic-cam-embed" />
        ) : (
          <div className="px-3 py-8 text-center" data-testid="terra-traffic-cam-truth-state">
            <p className="text-[12px] font-bold uppercase tracking-widest text-amber-200">{truthCopy(runtimeFreshness)}</p>
            {camera.observedAt ? <p className="mt-1 text-[10px] text-slate-400">Last successful frame: {frameAge}</p> : null}
          </div>
        )}
      </div>

      <div className="space-y-0.5 border-t border-white/10 px-2.5 py-2 font-mono text-[10px] text-slate-400">
        <p className="text-[12px] font-semibold text-slate-100" data-testid="terra-traffic-cam-name">{camera.name} · {camera.id}</p>
        <p data-testid="terra-traffic-cam-operator">OPERATOR {camera.operator}</p>
        <p>{camera.road ?? camera.jurisdiction ?? `${camera.latitude.toFixed(5)}, ${camera.longitude.toFixed(5)}`}</p>
        <p data-testid="terra-traffic-cam-freshness">FRESHNESS {runtimeFreshness} · {frameAge}</p>
        <p data-testid="terra-traffic-cam-frame-time">LAST FRAME {camera.observedAt ?? 'UNKNOWN'}</p>
        <p>EXPECTED REFRESH {camera.expectedRefreshSeconds ? `${camera.expectedRefreshSeconds}s` : 'UNKNOWN'}</p>
        <p data-testid="terra-traffic-cam-source">SOURCE {camera.sourceUrl ?? 'UNKNOWN'}</p>
        <p>ATTRIBUTION {camera.attribution}</p>
      </div>

      <div
        className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-white/10 px-2.5 py-2 font-mono text-[10px]"
        data-testid="terra-traffic-cam-radar-sync"
        data-radar-echo={radar.echoState}
      >
        <span className="text-slate-500">RADAR</span><span className="text-slate-200" data-testid="terra-traffic-cam-radar-time">{syncRows.radar} · {radar.ageLabel}</span>
        <span className="text-slate-500">CAM</span><span className="text-slate-200">{syncRows.camera} · {frameAge}</span>
        <span className="text-slate-500">Δ</span><span className="text-cyan-200" data-testid="terra-traffic-cam-radar-delta">{syncRows.delta}</span>
        <span className="text-slate-500">RADAR STATUS</span><span>{radar.status} · {radar.statusReason}</span>
        <span className="text-slate-500">PRODUCT</span><span>{radar.provider} · {radar.product}</span>
        <span className="text-slate-500">COVERAGE</span><span>{radar.coverageFit} · {radar.coverageLabel}{radar.quorumLabel ? ` · ${radar.quorumLabel}` : ''}</span>
        <span className="text-slate-500">UPDATE</span><span>every {radar.expectedUpdateSeconds}s</span>
        <span className="text-slate-500">PRECIP</span><span data-testid="terra-traffic-cam-radar-echo">{radar.echoLabel}</span>
        <span className="text-slate-500">LEGEND</span><span>{radar.legendSummary}</span>
        <span className="text-slate-500">ATTRIBUTION</span><span>{radar.attribution}</span>
      </div>

      <div className="flex flex-wrap gap-1 border-t border-white/10 px-2.5 py-2">
        {camera.transport === 'SNAPSHOT' ? (
          <>
            <button type="button" onClick={() => setAutoRefresh(value => !value)} className="rounded border border-cyan-300/35 px-1.5 py-0.5 text-[9px] uppercase text-cyan-200" data-testid="terra-traffic-cam-auto">{autoRefresh ? 'Pause refresh' : 'Auto refresh'}</button>
            <button type="button" onClick={() => setFrameNonce(value => value + 1)} className="rounded border border-cyan-300/35 px-1.5 py-0.5 text-[9px] uppercase text-cyan-200" data-testid="terra-traffic-cam-refresh">Refresh</button>
          </>
        ) : null}
        <button type="button" disabled={!hasPrevious} onClick={onPrevious} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300 disabled:opacity-30">&lt; Cam</button>
        <button type="button" disabled={!hasNext} onClick={onNext} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300 disabled:opacity-30">Cam &gt;</button>
        {onSelect ? <button type="button" onClick={onSelect} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300">Map</button> : null}
        {isVideo ? <button type="button" onClick={() => { void videoRef.current?.requestFullscreen?.() }} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300">Fullscreen</button> : null}
        <button type="button" onClick={onSource} disabled={!camera.sourceUrl} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase text-slate-300 disabled:opacity-30">Open source</button>
        <button type="button" onClick={onSendToCouncil} className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-200" data-testid="terra-traffic-cam-council">Send to Council / Grok</button>
      </div>
    </aside>
  )
}
