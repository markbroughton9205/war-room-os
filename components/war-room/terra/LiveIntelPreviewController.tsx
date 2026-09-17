'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import {
  mediaPreviewIsRenderable,
  nativeHlsPlaybackSupported,
  resolveMediaPreview,
  youtubeMuteEmbedUrl,
  youtubeUnmuteEmbedUrl,
  type TerraLiveIntelMediaPreview,
} from '@/lib/terra/liveIntelMedia'

type PreviewMode = 'muted' | 'inspect'

type PreviewOwner = {
  itemId: string
  mount: HTMLElement
  mode: PreviewMode
  preview: TerraLiveIntelMediaPreview
  title: string
}

type LiveIntelPreviewApi = {
  activeId: string | null
  reducedMotion: boolean
  requestPreview: (input: {
    item: TerraLiveIntelItem
    mount: HTMLElement
    mode?: PreviewMode
  }) => void
  releasePreview: (itemId: string) => void
  teardown: () => void
}

const LiveIntelPreviewContext = createContext<LiveIntelPreviewApi | null>(null)

const TEARDOWN_MS = 90

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resetVideo(video: HTMLVideoElement | null) {
  if (!video) return
  video.pause()
  video.removeAttribute('src')
  video.srcObject = null
  video.load()
}

export function LiveIntelPreviewProvider({
  children,
  scrollRoot,
}: {
  children: ReactNode
  scrollRoot?: HTMLElement | null
}) {
  const [owner, setOwner] = useState<PreviewOwner | null>(null)
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion)
  const ownerRef = useRef<PreviewOwner | null>(null)
  const teardownTimerRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const cancelScheduled = useCallback(() => {
    if (teardownTimerRef.current != null) {
      window.clearTimeout(teardownTimerRef.current)
      teardownTimerRef.current = null
    }
  }, [])

  const teardownNow = useCallback(() => {
    cancelScheduled()
    resetVideo(videoRef.current)
    ownerRef.current = null
    setOwner(null)
  }, [cancelScheduled])

  const scheduleTeardown = useCallback(() => {
    cancelScheduled()
    teardownTimerRef.current = window.setTimeout(() => {
      teardownTimerRef.current = null
      resetVideo(videoRef.current)
      ownerRef.current = null
      setOwner(null)
    }, TEARDOWN_MS)
  }, [cancelScheduled])

  useEffect(() => {
    ownerRef.current = owner
  }, [owner])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      const reduce = media.matches
      setReducedMotion(reduce)
      if (reduce) teardownNow()
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [teardownNow])

  useEffect(() => () => teardownNow(), [teardownNow])

  useEffect(() => {
    if (!owner?.mount || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0]
      if (entry && entry.intersectionRatio < 0.5) teardownNow()
    }, { threshold: [0, 0.5, 1], root: scrollRoot ?? null })
    observer.observe(owner.mount)
    return () => observer.disconnect()
  }, [owner, scrollRoot, teardownNow])

  const requestPreview = useCallback<LiveIntelPreviewApi['requestPreview']>(({ item, mount, mode = 'muted' }) => {
    const preview = resolveMediaPreview(item.mediaPreview)
    if (!mediaPreviewIsRenderable(preview)) return
    if (mode === 'muted' && readReducedMotion()) return
    if (preview.type === 'HLS_MUTE' && !nativeHlsPlaybackSupported()) return
    cancelScheduled()
    const next: PreviewOwner = {
      itemId: item.id,
      mount,
      mode,
      preview,
      title: item.originalHeadline || item.headline,
    }
    if (ownerRef.current && ownerRef.current.itemId !== item.id) {
      resetVideo(videoRef.current)
    }
    ownerRef.current = next
    setOwner(next)
  }, [cancelScheduled])

  const releasePreview = useCallback<LiveIntelPreviewApi['releasePreview']>(itemId => {
    if (ownerRef.current?.itemId !== itemId) return
    scheduleTeardown()
  }, [scheduleTeardown])

  const api = useMemo<LiveIntelPreviewApi>(() => ({
    activeId: owner?.itemId ?? null,
    reducedMotion,
    requestPreview,
    releasePreview,
    teardown: teardownNow,
  }), [owner?.itemId, reducedMotion, requestPreview, releasePreview, teardownNow])

  const iframeSrc = owner && owner.preview.type === 'YT_MUTE_EMBED' && owner.preview.youtubeVideoId
    ? (owner.mode === 'inspect' ? youtubeUnmuteEmbedUrl(owner.preview.youtubeVideoId) : youtubeMuteEmbedUrl(owner.preview.youtubeVideoId))
    : owner && owner.preview.type === 'OFFICIAL_EMBED'
      ? owner.preview.previewUrl ?? null
      : null

  const videoSrc = owner && owner.preview.type === 'HLS_MUTE' && owner.preview.previewUrl && nativeHlsPlaybackSupported()
    ? owner.preview.previewUrl
    : null

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!videoSrc) {
      resetVideo(video)
      return
    }
    video.muted = owner?.mode !== 'inspect'
    video.playsInline = true
    video.autoplay = true
    video.src = videoSrc
    void video.play().catch(() => {
      /* native HLS refused — poster remains underneath */
    })
  }, [videoSrc, owner?.mode])

  const player = owner && (iframeSrc || videoSrc)
    ? createPortal(
      <div className="absolute inset-0 overflow-hidden bg-black" data-testid="terra-live-intel-shared-preview">
        {iframeSrc ? (
          <iframe
            key={`${owner.itemId}:${owner.mode}:${iframeSrc}`}
            title={`Preview video ${owner.title}`}
            src={iframeSrc}
            className="h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            data-testid="terra-live-intel-youtube-iframe"
          />
        ) : (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted={owner.mode !== 'inspect'}
            playsInline
            autoPlay
            controls={owner.mode === 'inspect'}
            data-testid="terra-live-intel-html-video"
          />
        )}
      </div>,
      owner.mount,
    )
    : null

  return (
    <LiveIntelPreviewContext.Provider value={api}>
      {children}
      {player}
    </LiveIntelPreviewContext.Provider>
  )
}

export function useLiveIntelPreview(): LiveIntelPreviewApi {
  const ctx = useContext(LiveIntelPreviewContext)
  if (!ctx) {
    return {
      activeId: null,
      reducedMotion: false,
      requestPreview: () => {},
      releasePreview: () => {},
      teardown: () => {},
    }
  }
  return ctx
}

export function useItemPreviewBindings(item: TerraLiveIntelItem) {
  const api = useLiveIntelPreview()
  const slotRef = useRef<HTMLDivElement | null>(null)
  const preview = resolveMediaPreview(item.mediaPreview)
  const enabled = mediaPreviewIsRenderable(preview)

  const requestMuted = useCallback(() => {
    if (!enabled || !slotRef.current) return
    api.requestPreview({ item, mount: slotRef.current, mode: 'muted' })
  }, [api, enabled, item])

  const requestInspect = useCallback(() => {
    if (!enabled || !slotRef.current) return
    api.requestPreview({ item, mount: slotRef.current, mode: 'inspect' })
  }, [api, enabled, item])

  const release = useCallback(() => {
    if (!enabled) return
    api.releasePreview(item.id)
  }, [api, enabled, item.id])

  const onBlur = useCallback((event: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    release()
  }, [release])

  return {
    slotRef,
    enabled,
    active: api.activeId === item.id,
    reducedMotion: api.reducedMotion,
    requestMuted,
    requestInspect,
    release,
    onBlur,
  }
}

export function LiveIntelPreviewSurface({
  item,
  slotRef,
  compact,
  inspect,
  onPlay,
  active,
}: {
  item: TerraLiveIntelItem
  slotRef: { current: HTMLDivElement | null }
  compact?: boolean
  inspect?: boolean
  onPlay?: () => void
  active?: boolean
}) {
  const preview = resolveMediaPreview(item.mediaPreview)
  if (!mediaPreviewIsRenderable(preview)) return null
  const poster = preview.posterUrl ?? null

  return (
    <div className={`relative overflow-hidden rounded border border-cyan-400/20 bg-black/80 ${compact ? 'h-9 w-16 shrink-0' : inspect ? 'h-28 w-full' : 'h-16 w-full'}`}>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-full w-full object-cover opacity-90" />
      ) : (
        <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-widest text-slate-500">
          {preview.embedProvider ?? preview.type}
        </div>
      )}
      <div
        ref={node => { slotRef.current = node }}
        className="absolute inset-0"
        data-testid={`terra-live-intel-preview-slot-${item.id}`}
      />
      {inspect ? (
        <button
          type="button"
          onClick={onPlay}
          className="absolute bottom-1 right-1 rounded border border-cyan-400/50 bg-black/70 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200"
          aria-label="Play video"
        >
          {active ? 'Playing' : 'Play video'}
        </button>
      ) : (
        <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[7px] uppercase tracking-widest text-cyan-200">
          {preview.type === 'YT_MUTE_EMBED' ? 'YT' : preview.type === 'HLS_MUTE' ? 'HLS' : 'MEDIA'}
        </span>
      )}
    </div>
  )
}
