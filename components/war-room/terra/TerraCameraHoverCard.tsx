'use client'

/**
 * God's Eye Phase 3 — the traffic-camera hover preview. A screen-anchored card shown while the
 * pointer dwells on a traffic_camera entity (wired through TerraGlobe's MOUSE_MOVE pick →
 * TerraShell's hover state). Truth rules:
 *   - Imagery is NEVER preloaded for all cameras: the still is requested only after a ≥400ms
 *     dwell on one camera (HOVER_DWELL_MS), and the resolved URL is cached briefly client-side
 *     (IMAGE_URL_CACHE) so re-hovering the same camera doesn't refetch.
 *   - A camera whose own source-reported freshness is 'stale' or 'offline' shows that state as
 *     text without fetching any image at all.
 *   - quebec_511_cameras publishes no direct JPEG (viewerUrl is an HTML viewer page) — it renders
 *     a "view at source" link, never an <img>.
 *   - ontario_511_cameras and hong_kong_td_cameras fetch through the camera-image proxy
 *     (app/api/terra/camera-image/route.ts); digitraffic_road_cameras hotlinks its own imageUrl.
 * Clicking the card (or pressing Enter while focused) opens the full Observed Data detail panel —
 * the same selection the existing click path produces. Touch devices have no hover: a tap selects
 * the camera and the detail panel shows the same image, so no capability is touch-gated.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { TerraGeoFeature } from '@/lib/terra/types'

const HOVER_DWELL_MS = 400
// Brief client-side cache of resolved preview URLs, keyed by feature id. Values are plain URLs
// (the browser's own HTTP cache — proxy responses carry cache-control: private, max-age=20 —
// governs the actual image bytes), so this only dedupes the decision, never pins stale bytes.
const IMAGE_URL_CACHE = new Map<string, string>()
const IMAGE_URL_CACHE_MAX = 200
const IMAGE_FAILURE_CACHE = new Map<string, number>() // featureId -> failed-at ms
const IMAGE_FAILURE_RETRY_MS = 30_000

// Same truth vocabulary/palette as TerraShell's CAMERA_FRESHNESS_LABEL (kept as a local copy to
// avoid a TerraShell ↔ hover-card module cycle) — live video vs still vs stale vs offline is
// source-reported, never inferred.
const FRESHNESS_META: Record<string, { text: string; color: string }> = {
  live_video: { text: 'LIVE VIDEO', color: 'text-emerald-400' },
  still_image: { text: 'STILL IMAGE — CURRENT', color: 'text-emerald-400' },
  stale: { text: 'STALE', color: 'text-amber-400' },
  offline: { text: 'OFFLINE', color: 'text-red-400' },
  unknown: { text: 'UNKNOWN', color: 'text-slate-400' },
}

const PROVIDER_LABEL: Record<string, string> = {
  digitraffic_road_cameras: 'Fintraffic Digitraffic (Finland)',
  ontario_511_cameras: 'Ontario 511 (Canada)',
  hong_kong_td_cameras: 'Hong Kong Transport Department',
  quebec_511_cameras: 'Québec 511 (MTMD)',
}

function resolvePreviewImageUrl(feature: TerraGeoFeature): string | null {
  const cached = IMAGE_URL_CACHE.get(feature.id)
  if (cached !== undefined) return cached
  let url: string | null = null
  if (feature.providerId === 'ontario_511_cameras' && typeof feature.properties.viewId === 'string') {
    url = `/api/terra/camera-image?provider=ontario_511_cameras&id=${encodeURIComponent(feature.properties.viewId)}`
  } else if (feature.providerId === 'hong_kong_td_cameras' && typeof feature.properties.cameraId === 'string') {
    url = `/api/terra/camera-image?provider=hong_kong_td_cameras&id=${encodeURIComponent(feature.properties.cameraId)}`
  } else if (feature.providerId === 'digitraffic_road_cameras' && typeof feature.properties.imageUrl === 'string') {
    url = feature.properties.imageUrl
  }
  if (url !== null) {
    if (IMAGE_URL_CACHE.size >= IMAGE_URL_CACHE_MAX) IMAGE_URL_CACHE.clear()
    IMAGE_URL_CACHE.set(feature.id, url)
  }
  return url
}

const CARD_WIDTH_PX = 288 // w-72

export function TerraCameraHoverCard({
  feature,
  x,
  y,
  onOpen,
  onDismiss,
}: {
  feature: TerraGeoFeature
  /** Cursor position relative to the globe container. */
  x: number
  y: number
  onOpen: () => void
  onDismiss: () => void
}) {
  // The metadata header renders immediately on hover; only the image waits out the dwell, so a
  // fast pass over many cameras never issues a single image request. State resets come free from
  // the parent's key={feature.id} remount — no effect-body setState.
  const [dwellElapsed, setDwellElapsed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      // A still that failed moments ago isn't re-requested on every re-hover (Date.now inside an
      // event callback, never during render).
      const failedAt = IMAGE_FAILURE_CACHE.get(feature.id) ?? 0
      if (Date.now() - failedAt < IMAGE_FAILURE_RETRY_MS) setImageFailed(true)
      setDwellElapsed(true)
    }, HOVER_DWELL_MS)
    return () => clearTimeout(timer)
  }, [feature.id])

  const freshness = typeof feature.properties.freshness === 'string' ? feature.properties.freshness : 'unknown'
  const freshnessMeta = FRESHNESS_META[freshness] ?? FRESHNESS_META.unknown
  const mediaAvailable = freshness !== 'stale' && freshness !== 'offline'
  const viewerUrl = typeof feature.properties.viewerUrl === 'string' ? feature.properties.viewerUrl : null
  const imageUrl = useMemo(
    () => (mediaAvailable && !viewerUrl ? resolvePreviewImageUrl(feature) : null),
    [feature, mediaAvailable, viewerUrl],
  )

  const showImage = dwellElapsed && imageUrl !== null && !imageFailed

  // Flip left of the cursor near the right edge so the card never leaves the viewport.
  const flipX = typeof window !== 'undefined' && x + CARD_WIDTH_PX + 32 > window.innerWidth
  const style: CSSProperties = flipX
    ? { left: x - 12, top: y + 16, transform: 'translateX(-100%)' }
    : { left: x + 16, top: y + 16 }

  return (
    <div
      role="dialog"
      aria-label={`${feature.title} — camera preview`}
      className="pointer-events-auto absolute z-40 w-72 rounded border border-cyan-400/30 bg-black/85 p-3 shadow-2xl backdrop-blur-md"
      style={style}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold leading-snug text-slate-100">{feature.title}</p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss preview" className="shrink-0 text-[10px] text-slate-500 hover:text-slate-300">
          dismiss
        </button>
      </div>
      <dl className="space-y-0.5 text-[10.5px] text-slate-400">
        {typeof feature.properties.road === 'string' && (
          <div className="flex justify-between"><dt>Road</dt><dd className="text-slate-200">{feature.properties.road}</dd></div>
        )}
        {typeof feature.properties.direction === 'string' && (
          <div className="flex justify-between"><dt>Direction</dt><dd className="text-slate-200">{feature.properties.direction.replace(/_/g, ' ').toLowerCase()}</dd></div>
        )}
        <div className="flex justify-between"><dt>Provider</dt><dd className="text-slate-200">{PROVIDER_LABEL[feature.providerId] ?? feature.providerId}</dd></div>
        {feature.timestamp && (
          <div className="flex justify-between"><dt>Captured</dt><dd className="text-slate-200">{new Date(feature.timestamp).toLocaleString()}</dd></div>
        )}
        {!feature.timestamp && (
          <div className="flex justify-between"><dt>Captured</dt><dd className="text-slate-500">not reported by source</dd></div>
        )}
        <div className="flex justify-between"><dt>Status</dt><dd className={freshnessMeta.color}>{freshnessMeta.text}</dd></div>
      </dl>

      {viewerUrl ? (
        <a href={viewerUrl} target="_blank" rel="noreferrer" className="mt-2 block rounded border border-white/15 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:border-cyan-400/60">
          View at source (HTML viewer)
        </a>
      ) : !mediaAvailable ? (
        <p className={`mt-2 text-[10.5px] ${freshnessMeta.color}`}>
          {freshness === 'offline' ? 'Camera reported offline by source — no image requested.' : 'Camera still reported stale by source — no image requested.'}
        </p>
      ) : showImage && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- proxied/provider-hosted camera still, refreshed at source cadence; not a Next-optimizable local asset.
        <img
          src={imageUrl}
          alt={`${feature.title} — road camera still image`}
          className="mt-2 w-full rounded border border-white/10"
          onError={() => {
            IMAGE_FAILURE_CACHE.set(feature.id, Date.now())
            setImageFailed(true)
          }}
        />
      ) : (
        <div className="mt-2 flex h-32 items-center justify-center rounded border border-white/10 bg-white/5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{imageFailed ? 'Image unavailable from source' : 'Loading still…'}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="mt-2 w-full rounded border border-white/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:border-emerald-400/60 hover:text-emerald-400"
      >
        Open full detail
      </button>
    </div>
  )
}
