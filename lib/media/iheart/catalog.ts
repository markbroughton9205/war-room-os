import type { MediaStation } from '../types'

/**
 * Official iHeartMedia station pages only.
 * Existing War Room media rule: do not scrape TuneIn / iHeart private APIs,
 * do not pin stream.revma.ihrhls.com, do not invent HTML5 mounts.
 * Access path is the official station page (OFFICIAL_PAGE / LINK_OUT).
 */
const VERIFIED_AT = '2026-09-18T07:20:00.000Z'

const IHEART_PAGE_NOTE =
  'Official iHeart station page. No stable, officially documented HTML5 stream suitable for War Room Audio. Did not scrape iHeart player internals or pin stream.revma.ihrhls.com. OFFICIAL_PAGE — OPEN OFFICIAL SITE.'

function iheartPage(partial: Omit<MediaStation, 'streamUrl' | 'sourceClass' | 'verificationState' | 'playbackType' | 'attribution' | 'sourceFamily' | 'playbackMode' | 'language' | 'artworkUrl' | 'embedUrl' | 'notes' | 'lastVerifiedAt'> & { notes?: string }): MediaStation {
  return {
    ...partial,
    streamUrl: null,
    attribution: 'iHeartRadio',
    sourceClass: 'LINK_OUT',
    verificationState: 'UNAVAILABLE',
    lastVerifiedAt: VERIFIED_AT,
    playbackType: 'EXTERNAL',
    sourceFamily: 'iheart',
    playbackMode: 'OFFICIAL_PAGE',
    country: partial.country ?? 'United States',
    language: 'en',
    artworkUrl: null,
    embedUrl: null,
    notes: partial.notes ?? IHEART_PAGE_NOTE,
  }
}

/** Curated official iHeart directory seed. National markets, not Ohio-only. */
export const IHEART_CATALOG: readonly MediaStation[] = [
  iheartPage({
    id: 'iheart-wkdd',
    callSign: 'WKDD',
    name: '98.1 KDD',
    frequency: '98.1 FM',
    provider: 'iHeartRadio',
    city: 'Akron, OH',
    region: 'OH-Akron',
    market: 'Akron, OH',
    state: 'OH',
    genre: 'POP',
    homepage: 'https://wkdd.iheart.com/',
    listenPage: 'https://wkdd.iheart.com/',
  }),
  iheartPage({
    id: 'iheart-whlo',
    callSign: 'WHLO',
    name: 'NewsRadio 640 WHLO',
    frequency: '640 AM',
    provider: 'iHeartRadio',
    city: 'Akron, OH',
    region: 'OH-Akron',
    market: 'Akron, OH',
    state: 'OH',
    genre: 'NEWS / TALK',
    homepage: 'https://whlo.iheart.com/',
    listenPage: 'https://whlo.iheart.com/',
  }),
  iheartPage({
    id: 'iheart-wmji',
    callSign: 'WMJI',
    name: 'Majic 105.7',
    frequency: '105.7 FM',
    provider: 'iHeartRadio',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    market: 'Cleveland, OH',
    state: 'OH',
    genre: 'OTHER',
    homepage: 'https://wmji.iheart.com/',
    listenPage: 'https://wmji.iheart.com/',
  }),
  iheartPage({
    id: 'iheart-waks',
    callSign: 'WAKS',
    name: '96.5 Kiss FM',
    frequency: '96.5 FM',
    provider: 'iHeartRadio',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    market: 'Cleveland, OH',
    state: 'OH',
    genre: 'POP',
    homepage: 'https://waks.iheart.com/',
    listenPage: 'https://waks.iheart.com/',
  }),
  iheartPage({
    id: 'iheart-wgar',
    callSign: 'WGAR',
    name: '99.5 WGAR',
    frequency: '99.5 FM',
    provider: 'iHeartRadio',
    city: 'Cleveland, OH',
    region: 'OH-Cleveland',
    market: 'Cleveland, OH',
    state: 'OH',
    genre: 'COUNTRY',
    homepage: 'https://wgar.iheart.com/',
    listenPage: 'https://wgar.iheart.com/',
  }),
  iheartPage({
    id: 'iheart-kiis',
    callSign: 'KIIS',
    name: '102.7 KIIS-FM',
    frequency: '102.7 FM',
    provider: 'iHeartRadio',
    city: 'Los Angeles, CA',
    region: 'CA-Los Angeles',
    market: 'Los Angeles, CA',
    state: 'CA',
    genre: 'POP',
    homepage: 'https://kiisfm.iheart.com/',
    listenPage: 'https://kiisfm.iheart.com/',
  }),
  iheartPage({
    id: 'iheart-z100',
    callSign: 'WHTZ',
    name: 'Z100',
    frequency: '100.3 FM',
    provider: 'iHeartRadio',
    city: 'New York, NY',
    region: 'NY-New York',
    market: 'New York, NY',
    state: 'NY',
    genre: 'POP',
    homepage: 'https://z100.iheart.com/',
    listenPage: 'https://z100.iheart.com/',
  }),
]

export function getIheartCatalogStations(): MediaStation[] {
  return IHEART_CATALOG.map(entry => ({ ...entry }))
}

export function iheartMarkets(stations: readonly MediaStation[] = IHEART_CATALOG): string[] {
  return [...new Set(stations.map(station => station.market ?? station.city))]
}
