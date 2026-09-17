/**
 * Live Intel mediaPreview — optional, source-derived only.
 *
 * YouTube IDs are accepted only from a dedicated provider field or official YouTube URL forms.
 * HTML is never scraped. Honesty (verificationState) is a separate field and is never
 * upgraded because media exists.
 */
export const TERRA_LIVE_INTEL_MEDIA_PREVIEW_TYPES = [
  'NONE',
  'POSTER',
  'YT_MUTE_EMBED',
  'HLS_MUTE',
  'OFFICIAL_EMBED',
] as const
export type TerraLiveIntelMediaPreviewType = (typeof TERRA_LIVE_INTEL_MEDIA_PREVIEW_TYPES)[number]

export const TERRA_LIVE_INTEL_MEDIA_ACCESS_CLASSES = [
  'PUBLIC',
  'PROVIDER_AUTH',
  'COMMANDER_PRIVATE',
] as const
export type TerraLiveIntelMediaAccessClass = (typeof TERRA_LIVE_INTEL_MEDIA_ACCESS_CLASSES)[number]

export type TerraLiveIntelMediaProvenance = {
  provider?: string
  sourceUrl?: string
  mediaSourceUrl?: string
  retrievedAt?: string
  officialChannelName?: string
  channelId?: string
  videoId?: string
  feedUrl?: string
  verificationSource?: string
}

export type TerraLiveIntelMediaPreview = {
  type: TerraLiveIntelMediaPreviewType
  posterUrl?: string
  previewUrl?: string
  youtubeVideoId?: string
  embedProvider?: string
  accessClass: TerraLiveIntelMediaAccessClass
  provenance: TerraLiveIntelMediaProvenance
  originalLanguage?: string
  englishTranslation?: string
}

export const TERRA_LIVE_INTEL_MEDIA_NONE: TerraLiveIntelMediaPreview = {
  type: 'NONE',
  accessClass: 'PUBLIC',
  provenance: {},
}

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/
const HLS_MANIFEST_RE = /\.m3u8(?:$|[?#])/i

export function validateYoutubeVideoId(value: string | null | undefined): string | null {
  const id = value?.trim() ?? ''
  return YOUTUBE_ID_RE.test(id) ? id : null
}

function youtubeHost(hostname: string): 'watch' | 'short' | null {
  const host = hostname.toLowerCase()
  if (host === 'youtu.be' || host === 'www.youtu.be') return 'short'
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') return 'watch'
  return null
}

/**
 * Extract a YouTube video ID only from official URL forms:
 * youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/
 * Never from unrelated article URLs. Never from scraped HTML.
 */
export function extractYoutubeVideoIdFromUrl(raw: string | null | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const kind = youtubeHost(url.hostname)
  if (!kind) return null
  if (kind === 'short') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return validateYoutubeVideoId(id)
  }
  if (url.pathname === '/watch' || url.pathname === '/watch/') {
    return validateYoutubeVideoId(url.searchParams.get('v'))
  }
  const embed = /^\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})(?:\/|$)/.exec(url.pathname)
  return embed ? validateYoutubeVideoId(embed[1]) : null
}

const YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/

/** Official YouTube channel IDs are UC + 22 characters. Atom feeds sometimes omit the UC prefix. */
export function validateYoutubeChannelId(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  const withPrefix = raw.startsWith('UC') ? raw : `UC${raw}`
  return YOUTUBE_CHANNEL_ID_RE.test(withPrefix) ? withPrefix : null
}

export function youtubePosterUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

/** Official YouTube thumbnail hosts only. Never an arbitrary CDN. */
export function lawfulYoutubeThumbnailUrl(raw: string | null | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    const allowed = host === 'i.ytimg.com'
      || host === 'i9.ytimg.com'
      || host.endsWith('.ytimg.com')
      || host === 'yt3.ggpht.com'
      || host.endsWith('.ggpht.com')
    return allowed ? url.toString() : null
  } catch {
    return null
  }
}

export function youtubeMuteEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1`
}

export function youtubeUnmuteEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1`
}

export function isHlsManifestUrl(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && HLS_MANIFEST_RE.test(url.pathname + url.search)
  } catch {
    return false
  }
}

export function nativeHlsPlaybackSupported(): boolean {
  if (typeof document === 'undefined') return false
  const video = document.createElement('video')
  return Boolean(
    video.canPlayType('application/vnd.apple.mpegurl')
    || video.canPlayType('application/x-mpegURL'),
  )
}

export function resolveMediaPreview(preview: TerraLiveIntelMediaPreview | null | undefined): TerraLiveIntelMediaPreview {
  if (!preview) return TERRA_LIVE_INTEL_MEDIA_NONE
  return preview
}

export function mediaPreviewIsRenderable(preview: TerraLiveIntelMediaPreview | null | undefined): boolean {
  const resolved = resolveMediaPreview(preview)
  if (resolved.type === 'NONE') return false
  if (resolved.type === 'YT_MUTE_EMBED') return Boolean(validateYoutubeVideoId(resolved.youtubeVideoId))
  if (resolved.type === 'POSTER') return Boolean(resolved.posterUrl)
  if (resolved.type === 'HLS_MUTE') return Boolean(resolved.previewUrl)
  if (resolved.type === 'OFFICIAL_EMBED') return Boolean(resolved.previewUrl)
  return false
}

export function buildMediaPreviewFromSource(input: {
  sourceUrl?: string | null
  youtubeVideoId?: string | null
  provider: string
  retrievedAt: string
  originalLanguage?: string | null
  englishTranslation?: string | null
  accessClass?: TerraLiveIntelMediaAccessClass
  officialEmbedUrl?: string | null
  hlsUrl?: string | null
  officialChannelName?: string | null
  channelId?: string | null
  feedUrl?: string | null
  verificationSource?: string | null
  posterUrl?: string | null
}): TerraLiveIntelMediaPreview {
  const accessClass = input.accessClass ?? 'PUBLIC'
  const channelId = validateYoutubeChannelId(input.channelId)
  const provenance: TerraLiveIntelMediaProvenance = {
    provider: input.provider,
    sourceUrl: input.sourceUrl ?? undefined,
    retrievedAt: input.retrievedAt,
    officialChannelName: input.officialChannelName ?? undefined,
    channelId: channelId ?? undefined,
    feedUrl: input.feedUrl ?? undefined,
    verificationSource: input.verificationSource ?? undefined,
  }
  const fromField = validateYoutubeVideoId(input.youtubeVideoId)
  const fromUrl = extractYoutubeVideoIdFromUrl(input.sourceUrl)
  const youtubeVideoId = fromField ?? fromUrl
  if (youtubeVideoId) {
    return {
      type: 'YT_MUTE_EMBED',
      youtubeVideoId,
      posterUrl: lawfulYoutubeThumbnailUrl(input.posterUrl) ?? youtubePosterUrl(youtubeVideoId),
      previewUrl: youtubeMuteEmbedUrl(youtubeVideoId),
      embedProvider: 'youtube',
      accessClass,
      provenance: {
        ...provenance,
        videoId: youtubeVideoId,
        mediaSourceUrl: fromField
          ? `https://www.youtube.com/watch?v=${youtubeVideoId}`
          : (input.sourceUrl ?? undefined),
      },
      originalLanguage: input.originalLanguage ?? undefined,
      englishTranslation: input.englishTranslation ?? undefined,
    }
  }

  const official = input.officialEmbedUrl?.trim() || null
  if (official && official.startsWith('https://')) {
    return {
      type: 'OFFICIAL_EMBED',
      previewUrl: official,
      posterUrl: undefined,
      embedProvider: input.provider,
      accessClass,
      provenance: { ...provenance, mediaSourceUrl: official },
      originalLanguage: input.originalLanguage ?? undefined,
      englishTranslation: input.englishTranslation ?? undefined,
    }
  }

  const hls = input.hlsUrl?.trim() || null
  if (hls && isHlsManifestUrl(hls)) {
    return {
      type: 'HLS_MUTE',
      previewUrl: hls,
      accessClass,
      provenance: { ...provenance, mediaSourceUrl: hls },
      originalLanguage: input.originalLanguage ?? undefined,
      englishTranslation: input.englishTranslation ?? undefined,
    }
  }

  return {
    type: 'NONE',
    accessClass,
    provenance,
    originalLanguage: input.originalLanguage ?? undefined,
    englishTranslation: input.englishTranslation ?? undefined,
  }
}

/**
 * Strip protected media from public payloads. COMMANDER_PRIVATE never leaks onto
 * AUTH_REQUIRED responses. PROVIDER_AUTH media is withheld without an authenticated session.
 * Honesty is not stored here and is not modified.
 */
export function sanitizeMediaPreviewForAuth(
  preview: TerraLiveIntelMediaPreview | null | undefined,
  authState: 'AUTHENTICATED' | 'AUTH_REQUIRED',
): TerraLiveIntelMediaPreview {
  const resolved = resolveMediaPreview(preview)
  if (resolved.type === 'NONE') {
    return {
      type: 'NONE',
      accessClass: 'PUBLIC',
      provenance: resolved.provenance.provider || resolved.provenance.retrievedAt
        ? { provider: resolved.provenance.provider, retrievedAt: resolved.provenance.retrievedAt }
        : {},
    }
  }
  const blocked = authState !== 'AUTHENTICATED' && (
    resolved.accessClass === 'COMMANDER_PRIVATE'
    || resolved.accessClass === 'PROVIDER_AUTH'
  )
  if (blocked) {
    return {
      type: 'NONE',
      accessClass: 'PUBLIC',
      provenance: {},
    }
  }
  return resolved
}

export function observedMediaFacts(preview: TerraLiveIntelMediaPreview | null | undefined): string[] {
  const resolved = resolveMediaPreview(preview)
  if (resolved.type === 'NONE') {
    return ['MEDIA TYPE: NONE']
  }
  return [
    `MEDIA TYPE: ${resolved.type}`,
    resolved.accessClass ? `MEDIA ACCESS CLASS: ${resolved.accessClass}` : null,
    resolved.youtubeVideoId ? `YOUTUBE VIDEO ID: ${resolved.youtubeVideoId}` : null,
    resolved.posterUrl ? `POSTER URL: ${resolved.posterUrl}` : null,
    resolved.previewUrl ? `PREVIEW URL: ${resolved.previewUrl}` : null,
    resolved.embedProvider ? `EMBED PROVIDER: ${resolved.embedProvider}` : null,
    resolved.provenance.provider ? `MEDIA PROVIDER: ${resolved.provenance.provider}` : null,
    resolved.provenance.officialChannelName ? `OFFICIAL CHANNEL NAME: ${resolved.provenance.officialChannelName}` : null,
    resolved.provenance.channelId ? `YOUTUBE CHANNEL ID: ${resolved.provenance.channelId}` : null,
    resolved.provenance.videoId ? `PROVENANCE VIDEO ID: ${resolved.provenance.videoId}` : null,
    resolved.provenance.mediaSourceUrl ? `CANONICAL VIDEO URL: ${resolved.provenance.mediaSourceUrl}` : null,
    resolved.provenance.feedUrl ? `MEDIA FEED URL: ${resolved.provenance.feedUrl}` : null,
    resolved.provenance.verificationSource ? `CHANNEL VERIFICATION SOURCE: ${resolved.provenance.verificationSource}` : null,
    resolved.provenance.sourceUrl ? `MEDIA PROVENANCE SOURCE URL: ${resolved.provenance.sourceUrl}` : null,
    resolved.provenance.retrievedAt ? `MEDIA RETRIEVED: ${resolved.provenance.retrievedAt}` : null,
    'VIDEO SOURCE: Official YouTube channel. Not discovered by scraping the open web.',
    'Media provenance is Observed Data. Video presence does not confirm the story.',
  ].filter((line): line is string => Boolean(line))
}
