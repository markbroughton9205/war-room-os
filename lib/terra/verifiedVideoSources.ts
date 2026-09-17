/**
 * Commander-approved official video source registry.
 *
 * Channel IDs are accepted only when independently confirmed from:
 * - an official publisher page, or
 * - a lawful YouTube Atom feed for a username that publisher documented.
 * Do not scrape YouTube HTML, search, or article pages to discover channels.
 */
import type { TerraLiveIntelMediaAccessClass } from './liveIntelMedia'
import { validateYoutubeChannelId } from './liveIntelMedia'
import type { TerraLocalCoverageLevel, TerraLocalSourceType } from './localSources/types'

export type VerifiedVideoLocalityScope = 'NATIONAL' | 'GLOBAL' | 'LOCAL_SERVICE_AREA'
export type VerifiedVideoIntelCategory = 'EARTH' | 'LOCAL' | 'HEADLINES' | 'BREAKING' | 'EVENTS' | 'CONFLICT'

export type VerifiedVideoServiceArea = {
  country?: string
  countryCode?: string
  serviceArea?: string
  localityScope: VerifiedVideoLocalityScope
  city?: string | null
  county?: string | null
  metro?: string | null
  region?: string | null
  state?: string | null
  aliases?: string[]
  coverageLevel?: TerraLocalCoverageLevel
}

export type VerifiedVideoSource = {
  id: string
  provider: string
  officialName: string
  channelId: string
  channelUrl: string
  geography?: VerifiedVideoServiceArea
  categories: VerifiedVideoIntelCategory[]
  language?: string
  accessClass: TerraLiveIntelMediaAccessClass
  verificationSource: string
  enabled: boolean
  maxItems?: number
  localSourceType?: TerraLocalSourceType
}

export type HeldLocalVideoSource = {
  officialName: string
  officialPage: string
  channelId: string | null
  serviceArea: string
  verificationSource: string
  localFit: string
  holdReason: string
}

/**
 * Independently confirmed official channels only.
 * NASA's main @NASA handle is documented on nasa.gov but no channel_id is published there;
 * it is omitted rather than guessed. USGS publishes @usgs without a channel_id; omitted.
 */
export const VERIFIED_VIDEO_SOURCES: VerifiedVideoSource[] = [
  {
    id: 'nws-youtube',
    provider: 'nws_youtube',
    officialName: 'National Weather Service (NWS)',
    channelId: 'UC9hQvMjzSxurMirYDgOMezw',
    channelUrl: 'https://www.youtube.com/usweathergov',
    geography: {
      country: 'United States',
      countryCode: 'US',
      localityScope: 'NATIONAL',
    },
    categories: ['EARTH'],
    language: 'en',
    accessClass: 'PUBLIC',
    verificationSource: 'weather.gov documents youtube.com/usweathergov. Lawful Atom feed https://www.youtube.com/feeds/videos.xml?user=usweathergov and ?channel_id=UC9hQvMjzSxurMirYDgOMezw title as National Weather Service (NWS).',
    enabled: true,
    maxItems: 4,
  },
  {
    id: 'nasa-es-youtube',
    provider: 'nasa_youtube',
    officialName: 'NASA en Español',
    channelId: 'UC8zqCEvaRwHcfz3IhjhMMxQ',
    channelUrl: 'https://www.youtube.com/channel/UC8zqCEvaRwHcfz3IhjhMMxQ',
    geography: {
      localityScope: 'GLOBAL',
    },
    categories: ['HEADLINES'],
    language: 'es',
    accessClass: 'PUBLIC',
    verificationSource: 'nasa.gov/socialmedia publishes https://www.youtube.com/channel/UC8zqCEvaRwHcfz3IhjhMMxQ for NASA en Español / @nasa_es.',
    enabled: true,
    maxItems: 2,
  },
  {
    id: 'wkyc-youtube',
    provider: 'wkyc_youtube',
    officialName: 'WKYC 3 Cleveland',
    channelId: 'UCNBmxc6FvKyxtCpUygcdINA',
    channelUrl: 'https://www.youtube.com/channel/UCNBmxc6FvKyxtCpUygcdINA',
    geography: {
      country: 'United States',
      countryCode: 'US',
      localityScope: 'LOCAL_SERVICE_AREA',
      serviceArea: 'Cleveland / Akron / Northeast Ohio',
      city: 'Cleveland',
      county: 'Cuyahoga County',
      metro: 'Cleveland',
      region: 'Northeast Ohio',
      state: 'Ohio',
      coverageLevel: 'METRO',
      aliases: ['cleveland', 'akron', 'cuyahoga', 'summit', 'lorain', 'lake county', 'northeast ohio', 'ne ohio'],
    },
    categories: ['LOCAL'],
    language: 'en',
    accessClass: 'PUBLIC',
    verificationSource: 'wkyc.com homepage publishes https://www.youtube.com/channel/UCNBmxc6FvKyxtCpUygcdINA on the official connect/social link (observed 2026-09-17).',
    enabled: true,
    maxItems: 8,
    localSourceType: 'TV',
  },
  {
    id: 'news5-cleveland-youtube',
    provider: 'news5_youtube',
    officialName: 'News 5 Cleveland (WEWS)',
    channelId: 'UCAAmkc2sRESFoEtiKRTaTRA',
    channelUrl: 'https://www.youtube.com/channel/UCAAmkc2sRESFoEtiKRTaTRA',
    geography: {
      country: 'United States',
      countryCode: 'US',
      localityScope: 'LOCAL_SERVICE_AREA',
      serviceArea: 'Cleveland / Akron / Northeast Ohio',
      city: 'Cleveland',
      county: 'Cuyahoga County',
      metro: 'Cleveland',
      region: 'Northeast Ohio',
      state: 'Ohio',
      coverageLevel: 'METRO',
      aliases: ['cleveland', 'akron', 'cuyahoga', 'summit', 'lorain', 'lake county', 'northeast ohio', 'ne ohio'],
    },
    categories: ['LOCAL'],
    language: 'en',
    accessClass: 'PUBLIC',
    verificationSource: 'news5cleveland.com homepage JSON-LD sameAs and official SocialLink publish https://www.youtube.com/channel/UCAAmkc2sRESFoEtiKRTaTRA for News 5 Cleveland / WEWS (observed 2026-09-17).',
    enabled: true,
    maxItems: 8,
    localSourceType: 'TV',
  },
]

/**
 * Official local identities that are documented but not enabled: no independently
 * proven channel_id, or the lawful Atom username feed did not resolve.
 * Do not guess these IDs.
 */
export const HELD_LOCAL_VIDEO_SOURCES: HeldLocalVideoSource[] = [
  {
    officialName: 'City of Akron',
    officialPage: 'https://www.akronohio.gov/',
    channelId: null,
    serviceArea: 'Akron / Summit County',
    verificationSource: 'akronohio.gov homepage, /community/, and /government document https://www.Youtube.com/cityofakron. No UC channel ID is published. Lawful Atom ?user=cityofakron returned HTTP 404.',
    localFit: 'CITY — Akron only. Would be LOCAL for Akron/Summit, not Cleveland, not Tokyo.',
    holdReason: 'Official handle documented; channel_id not independently proven. No YouTube HTML scrape.',
  },
  {
    officialName: 'City of Cleveland TV20',
    officialPage: 'https://www.clevelandohio.gov/',
    channelId: null,
    serviceArea: 'City of Cleveland',
    verificationSource: 'clevelandohio.gov and city.cleveland.oh.us document https://www.youtube.com/user/tv20videos. No UC channel ID is published. Lawful Atom ?user=tv20videos returned HTTP 404.',
    localFit: 'CITY — Cleveland only. Would not overlap Akron (Summit) or Tokyo.',
    holdReason: 'Official username documented; channel_id not independently proven. No YouTube HTML scrape.',
  },
  {
    officialName: 'Fox 8 WJW Cleveland',
    officialPage: 'https://www.fox8.com/',
    channelId: null,
    serviceArea: 'Cleveland / Akron / Northeast Ohio',
    verificationSource: 'fox8.com returned HTTP 403 to the verification client; no official YouTube channel URL was recovered.',
    localFit: 'METRO — same DMA as WKYC. HOLD until an official page publishes a channel_id.',
    holdReason: 'Official site blocked the verification fetch. Channel ID not proven.',
  },
  {
    officialName: 'Cleveland19 WOIO',
    officialPage: 'https://www.cleveland19.com/',
    channelId: null,
    serviceArea: 'Cleveland / Akron / Northeast Ohio',
    verificationSource: 'cleveland19.com homepage and /contact contained no YouTube URL or UC channel ID.',
    localFit: 'METRO — HOLD until the station publishes a channel_id on an official page.',
    holdReason: 'No official YouTube identity on recovered publisher pages.',
  },
  {
    officialName: 'NWS Cleveland (WFO)',
    officialPage: 'https://www.weather.gov/cle/',
    channelId: null,
    serviceArea: 'Northeast Ohio forecast area',
    verificationSource: 'weather.gov/cle documents https://www.youtube.com/user/NWSCleveland. No UC channel ID is published. Lawful Atom ?user=NWSCleveland returned HTTP 404. National NWS remains EARTH, not LOCAL.',
    localFit: 'REGIONAL weather/emergency — HOLD. Do not treat the national NWS channel as Cleveland local.',
    holdReason: 'Official username documented; channel_id not independently proven.',
  },
]

export function youtubeChannelAtomFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
}

export function enabledVerifiedVideoSources(): VerifiedVideoSource[] {
  return VERIFIED_VIDEO_SOURCES.filter(source => (
    source.enabled
    && Boolean(validateYoutubeChannelId(source.channelId))
    && source.accessClass !== 'COMMANDER_PRIVATE'
  ))
}

export function verifiedVideoSourceById(id: string): VerifiedVideoSource | null {
  return VERIFIED_VIDEO_SOURCES.find(source => source.id === id) ?? null
}

export function videoSourceIsLocalEligible(source: VerifiedVideoSource): boolean {
  return source.geography?.localityScope === 'LOCAL_SERVICE_AREA' && Boolean(source.geography.serviceArea)
}
