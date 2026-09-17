import { pathToFileURL } from 'node:url'
import {
  composeLiveIntelPanel,
  headlinesAreNearDuplicate,
  intelItemToGeoFeature,
  overlayFeaturesFromPanel,
} from './liveIntelPanelModel'
import type { TerraLiveGeoObject } from './liveGeoIntelligence'
import { buildTerraCouncilHandoffFromIntelItem, canSendTerraIntelItemToCouncil } from './councilHandoff'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-16T19:00:00.000Z'

function quake(overrides: Partial<TerraLiveGeoObject> = {}): TerraLiveGeoObject {
  return {
    id: 'usgs-ci123',
    layer: 'intelligence_events',
    type: 'earthquake',
    category: 'hazards',
    title: 'M 5.1 - 10 km W of Example',
    summary: null,
    latitude: 34.05,
    longitude: -118.2,
    observedAt: '2026-09-16T18:00:00.000Z',
    receivedAt: NOW,
    provider: 'usgs_earthquake_feed',
    publisherFamily: 'USGS',
    sourceFamily: 'usgs_earthquake_feed',
    evidenceId: 'usgs-ci123',
    discoveryProvenance: { discoveredVia: 'usgs_earthquake_feed', alsoDiscoveredVia: [], upstreamEngines: [], storageOrigin: null },
    country: 'US',
    region: 'California',
    jurisdiction: null,
    freshness: 'LIVE',
    confidence: null,
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/ci123',
    coordinateOrigin: 'observed',
    identityKey: null,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'cluster_near_duplicate_headlines',
    headlinesAreNearDuplicate('Major earthquake strikes Los Angeles', 'Major earthquake strikes Los Angeles'),
    'exact normalized titles cluster; loosely related titles stay distinct',
  ))

  const panel = composeLiveIntelPanel({
    now: NOW,
    objects: [quake()],
    news: [
      {
        id: 'rss-1',
        title: 'Major earthquake strikes Los Angeles',
        summary: 'A magnitude 5.1 earthquake was reported.',
        url: 'https://www.bbc.com/news/quake-1',
        sourceName: 'BBC World News',
        provider: 'public_rss',
        publishedAt: '2026-09-16T18:10:00.000Z',
        retrievedAt: NOW,
        reliability: 'HIGH',
        feedName: 'BBC World News',
      },
      {
        id: 'rss-2',
        title: 'Major earthquake strikes Los Angeles',
        summary: 'USGS recorded a 5.1 quake.',
        url: 'https://www.aljazeera.com/quake-1',
        sourceName: 'Al Jazeera',
        provider: 'public_rss',
        publishedAt: '2026-09-16T18:12:00.000Z',
        retrievedAt: NOW,
        reliability: 'HIGH',
        feedName: 'Al Jazeera',
      },
      {
        id: 'rss-old',
        title: 'Parliament opens a new session',
        summary: 'Lawmakers returned.',
        url: 'https://www.bbc.com/news/parliament',
        sourceName: 'BBC World News',
        provider: 'public_rss',
        publishedAt: '2026-09-16T12:00:00.000Z',
        retrievedAt: NOW,
        reliability: 'HIGH',
        feedName: 'BBC World News',
      },
      {
        id: 'ja-1',
        title: '地震で鉄道に遅れ',
        summary: '首都圏の在来線に遅れが出ています。',
        url: 'https://www.nhk.or.jp/news/quake',
        sourceName: 'NHK',
        provider: 'public_rss',
        publishedAt: '2026-09-16T18:20:00.000Z',
        retrievedAt: NOW,
        reliability: 'HIGH',
        feedName: 'NHK',
      },
      {
        id: 'rw-1',
        title: 'Humanitarian update on armed clashes and displacement',
        summary: 'UN OCHA report.',
        url: 'https://reliefweb.int/node/1',
        sourceName: 'OCHA',
        provider: 'reliefweb',
        publishedAt: '2026-09-16T17:00:00.000Z',
        retrievedAt: NOW,
        contentType: 'humanitarian_report',
        geography: 'Sudan',
        reliability: 'HIGH',
        feedName: 'ReliefWeb',
      },
    ],
    latitude: 34.05,
    longitude: -118.2,
    place: 'Los Angeles',
    authState: 'AUTHENTICATED',
  })

  const earth = panel.sections.find(section => section.id === 'EARTH')
  const local = panel.sections.find(section => section.id === 'LOCAL')
  const headlines = panel.sections.find(section => section.id === 'HEADLINES')
  const breaking = panel.sections.find(section => section.id === 'BREAKING')
  const conflict = panel.sections.find(section => section.id === 'CONFLICT')
  const clustered = headlines?.items.find(item => /earthquake strikes los angeles/i.test(item.headline))

  results.push(check('earth_uses_usgs_event', Boolean(earth?.items.some(item => item.provider === 'usgs_earthquake_feed' && item.lat === 34.05)), earth?.items.map(item => item.id).join(',') ?? 'none'))
  results.push(check('local_uses_active_terra_location', Boolean(local?.items.length && /los angeles/i.test(local.reason)), local?.reason ?? 'none'))
  results.push(check('duplicate_headlines_cluster', Boolean(clustered && clustered.sourceCount >= 2), JSON.stringify(clustered?.sources.map(source => source.name))))
  results.push(check(
    'breaking_requires_evidence',
    Boolean(breaking?.items.some(item => item.sourceCount >= 2 && item.breakingReason))
      && !breaking?.items.some(item => /parliament/i.test(item.headline)),
    breaking?.items.map(item => item.headline).join(' | ') ?? 'none',
  ))
  results.push(check(
    'conflict_is_reported_not_ranked',
    Boolean(conflict?.items.some(item => item.verificationState === 'REPORTED' && item.location === 'Sudan')),
    conflict?.items.map(item => `${item.verificationState}:${item.location}`).join(',') ?? 'none',
  ))
  results.push(check(
    'conflict_zones_have_no_invented_geometry',
    panel.zones.every(zone => zone.boundingGeometry === null && /not a battlefield|No geometry/i.test(zone.uncertainty)),
    panel.zones.map(zone => `${zone.name}:${zone.uncertainty}`).join(' | ') || 'no zones',
  ))
  results.push(check(
    'recent_alone_is_not_breaking',
    composeLiveIntelPanel({
      now: NOW,
      news: [{
        id: 'one',
        title: 'Market index closes mixed',
        summary: 'Stocks were mixed.',
        url: 'https://example.com/markets',
        sourceName: 'Bloomberg Markets',
        provider: 'public_rss',
        publishedAt: '2026-09-16T18:50:00.000Z',
        retrievedAt: NOW,
        reliability: 'MEDIUM',
        feedName: 'Bloomberg Markets',
      }],
    }).sections.find(section => section.id === 'BREAKING')?.items.length === 0,
    'single recent article is not breaking',
  ))
  results.push(check(
    'no_location_local_is_no_coverage',
    composeLiveIntelPanel({ now: NOW, objects: [quake()] }).sections.find(section => section.id === 'LOCAL')?.coverageState === 'NO_COVERAGE',
    'LOCAL requires an active Terra location',
  ))
  results.push(check(
    'overlay_skips_items_without_coordinates',
    overlayFeaturesFromPanel(panel, new Set()).every(feature => Number.isFinite(feature.latitude) && Number.isFinite(feature.longitude))
      && intelItemToGeoFeature({
        ...clustered!,
        lat: null,
        lon: null,
      }) === null,
    'news without coordinates is not plotted',
  ))
  const newsItem = headlines?.items[0]
  const handoff = newsItem ? buildTerraCouncilHandoffFromIntelItem({ item: newsItem, commanderPrompt: 'Analyze only the supplied sources.' }) : null
  results.push(check(
    'send_to_council_preserves_sources_without_inventing_coords',
    Boolean(
      newsItem
      && canSendTerraIntelItemToCouncil(newsItem)
      && handoff?.observedFacts.includes('LAYER: Observed Data')
      && handoff.observedFacts.includes(newsItem.sourceUrl ?? 'missing')
      && /COORDINATES: not reported|COORDINATES: -?\d/.test(handoff.observedFacts)
    ),
    handoff?.observedFacts.slice(0, 240) ?? 'no handoff',
  ))
  results.push(check(
    'no_source_url_without_evidence_is_not_verified_intel',
    canSendTerraIntelItemToCouncil({
      ...newsItem!,
      sourceUrl: null,
      relatedEvidenceIds: [],
    }) === false,
    'blocked',
  ))
  const japanese = headlines?.items.find(item => item.originalHeadline === '地震で鉄道に遅れ')
  results.push(check(
    'original_language_is_preserved',
    Boolean(japanese && japanese.originalLanguage === 'ja' && japanese.headline === '地震で鉄道に遅れ' && japanese.originalHeadline === '地震で鉄道に遅れ' && japanese.englishHeadline === null && japanese.translationState === 'ORIGINAL_ONLY'),
    japanese ? `${japanese.originalLanguage}:${japanese.translationState}` : 'missing japanese item',
  ))
  const tokyoPanel = composeLiveIntelPanel({
    now: NOW,
    latitude: 35.676,
    longitude: 139.65,
    place: 'Tokyo',
    news: [{
      id: 'ja-tokyo',
      title: '地震で鉄道に遅れ',
      summary: '首都圏の在来線に遅れが出ています。',
      url: 'https://www.nhk.or.jp/news/quake',
      sourceName: 'NHK',
      provider: 'public_rss',
      publishedAt: '2026-09-16T18:20:00.000Z',
      retrievedAt: NOW,
      reliability: 'HIGH',
      feedName: 'NHK',
      declaredLanguage: 'ja',
    }],
  })
  results.push(check(
    'tokyo_world_time_keeps_native_place_name',
    tokyoPanel.worldTime.nativePlaceName === '東京' && tokyoPanel.worldTime.englishPlaceName === 'Tokyo' && tokyoPanel.scope.label === '東京 / Tokyo',
    `${tokyoPanel.worldTime.nativePlaceName ?? 'none'} ${tokyoPanel.scope.label}`,
  ))
  const tokyoItem = tokyoPanel.sections.find(section => section.id === 'HEADLINES')?.items.find(item => item.originalHeadline === '地震で鉄道に遅れ')
  results.push(check(
    'foreign_headline_is_not_auto_englished',
    Boolean(tokyoItem && tokyoItem.originalHeadline === '地震で鉄道に遅れ' && tokyoItem.englishHeadline === null && tokyoItem.translationState === 'ORIGINAL_ONLY'),
    tokyoItem ? `${tokyoItem.originalHeadline}|${tokyoItem.englishHeadline ?? 'none'}` : 'missing',
  ))
  results.push(check(
    'world_time_for_active_terra_location',
    panel.worldTime.timeZone === 'America/Los_Angeles' && panel.worldClock[0]?.id === 'local',
    `${panel.worldTime.timeZone ?? 'none'} ${panel.worldTime.localTime ?? 'none'}`,
  ))

  const beulahNews = {
    id: 'md-local',
    title: 'Dorchester County schools delay opening after overnight flooding',
    summary: 'Buses in Beulah and surrounding communities are running two hours late.',
    url: 'https://example.com/dorchester-flood',
    sourceName: 'Maryland local desk',
    provider: 'public_rss',
    publishedAt: '2026-09-16T18:20:00.000Z',
    retrievedAt: NOW,
    reliability: 'HIGH' as const,
    feedName: 'Local RSS',
  }
  const whiteHouse = {
    id: 'wh',
    title: 'White House announces new trade talks',
    summary: 'Officials met in Washington.',
    url: 'https://example.com/white-house',
    sourceName: 'ABC News',
    provider: 'public_rss',
    publishedAt: '2026-09-16T18:20:00.000Z',
    retrievedAt: NOW,
    reliability: 'HIGH' as const,
    feedName: 'ABC News',
  }
  const beulahPanel = composeLiveIntelPanel({
    now: NOW,
    latitude: 38.45,
    longitude: -75.93,
    place: 'Beulah, Dorchester County, Maryland',
    city: 'Beulah',
    county: 'Dorchester County',
    state: 'Maryland',
    country: 'United States',
    countryCode: 'US',
    zoomLevel: 'CITY',
    newsCoverage: 'LIVE',
    news: [beulahNews, whiteHouse],
    localIntel: {
      seeds: [{ ...beulahNews, localSourceType: 'NEWSPAPER', localServiceArea: 'Dorchester County', localRelevance: 'County' }],
      coverage: 'SPARSE',
      health: 'ACTIVE',
      mix: [{ key: 'NEWSPAPER', label: 'NEWSPAPER', count: 1 }],
      shortLabel: 'BEULAH, MD',
      rejectedCount: 1,
      reason: 'Healthy local source set queried for BEULAH, MD.',
    },
  })
  const beulahLocal = beulahPanel.sections.find(section => section.id === 'LOCAL')
  const beulahHeadlines = beulahPanel.sections.find(section => section.id === 'HEADLINES')
  results.push(check(
    'beulah_matches_county_and_city_not_publisher_hq',
    Boolean(beulahLocal?.items.some(item => item.id === 'md-local') && !beulahLocal.items.some(item => item.id === 'wh') && (beulahLocal.coverageState === 'LIVE' || beulahLocal.coverageState === 'PARTIAL')),
    beulahLocal?.items.map(item => item.id).join(',') ?? 'none',
  ))
  results.push(check(
    'national_headline_stays_out_of_local',
    Boolean(beulahHeadlines?.items.some(item => item.id === 'wh') && !beulahLocal?.items.some(item => item.id === 'wh')),
    beulahHeadlines?.items.map(item => item.id).join(',') ?? 'none',
  ))
  results.push(check(
    'local_label_uses_compact_place',
    beulahLocal?.label === 'LOCAL · BEULAH, MD',
    beulahLocal?.label ?? 'none',
  ))
  const emptyHealthy = composeLiveIntelPanel({
    now: NOW,
    latitude: 38.45,
    longitude: -75.93,
    place: 'Beulah, Dorchester County, Maryland',
    city: 'Beulah',
    county: 'Dorchester County',
    state: 'Maryland',
    countryCode: 'US',
    zoomLevel: 'CITY',
    newsCoverage: 'LIVE',
    news: [whiteHouse],
    localIntel: {
      seeds: [],
      coverage: 'SPARSE',
      health: 'ACTIVE',
      mix: [],
      shortLabel: 'BEULAH, MD',
      rejectedCount: 3,
      reason: 'Healthy local source set queried for BEULAH, MD; zero qualifying local stories.',
    },
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'healthy_empty_local_shows_sparse_not_bare_zero',
    emptyHealthy?.coverageState === 'LIVE' && emptyHealthy.count === 0 && emptyHealthy.displayCount === 'SPARSE',
    `${emptyHealthy?.coverageState}:${emptyHealthy?.count}:${emptyHealthy?.displayCount}`,
  ))
  const noCoverage = composeLiveIntelPanel({
    now: NOW,
    latitude: 38.45,
    longitude: -75.93,
    city: 'Beulah',
    state: 'Maryland',
    countryCode: 'US',
    localIntel: {
      seeds: [],
      coverage: 'NO_COVERAGE',
      health: 'NO_FEED',
      mix: [],
      shortLabel: 'BEULAH, MD',
      rejectedCount: 0,
      reason: 'No registered local sources for BEULAH, MD.',
    },
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'no_coverage_displays_word_not_zero',
    noCoverage?.coverageState === 'NO_COVERAGE' && noCoverage.displayCount === 'NO_COVERAGE',
    `${noCoverage?.coverageState}:${noCoverage?.displayCount}`,
  ))
  const franceFromAkron = composeLiveIntelPanel({
    now: NOW,
    latitude: 41.0814,
    longitude: -81.519,
    place: 'Akron, Ohio',
    city: 'Akron',
    state: 'Ohio',
    countryCode: 'US',
    news: [{
      id: 'france',
      title: 'Protests continue in France',
      summary: 'Crowds gathered in Paris.',
      url: 'https://example.com/france',
      sourceName: 'WKYC 3 Cleveland',
      provider: 'public_rss',
      publishedAt: '2026-09-16T18:20:00.000Z',
      retrievedAt: NOW,
      reliability: 'HIGH',
      feedName: 'WKYC',
    }],
    localIntel: {
      seeds: [],
      coverage: 'PARTIAL',
      health: 'ACTIVE',
      mix: [],
      shortLabel: 'AKRON, OH',
      rejectedCount: 1,
      reason: 'Healthy local source set queried for AKRON, OH; zero qualifying local stories.',
    },
  })
  results.push(check(
    'akron_station_france_story_is_not_local',
    Boolean(
      franceFromAkron.sections.find(section => section.id === 'HEADLINES')?.items.some(item => item.id === 'france')
      && !franceFromAkron.sections.find(section => section.id === 'LOCAL')?.items.some(item => item.id === 'france'),
    ),
    franceFromAkron.sections.find(section => section.id === 'LOCAL')?.items.map(item => item.id).join(',') ?? 'none',
  ))
  const gpsPanel = composeLiveIntelPanel({
    now: NOW,
    latitude: 38.45,
    longitude: -75.93,
    place: 'GPS ±12 m',
    zoomLevel: 'CITY',
    newsCoverage: 'LIVE',
    news: [beulahNews],
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'gps_label_does_not_match_local_news',
    (gpsPanel?.items.length ?? 0) === 0,
    gpsPanel?.items.map(item => item.id).join(',') ?? 'none',
  ))
  const akronQuake = composeLiveIntelPanel({
    now: NOW,
    latitude: 41.0814,
    longitude: -81.519,
    city: 'Akron',
    state: 'Ohio',
    countryCode: 'US',
    zoomLevel: 'CITY',
    newsCoverage: 'LIVE',
    objects: [quake({ latitude: 41.09, longitude: -81.52 })],
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'akron_geolocated_event_is_nearby',
    Boolean(akronQuake?.items.length && akronQuake.items[0]?.geoRelation === 'NEAR_ACTIVE_POINT' && akronQuake.items[0]?.radiusTier),
    `${akronQuake?.items[0]?.geoRelation}:${akronQuake?.items[0]?.radiusTier}:${akronQuake?.items[0]?.distanceKm}`,
  ))
  const tokyoLocal = composeLiveIntelPanel({
    now: NOW,
    latitude: 35.676,
    longitude: 139.65,
    place: 'Tokyo',
    city: 'Tokyo',
    nativePlaceName: '東京',
    englishPlaceName: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    zoomLevel: 'CITY',
    newsCoverage: 'LIVE',
    news: [{
      id: 'ja-tokyo-local',
      title: '東京で鉄道に遅れ',
      summary: '首都圏の在来線に遅れが出ています。',
      url: 'https://www.nhk.or.jp/news/quake-local',
      sourceName: 'NHK',
      provider: 'public_rss',
      publishedAt: '2026-09-16T18:20:00.000Z',
      retrievedAt: NOW,
      reliability: 'HIGH',
      feedName: 'NHK',
      declaredLanguage: 'ja',
    }],
    localIntel: {
      seeds: [{
        id: 'ja-tokyo-local',
        title: '東京で鉄道に遅れ',
        summary: '首都圏の在来線に遅れが出ています。',
        url: 'https://www.nhk.or.jp/news/quake-local',
        sourceName: 'NHK',
        provider: 'terra_local_source',
        publishedAt: '2026-09-16T18:20:00.000Z',
        retrievedAt: NOW,
        reliability: 'HIGH',
        feedName: 'NHK',
        declaredLanguage: 'ja',
        localSourceType: 'TV',
        localServiceArea: 'Tokyo',
        localRelevance: 'Same city',
      }],
      coverage: 'PARTIAL',
      health: 'ACTIVE',
      mix: [{ key: 'TV', label: 'TV', count: 1 }],
      shortLabel: 'TOKYO',
      rejectedCount: 0,
      reason: 'Local sources serving TOKYO.',
    },
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'tokyo_native_place_matches_local',
    Boolean(tokyoLocal?.items.some(item => item.id === 'ja-tokyo-local')),
    tokyoLocal?.items.map(item => item.id).join(',') ?? 'none',
  ))
  const tokyoRuntimeFailed = composeLiveIntelPanel({
    now: NOW,
    latitude: 35.676,
    longitude: 139.65,
    place: 'Tokyo',
    city: 'Tokyo',
    countryCode: 'JP',
    zoomLevel: 'CITY',
    localIntel: {
      seeds: [],
      coverage: 'NO_COVERAGE',
      health: 'UNAVAILABLE',
      mix: [],
      shortLabel: 'TOKYO',
      rejectedCount: 0,
      reason: 'Tokyo Bousai runtime failed.',
      runtimeHealth: { configured: 1, currentlyHealthy: 0, stale: 0, blocked: 0, unavailable: 1, noFeed: 0 },
    },
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'tokyo_runtime_failure_is_not_usable_coverage',
    Boolean(
      (tokyoRuntimeFailed?.coverageState === 'NO_COVERAGE' || tokyoRuntimeFailed?.coverageState === 'UNAVAILABLE')
      && tokyoRuntimeFailed.runtimeHealth?.currentlyHealthy === 0
      && tokyoRuntimeFailed.runtimeHealth?.unavailable === 1
      && tokyoRuntimeFailed.count === 0
    ),
    `${tokyoRuntimeFailed?.coverageState}:${tokyoRuntimeFailed?.runtimeHealth?.currentlyHealthy}/${tokyoRuntimeFailed?.runtimeHealth?.unavailable}`,
  ))
  const akronBlocked = composeLiveIntelPanel({
    now: NOW,
    latitude: 41.0814,
    longitude: -81.519,
    place: 'Akron',
    city: 'Akron',
    countryCode: 'US',
    zoomLevel: 'CITY',
    localIntel: {
      seeds: [],
      coverage: 'NO_COVERAGE',
      health: 'BLOCKED',
      mix: [],
      shortLabel: 'AKRON, OH',
      rejectedCount: 0,
      reason: 'Beacon Journal blocked.',
      runtimeHealth: { configured: 2, currentlyHealthy: 0, stale: 0, blocked: 1, unavailable: 1, noFeed: 0 },
    },
  }).sections.find(section => section.id === 'LOCAL')
  results.push(check(
    'akron_blocked_source_is_not_usable_coverage',
    (akronBlocked?.coverageState === 'NO_COVERAGE' || akronBlocked?.coverageState === 'AUTH_REQUIRED')
      && akronBlocked.runtimeHealth?.currentlyHealthy === 0
      && (akronBlocked.runtimeHealth?.blocked ?? 0) >= 1,
    `${akronBlocked?.coverageState}:healthy=${akronBlocked?.runtimeHealth?.currentlyHealthy}:blocked=${akronBlocked?.runtimeHealth?.blocked}`,
  ))

  const youtubePanel = composeLiveIntelPanel({
    now: NOW,
    news: [{
      id: 'yt-1',
      title: 'Official briefing clip',
      summary: 'Source-hosted briefing.',
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      sourceName: 'Official desk',
      provider: 'public_rss',
      publishedAt: '2026-09-16T18:20:00.000Z',
      retrievedAt: NOW,
      reliability: 'HIGH',
      feedName: 'Official desk',
    }],
    newsCoverage: 'LIVE',
  })
  const youtubeItem = youtubePanel.sections.find(section => section.id === 'HEADLINES')?.items.find(item => item.id === 'yt-1')
  results.push(check(
    'youtube_source_url_becomes_muted_preview',
    Boolean(youtubeItem?.mediaPreview?.type === 'YT_MUTE_EMBED' && youtubeItem.mediaPreview.youtubeVideoId === 'jNQXAC9IVRw' && youtubeItem.mediaPreview.posterUrl?.includes('jNQXAC9IVRw')),
    youtubeItem?.mediaPreview?.type ?? 'missing',
  ))
  results.push(check(
    'video_does_not_change_honesty',
    youtubeItem?.verificationState == null,
    String(youtubeItem?.verificationState),
  ))
  results.push(check(
    'video_does_not_make_breaking',
    !(youtubePanel.sections.find(section => section.id === 'BREAKING')?.items.some(item => item.id === 'yt-1')),
    'breaking ids: ' + (youtubePanel.sections.find(section => section.id === 'BREAKING')?.items.map(item => item.id).join(',') || 'none'),
  ))
  const publicPanel = composeLiveIntelPanel({
    now: NOW,
    authState: 'AUTH_REQUIRED',
    news: [{
      id: 'priv-yt',
      title: 'Private briefing',
      summary: null,
      url: 'https://example.com/private',
      sourceName: 'Archive',
      provider: 'archive',
      publishedAt: NOW,
      retrievedAt: NOW,
      reliability: 'HIGH',
      mediaPreview: {
        type: 'YT_MUTE_EMBED',
        youtubeVideoId: 'jNQXAC9IVRw',
        posterUrl: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
        previewUrl: 'https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1&mute=1&playsinline=1',
        embedProvider: 'youtube',
        accessClass: 'COMMANDER_PRIVATE',
        provenance: { mediaSourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
      },
    }],
  })
  const privateItem = publicPanel.sections.find(section => section.id === 'HEADLINES')?.items.find(item => item.id === 'priv-yt')
  results.push(check(
    'private_media_stripped_from_public_panel',
    Boolean(privateItem && privateItem.mediaPreview?.type === 'NONE' && !privateItem.mediaPreview.youtubeVideoId && !privateItem.mediaPreview.posterUrl),
    JSON.stringify(privateItem?.mediaPreview),
  ))
  const bbcItem = composeLiveIntelPanel({
    now: NOW,
    news: [{
      id: 'rss-bbc',
      title: 'Parliament opens a new session',
      summary: 'Lawmakers returned.',
      url: 'https://www.bbc.com/news/parliament',
      sourceName: 'BBC World News',
      provider: 'public_rss',
      publishedAt: '2026-09-16T12:00:00.000Z',
      retrievedAt: NOW,
      reliability: 'HIGH',
      feedName: 'BBC World News',
    }],
  }).sections.find(section => section.id === 'HEADLINES')?.items[0]
  results.push(check(
    'normal_row_has_no_fake_poster',
    bbcItem?.mediaPreview?.type === 'NONE' && !bbcItem.mediaPreview.posterUrl,
    bbcItem?.mediaPreview?.type ?? 'missing',
  ))
  const ytHandoff = youtubeItem ? buildTerraCouncilHandoffFromIntelItem({ item: youtubeItem, commanderPrompt: 'Analyze only the supplied sources.' }) : null
  results.push(check(
    'handoff_includes_observed_media_not_analysis',
    Boolean(
      ytHandoff?.observedFacts.includes('MEDIA TYPE: YT_MUTE_EMBED')
      && ytHandoff.observedFacts.includes('YOUTUBE VIDEO ID: jNQXAC9IVRw')
      && ytHandoff.observedFacts.includes('LAYER: Observed Data')
      && /does not confirm the story/i.test(ytHandoff.observedFacts)
      && !/confirmed because a video/i.test(ytHandoff.observedFacts)
    ),
    ytHandoff?.observedFacts.slice(0, 280) ?? 'no handoff',
  ))
  return results
}

export function runLiveIntelPanelValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLiveIntelPanelValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra live intel panel: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
