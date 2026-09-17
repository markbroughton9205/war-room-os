import type { MediaProvenance, MediaStation } from './types'

/** Known-dead Ideastream legacy path. Never pin. Never treat as a live source. */
export const NEVER_PIN_STREAM_URL = 'https://audio1.ideastream.org/wcpn128.mp3'
export const NEVER_PIN_STREAM_MARKER = 'audio1.ideastream.org/wcpn128.mp3'

export function isNeverPinStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return url.toLowerCase().includes(NEVER_PIN_STREAM_MARKER)
}

export function buildProvenance(station: MediaStation | null): MediaProvenance | null {
  if (!station) return null
  const streamUrlRecorded = Boolean(station.streamUrl) && !isNeverPinStreamUrl(station.streamUrl)
  return {
    provider: station.provider,
    region: station.region,
    playbackType: station.playbackType,
    sourceClass: station.sourceClass,
    verificationState: station.verificationState,
    lastVerifiedAt: station.lastVerifiedAt,
    homepage: station.homepage,
    listenPage: station.listenPage,
    attribution: station.attribution,
    streamUrlRecorded,
    codePresentIsNotVerified: streamUrlRecorded && station.verificationState !== 'VERIFIED',
  }
}

/**
 * Playback is allowed only for STREAM_ONLY stations with a recorded URL that
 * War Room has actually verified. CODE_PRESENT is not VERIFIED.
 */
export function isPlaybackEligible(station: MediaStation | null): boolean {
  if (!station) return false
  if (!station.streamUrl) return false
  if (isNeverPinStreamUrl(station.streamUrl)) return false
  if (station.sourceClass !== 'STREAM_ONLY') return false
  if (station.verificationState !== 'VERIFIED') return false
  if (station.playbackType === 'NONE' || station.playbackType === 'EXTERNAL') return false
  if (station.playbackType === 'HLS') return false
  return true
}

export function playbackBlockReason(station: MediaStation | null): string | null {
  if (!station) return 'No station selected.'
  if (isNeverPinStreamUrl(station.streamUrl)) {
    return 'This endpoint is recorded as dead and is never pinned.'
  }
  if (station.sourceClass === 'REFUSE') return 'This source is refused. War Room will not play it.'
  if (station.sourceClass === 'LINK_OUT') {
    return 'This source is link-out only. War Room will not embed or scrape it.'
  }
  if (station.sourceClass === 'HOLD') {
    return 'This station is on HOLD until an official stream URL is documented.'
  }
  if (!station.streamUrl) {
    return 'No verified stream URL is recorded. War Room will not invent one. Playback is unavailable.'
  }
  if (station.verificationState !== 'VERIFIED') {
    return `Source is ${station.verificationState}. CODE_PRESENT is not VERIFIED. Playback is unavailable.`
  }
  if (station.playbackType === 'HLS') {
    return 'This stream is classified HLS. hls.js is not installed until a verified pinned station requires it.'
  }
  if (station.playbackType === 'EXTERNAL') {
    return 'This source is official-site playback only. War Room will not embed or scrape it.'
  }
  if (station.playbackType === 'NONE') return 'No playable stream type is recorded.'
  return null
}
