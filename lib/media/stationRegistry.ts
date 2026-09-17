import { NEVER_PIN_STREAM_MARKER } from './provenance'
import type { MediaStation } from './types'

/**
 * Ohio Media registry — Phase 2.
 * Stream URLs are recorded only after official-surface identification plus
 * bounded GET of audio bytes. Never pin audio1.ideastream.org/wcpn128.mp3.
 */
const VERIFIED_AT = '2026-09-17T01:55:00.000Z'

export const OHIO_MEDIA_STATIONS: readonly MediaStation[] = [
  {
    id: 'oh-waps',
    callSign: 'WAPS',
    name: 'The Summit FM',
    frequency: '91.3 FM',
    provider: 'The Summit FM',
    city: 'Akron, OH',
    region: 'OH-Akron',
    homepage: 'https://thesummit.fm/',
    listenPage: 'https://thesummit.fm/pop-out-music-player/',
    streamUrl: 'https://securestreams2.autopo.st:1194/TheSummit',
    attribution: 'The Summit FM',
    sourceClass: 'STREAM_ONLY',
    verificationState: 'VERIFIED',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'PROGRESSIVE',
    notes:
      'Official thesummit.fm HTML5 <audio> source. GET 200 audio/aac (ADTS; site labels audio/mpeg). CORS *. Final URL unchanged. HTML5 Audio plays AAC. Direct progressive Icecast mount.',
  },
  {
    id: 'oh-wjcu',
    callSign: 'WJCU',
    name: 'WJCU',
    frequency: '88.7 FM',
    provider: 'John Carroll University',
    city: 'University Heights, OH',
    region: 'OH-Cleveland',
    homepage: 'https://www.wjcu.org/',
    listenPage: 'https://www.wjcu.org/listen',
    streamUrl: 'https://wjcu.jcu.edu/listen/wjcu_radio/wjcu-mp3-hi',
    attribution: 'John Carroll University',
    sourceClass: 'STREAM_ONLY',
    verificationState: 'VERIFIED',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'PROGRESSIVE',
    notes:
      'Official listen page advertises https://www.wjcu.org/streams/wjcu-mp3-hi.m3u (audio/x-mpegurl) → http://wjcu.jcu.edu/listen/wjcu_radio/wjcu-mp3-hi. HTTPS same path GET 200 audio/mpeg, ICY WJCU-FM MP3 High, CORS *, MPEG sync fffb. Prefer MP3 over official AAC m3u for HTML5 Audio.',
  },
  {
    id: 'oh-wksu',
    callSign: 'WKSU',
    name: 'WKSU',
    frequency: '89.7 FM',
    provider: 'Ideastream Public Media',
    city: 'Akron, OH',
    region: 'OH-Akron',
    homepage: 'https://www.wksu.org/',
    listenPage: 'https://www.ideastream.org/listen-online',
    streamUrl: 'https://live.ideastream.org/wksu1.128.mp3',
    attribution: 'Ideastream Public Media',
    sourceClass: 'STREAM_ONLY',
    verificationState: 'VERIFIED',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'PROGRESSIVE',
    notes:
      'Official Ideastream listen-online lists live.ideastream.org/wksu1.128.mp3. GET 200 audio/mpeg, ICY WKSU, no ACAO (HTML5 Audio does not require CORS). wksu.org redirects to ideastream.org. Never pin audio1.ideastream.org/wcpn128.mp3 (GET timeout / dead).',
  },
  {
    id: 'oh-wclv',
    callSign: 'WCLV',
    name: 'WCLV Classical',
    frequency: '104.9 FM',
    provider: 'Ideastream Public Media',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    homepage: 'https://www.ideastream.org/classical',
    listenPage: 'https://www.ideastream.org/listen-online',
    streamUrl: 'https://live.ideastream.org/wclv.mp3',
    attribution: 'Ideastream Public Media',
    sourceClass: 'STREAM_ONLY',
    verificationState: 'VERIFIED',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'PROGRESSIVE',
    notes:
      'Official Ideastream listen-online lists live.ideastream.org/wclv.mp3. GET 200 audio/mpeg, ICY WCLV, no ACAO. wclv.org redirects to ideastream.org/classical.',
  },
  {
    id: 'oh-jazzneo',
    callSign: 'JazzNEO',
    name: 'JazzNEO',
    frequency: null,
    provider: 'Ideastream Public Media',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    homepage: 'https://www.ideastream.org/jazz',
    listenPage: 'https://www.ideastream.org/listen-online',
    streamUrl: 'https://live.ideastream.org/jazzneo.mp3',
    attribution: 'Ideastream Public Media',
    sourceClass: 'STREAM_ONLY',
    verificationState: 'VERIFIED',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'PROGRESSIVE',
    notes:
      'Official Ideastream listen-online lists live.ideastream.org/jazzneo.mp3. GET 200 audio/mpeg, ICY JazzNEO, no ACAO. Digital Ideastream service; no FM frequency recorded.',
  },
  {
    id: 'oh-folk-alley',
    callSign: 'Folk Alley',
    name: 'Folk Alley',
    frequency: null,
    provider: 'Folk Alley / Ideastream Public Media',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    homepage: 'https://folkalley.com/',
    listenPage: 'https://folkalley.com/stream/folk-alley/',
    streamUrl: 'https://freshgrass.streamguys1.com/folkalley-128mp3',
    attribution: 'Folk Alley / Ideastream Public Media',
    sourceClass: 'STREAM_ONLY',
    verificationState: 'VERIFIED',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'PROGRESSIVE',
    notes:
      'Official playlist http://www.folkalley.com/folkalley.pls → https://folkalley.com/playlists/folkalley.pls File1=http://freshgrass.streamguys1.com/folkalley-128mp3. .pls is not an MP3. HTTPS GET of resolved mount 200 audio/mpeg ID3, no ACAO. Ideastream also lists folkalley-wksu-128.mp3 as WKSU HD2; this pin is the official Folk Alley playlist endpoint.',
  },
  {
    id: 'oh-wnir',
    callSign: 'WNIR',
    name: 'WNIR',
    frequency: '100.1 FM',
    provider: 'WNIR',
    city: 'Akron, OH',
    region: 'OH-Akron',
    homepage: 'https://www.wnir.com/',
    listenPage: 'https://player.listenlive.co/51471',
    streamUrl: null,
    attribution: 'WNIR',
    sourceClass: 'LINK_OUT',
    verificationState: 'UNAVAILABLE',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'EXTERNAL',
    notes:
      'Official wnir.com Listen Live opens https://player.listenlive.co/51471 (SoCast/Hubbard popup). No direct MP3/AAC/HLS on the official page. EXTERNAL_ONLY. Do not scrape listenlive.co. Do not add mpv this pass. OPEN OFFICIAL SITE.',
  },
  {
    id: 'oh-wtam',
    callSign: 'WTAM',
    name: 'WTAM',
    frequency: '1100 AM',
    provider: 'iHeartRadio',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    homepage: 'https://wtam.iheart.com/',
    listenPage: 'https://wtam.iheart.com/',
    streamUrl: null,
    attribution: 'iHeartRadio',
    sourceClass: 'LINK_OUT',
    verificationState: 'UNAVAILABLE',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'EXTERNAL',
    notes:
      'Official station page is valid. No stable, officially documented direct stream suitable for HTML5. Did not scrape iHeart or use private/signed URLs. LINK_OUT — OPEN OFFICIAL SITE.',
  },
  {
    id: 'oh-wmms',
    callSign: 'WMMS',
    name: 'WMMS',
    frequency: '100.7 FM',
    provider: 'iHeartRadio',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    homepage: 'https://wmms.iheart.com/',
    listenPage: 'https://wmms.iheart.com/',
    streamUrl: null,
    attribution: 'iHeartRadio',
    sourceClass: 'LINK_OUT',
    verificationState: 'UNAVAILABLE',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'EXTERNAL',
    notes:
      'Official station page is valid. No stable, officially documented direct stream suitable for HTML5. Did not scrape iHeart or use private/signed URLs. LINK_OUT — OPEN OFFICIAL SITE.',
  },
  {
    id: 'oh-wknr',
    callSign: 'WKNR',
    name: 'WKNR',
    frequency: '850 AM',
    provider: 'WKNR',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    homepage: null,
    listenPage: null,
    streamUrl: null,
    attribution: null,
    sourceClass: 'HOLD',
    verificationState: 'UNVERIFIED',
    lastVerifiedAt: null,
    playbackType: 'NONE',
    notes:
      'HOLD. No official playable source verified this pass. Did not invent a homepage or stream from third-party redirects.',
  },
]

export function getOhioMediaStations(): MediaStation[] {
  return OHIO_MEDIA_STATIONS.map(entry => ({ ...entry }))
}

export function getMediaStationById(id: string): MediaStation | null {
  const found = OHIO_MEDIA_STATIONS.find(entry => entry.id === id)
  return found ? { ...found } : null
}

export function assertRegistryDoesNotPinDeadWcpn(stations: readonly MediaStation[] = OHIO_MEDIA_STATIONS): void {
  for (const entry of stations) {
    if (entry.streamUrl && entry.streamUrl.toLowerCase().includes(NEVER_PIN_STREAM_MARKER)) {
      throw new Error('Refusing to pin dead Ideastream WCPN endpoint.')
    }
  }
}

assertRegistryDoesNotPinDeadWcpn()
