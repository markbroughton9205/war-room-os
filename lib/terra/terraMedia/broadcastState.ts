/**
 * Terra Media asset/broadcast truth.
 *
 * LIVE is only returned when the underlying asset itself is positively verified live.
 * Feed retrieval recency, catalog poll clocks, and YouTube upload timestamps are not live evidence.
 * UNKNOWN is never promoted to LIVE.
 */
export const TERRA_MEDIA_ASSET_STATES = [
  'LIVE',
  'RECORDED',
  'RECENT',
  'UNAVAILABLE',
  'UNKNOWN',
] as const
export type TerraMediaAssetState = (typeof TERRA_MEDIA_ASSET_STATES)[number]

export const TERRA_MEDIA_LIVE_EVIDENCE = [
  'SOURCE_DECLARED_LIVE',
  'CAMERA_LIVE_VIDEO_STREAM',
] as const
export type TerraMediaLiveEvidence = (typeof TERRA_MEDIA_LIVE_EVIDENCE)[number]

export type TerraMediaBroadcastInput = {
  hasMedia: boolean
  previewType?: string | null
  youtubeVideoId?: string | null
  publishedAt?: string | null
  retrievedAt?: string | null
  nowIso?: string | null
  liveEvidence?: TerraMediaLiveEvidence | null
  cameraKind?: string | null
  captureFreshness?: string | null
  catalogStatus?: string | null
}

export function isTerraMediaLiveEvidence(value: string | null | undefined): value is TerraMediaLiveEvidence {
  return Boolean(value && (TERRA_MEDIA_LIVE_EVIDENCE as readonly string[]).includes(value))
}

function publishedIsRecent(publishedAt: string | null | undefined, nowIso?: string | null, retrievedAt?: string | null): boolean {
  const clock = publishedAt || retrievedAt
  if (!clock) return false
  const now = Date.parse(nowIso || new Date().toISOString())
  const age = now - Date.parse(clock)
  return Number.isFinite(age) && age >= 0 && age <= 36 * 60 * 60 * 1000
}

/**
 * Resolve the honest asset state for an Emergency Report.
 * Catalog LIVE / feed LIVE / recently fetched is insufficient.
 */
export function resolveTerraMediaAssetState(input: TerraMediaBroadcastInput): {
  state: TerraMediaAssetState
  reason: string
} {
  if (input.liveEvidence && isTerraMediaLiveEvidence(input.liveEvidence)) {
    return { state: 'LIVE', reason: `Positive live evidence: ${input.liveEvidence}.` }
  }
  if (input.cameraKind === 'CAMERA_STREAM') {
    const capture = (input.captureFreshness ?? '').toLowerCase()
    if (capture === 'live_video' || capture === 'live') {
      return { state: 'LIVE', reason: 'Camera stream with source-reported live_video/LIVE capture.' }
    }
    if (capture === 'stale' || capture === 'offline' || (input.catalogStatus ?? '').toLowerCase() === 'offline') {
      return { state: 'UNAVAILABLE', reason: 'Camera stream is stale or offline. Not labeled LIVE.' }
    }
    return { state: 'UNKNOWN', reason: 'Camera stream exists without positive live-broadcast evidence.' }
  }
  if (input.cameraKind === 'CAMERA_STILL') {
    return { state: 'RECORDED', reason: 'Camera still is a captured image, never a live broadcast.' }
  }
  if (input.previewType === 'YT_MUTE_EMBED' || input.youtubeVideoId) {
    return { state: 'RECORDED', reason: 'Official YouTube upload/embed without live-broadcast evidence is recorded.' }
  }
  if (input.previewType === 'POSTER') {
    if (publishedIsRecent(input.publishedAt, input.nowIso, input.retrievedAt)) {
      return { state: 'RECENT', reason: 'Recently published/fetched poster. Not proven live.' }
    }
    return { state: 'UNKNOWN', reason: 'Poster exists but live-vs-recorded was not source-verified.' }
  }
  if (input.previewType === 'HLS_MUTE' || input.previewType === 'OFFICIAL_EMBED') {
    return { state: 'UNKNOWN', reason: 'Media exists but live-vs-recorded was not source-verified.' }
  }
  if (!input.hasMedia || input.previewType === 'NONE') {
    return { state: 'UNAVAILABLE', reason: 'No verified playable media is recorded for this event.' }
  }
  return { state: 'UNKNOWN', reason: 'Asset live state is not evidenced.' }
}

export function terraMediaStateIsLive(state: TerraMediaAssetState): boolean {
  return state === 'LIVE'
}
