/**
 * War Room Media — shared types.
 * Playback, registry, and presentation share these shapes. UI must not invent
 * a second audio session or treat CODE_PRESENT as VERIFIED.
 */

export const MEDIA_VERIFICATION_STATES = [
  'VERIFIED',
  'STALE',
  'UNVERIFIED',
  'DEAD',
  'UNAVAILABLE',
] as const
export type MediaVerificationState = (typeof MEDIA_VERIFICATION_STATES)[number]

export const MEDIA_SOURCE_CLASSES = [
  'STREAM_ONLY',
  'LINK_OUT',
  'HOLD',
  'REFUSE',
] as const
export type MediaSourceClass = (typeof MEDIA_SOURCE_CLASSES)[number]

export const MEDIA_PLAYBACK_TYPES = ['PROGRESSIVE', 'HLS', 'EXTERNAL', 'NONE'] as const
export type MediaPlaybackType = (typeof MEDIA_PLAYBACK_TYPES)[number]

export const MEDIA_PLAYBACK_STATES = [
  'idle',
  'loading',
  'playing',
  'paused',
  'error',
] as const
export type MediaPlaybackState = (typeof MEDIA_PLAYBACK_STATES)[number]

export const MEDIA_PRESENTATIONS = ['closed', 'window', 'compact'] as const
export type MediaPresentation = (typeof MEDIA_PRESENTATIONS)[number]

export const MEDIA_TABS = ['radio', 'news', 'weather', 'podcasts', 'saved'] as const
export type MediaTabId = (typeof MEDIA_TABS)[number]

export const MEDIA_AUTO_MODES = ['OFF', 'SURFACE_ONLY', 'PLAY_AND_SURFACE'] as const
export type MediaAutoMode = (typeof MEDIA_AUTO_MODES)[number]

export const MEDIA_SURFACE_REASONS = [
  'COMMANDER_SELECTED',
  'LOCAL_MEDIA',
  'ACTIVE_LOCATION',
  'WEATHER_ALERT',
  'INTEL_EVENT',
  'RESTORED_SESSION',
] as const
export type MediaSurfaceReason = (typeof MEDIA_SURFACE_REASONS)[number]

export const MEDIA_ORIGINS = ['manual', 'auto'] as const
export type MediaOrigin = (typeof MEDIA_ORIGINS)[number]

export const MEDIA_INTEL_KINDS = [
  'RADIO_STATION',
  'NWS_ALERT',
  'LOCAL_NEWS',
  'TRAFFIC_CAMERA',
  'EMERGENCY_INTEL',
] as const
export type MediaIntelKind = (typeof MEDIA_INTEL_KINDS)[number]

export type MediaStation = {
  id: string
  callSign: string
  name: string
  frequency: string | null
  provider: string
  city: string
  region: string
  /** Official homepage. Null until a real URL is recorded — never invented. */
  homepage: string | null
  /** Official listen / player page. Null until recorded — never invented. */
  listenPage: string | null
  /** Live stream URL. Null until verified in War Room — never invented. */
  streamUrl: string | null
  attribution: string | null
  sourceClass: MediaSourceClass
  verificationState: MediaVerificationState
  lastVerifiedAt: string | null
  playbackType: MediaPlaybackType
  notes: string
}

export type MediaProvenance = {
  provider: string
  region: string
  playbackType: MediaPlaybackType
  sourceClass: MediaSourceClass
  verificationState: MediaVerificationState
  lastVerifiedAt: string | null
  homepage: string | null
  listenPage: string | null
  attribution: string | null
  streamUrlRecorded: boolean
  /** True when a URL exists in code but has not passed GET verification. */
  codePresentIsNotVerified: boolean
}

export type MediaAlertDuckState = {
  /** Commander toggle. Ducking engine is not wired in Phase 1. */
  enabled: boolean
  ducking: boolean
  previousVolume: number | null
  policyNote: string
}

export type MediaWindowPosition = {
  x: number
  y: number
}

/** Authoritative player snapshot shared by every Media presentation. */
export type MediaNormalizedState = {
  station: MediaStation | null
  playbackState: MediaPlaybackState
  volume: number
  muted: boolean
  health: MediaVerificationState
  source: MediaProvenance | null
  alertDuckState: MediaAlertDuckState
  errorMessage: string | null
  presentation: MediaPresentation
  pinned: boolean
  activeTab: MediaTabId
  sourceInfoOpen: boolean
  windowPosition: MediaWindowPosition | null
  headerLauncherMounted: boolean
  /** Bumped when Commander presses MEDIA while the window is already open (focus/raise). */
  windowFocusNonce: number
  autoMediaMode: MediaAutoMode
  surfaceReason: MediaSurfaceReason | null
  origin: MediaOrigin
}
