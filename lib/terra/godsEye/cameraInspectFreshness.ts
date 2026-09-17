/**
 * Catalog retrieval health is not camera-image freshness.
 * A successful OHGO/Caltrans catalog poll is LIVE for the catalog only.
 * A still without a source capture timestamp stays UNKNOWN — never relabeled LIVE from the poll clock.
 */
export const CAMERA_CATALOG_STATUSES = ['LIVE', 'STALE', 'UNAVAILABLE'] as const
export type CameraCatalogStatus = (typeof CAMERA_CATALOG_STATUSES)[number]

export const CAMERA_IMAGE_FRESHNESS_STATES = ['LIVE', 'STALE', 'UNKNOWN', 'UNAVAILABLE'] as const
export type CameraImageFreshness = (typeof CAMERA_IMAGE_FRESHNESS_STATES)[number]

export type CameraInspectFreshness = {
  catalogStatus: CameraCatalogStatus
  catalogNote: string
  imageFreshness: CameraImageFreshness
  imageNote: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function cameraInspectFreshness(feature: {
  timestamp?: string | null
  provenance?: { fromCache?: boolean; isHistorical?: boolean; retrievedAt?: string | null }
  properties?: Record<string, unknown>
} | null | undefined): CameraInspectFreshness {
  const properties = feature?.properties ?? {}
  const retrievedAt = feature?.provenance?.retrievedAt ?? asString(properties.retrievedAt)
  const fromCache = Boolean(feature?.provenance?.fromCache)
  const historical = Boolean(feature?.provenance?.isHistorical)
  // Capture time is only a source-reported still timestamp. Catalog poll clocks
  // (retrievedAt, document updatedAt, feature.timestamp) must never become image LIVE.
  const captureTime = asString(properties.capturedAt)
    ?? asString(properties.lastModified)
    ?? asString(properties.measuredTimeIso)
  const reported = asString(properties.freshnessState) ?? asString(properties.freshness)

  let catalogStatus: CameraCatalogStatus = 'UNAVAILABLE'
  let catalogNote = 'Catalog retrieval not reported'
  if (fromCache) {
    catalogStatus = 'STALE'
    catalogNote = retrievedAt ? `Cached catalog · retrieved ${retrievedAt}` : 'Cached catalog'
  } else if (historical) {
    catalogStatus = 'STALE'
    catalogNote = 'Historical catalog — not a live poll'
  } else if (retrievedAt) {
    catalogStatus = 'LIVE'
    catalogNote = 'Retrieved successfully'
  }

  let imageFreshness: CameraImageFreshness = 'UNKNOWN'
  let imageNote = 'Source did not report capture time'
  const reportedUpper = reported?.toUpperCase() ?? ''
  if (reportedUpper === 'OFFLINE' || reportedUpper === 'UNAVAILABLE') {
    if (captureTime) {
      imageFreshness = 'UNAVAILABLE'
      imageNote = `Source reported ${reportedUpper} · capture ${captureTime}`
    } else {
      imageFreshness = reportedUpper === 'OFFLINE' ? 'UNAVAILABLE' : 'UNKNOWN'
      imageNote = reportedUpper === 'OFFLINE'
        ? 'Source reported the still unavailable'
        : 'Freshness unknown — source did not report capture time'
    }
  } else if (reportedUpper === 'STALE') {
    imageFreshness = 'STALE'
    imageNote = captureTime ? `Stale still · capture ${captureTime}` : 'Stale still — capture time not reported'
  } else if (reportedUpper === 'LIVE' || reportedUpper === 'STILL_IMAGE' || reportedUpper === 'STILL IMAGE — CURRENT') {
    if (captureTime) {
      imageFreshness = 'LIVE'
      imageNote = `Current still · capture ${captureTime}`
    } else {
      imageFreshness = 'UNKNOWN'
      imageNote = 'Freshness unknown — source did not report capture time. Catalog LIVE is not image LIVE.'
    }
  } else if (captureTime) {
    imageFreshness = 'LIVE'
    imageNote = `Capture ${captureTime}`
  }

  return { catalogStatus, catalogNote, imageFreshness, imageNote }
}
