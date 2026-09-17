import { pathToFileURL } from 'node:url'
import { composeLiveIntelPanel } from './liveIntelPanelModel'
import { buildMediaPreviewFromSource, extractYoutubeVideoIdFromUrl, observedMediaFacts, validateYoutubeChannelId } from './liveIntelMedia'
import { enabledVerifiedVideoSources, videoSourceIsLocalEligible, VERIFIED_VIDEO_SOURCES } from './verifiedVideoSources'
import { parseYoutubeChannelAtomFeed } from './youtubeChannelFeed'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NWS_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>National Weather Service (NWS)</title>
 <entry>
  <id>yt:video:zz3jM6lu7Fs</id>
  <yt:videoId>zz3jM6lu7Fs</yt:videoId>
  <yt:channelId>UC9hQvMjzSxurMirYDgOMezw</yt:channelId>
  <title>El Nino Advisory issued</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/zz3jM6lu7Fs"/>
  <author>
   <name>National Weather Service (NWS)</name>
  </author>
  <published>2026-06-11T14:07:54+00:00</published>
  <media:group>
   <media:description>An El Niño Advisory has been issued.</media:description>
  </media:group>
 </entry>
 <entry>
  <yt:videoId>not-a-real-id</yt:videoId>
  <yt:channelId>UC9hQvMjzSxurMirYDgOMezw</yt:channelId>
  <title>Rejected malformed id</title>
 </entry>
 <entry>
  <yt:videoId>S9i0no6X6sI</yt:videoId>
  <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
  <title>Wrong channel dropped</title>
 </entry>
</feed>`

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const nws = VERIFIED_VIDEO_SOURCES.find(source => source.id === 'nws-youtube')
  results.push(check(
    'nws_channel_independently_confirmed',
    Boolean(nws?.enabled && nws.channelId === 'UC9hQvMjzSxurMirYDgOMezw' && /weather\.gov/i.test(nws.verificationSource)),
    nws?.channelId ?? 'missing',
  ))
  results.push(check(
    'no_guessed_local_tv_channels',
    VERIFIED_VIDEO_SOURCES.every(source => source.geography?.localityScope !== 'LOCAL_SERVICE_AREA' || Boolean(source.geography.serviceArea && source.verificationSource)),
    VERIFIED_VIDEO_SOURCES.map(source => source.id).join(','),
  ))
  results.push(check(
    'local_sources_are_not_national',
    VERIFIED_VIDEO_SOURCES.filter(source => source.geography?.localityScope === 'LOCAL_SERVICE_AREA').every(source => source.geography?.localityScope === 'LOCAL_SERVICE_AREA' && videoSourceIsLocalEligible(source)),
    VERIFIED_VIDEO_SOURCES.filter(source => source.geography?.localityScope === 'LOCAL_SERVICE_AREA').map(source => source.id).join(',') || 'none',
  ))
  results.push(check(
    'enabled_sources_have_valid_channel_ids',
    enabledVerifiedVideoSources().every(source => validateYoutubeChannelId(source.channelId) === source.channelId),
    enabledVerifiedVideoSources().map(source => source.channelId).join(','),
  ))
  results.push(check(
    'national_nws_is_not_local_eligible',
    Boolean(nws && !videoSourceIsLocalEligible(nws)),
    nws?.geography?.localityScope ?? 'missing',
  ))

  const parsed = parseYoutubeChannelAtomFeed(NWS_ATOM, 'UC9hQvMjzSxurMirYDgOMezw')
  results.push(check(
    'atom_extracts_source_video_id',
    parsed.length === 1 && parsed[0]?.videoId === 'zz3jM6lu7Fs' && parsed[0]?.canonicalUrl === 'https://www.youtube.com/watch?v=zz3jM6lu7Fs',
    parsed.map(entry => entry.videoId).join(',') || 'none',
  ))
  results.push(check(
    'atom_drops_malformed_and_mismatched_channel',
    parsed.length === 1,
    String(parsed.length),
  ))
  results.push(check(
    'shorts_url_is_official_youtube_form',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/shorts/zz3jM6lu7Fs') === 'zz3jM6lu7Fs',
    extractYoutubeVideoIdFromUrl('https://www.youtube.com/shorts/zz3jM6lu7Fs') ?? 'none',
  ))
  results.push(check(
    'article_html_url_still_rejected',
    extractYoutubeVideoIdFromUrl('https://www.weather.gov/news/zz3jM6lu7Fs') === null,
    'nws article host rejected',
  ))

  const now = '2026-09-17T03:00:00.000Z'
  const nwsSeed = {
    id: 'yt:nws-youtube:zz3jM6lu7Fs',
    title: 'El Nino Advisory issued',
    summary: 'An El Niño Advisory has been issued.',
    url: 'https://www.youtube.com/watch?v=zz3jM6lu7Fs',
    sourceName: 'National Weather Service (NWS)',
    provider: 'nws_youtube',
    publishedAt: '2026-06-11T14:07:54.000Z',
    retrievedAt: now,
    contentType: 'official_youtube' as const,
    geography: null,
    reliability: 'HIGH' as const,
    feedName: 'National Weather Service (NWS)',
    declaredLanguage: 'en',
    youtubeVideoId: 'zz3jM6lu7Fs',
    intelCategory: 'EARTH' as const,
    verificationState: 'REPORTED' as const,
    mediaPreview: buildMediaPreviewFromSource({
      sourceUrl: 'https://www.youtube.com/watch?v=zz3jM6lu7Fs',
      youtubeVideoId: 'zz3jM6lu7Fs',
      provider: 'nws_youtube',
      retrievedAt: now,
      originalLanguage: 'en',
      officialChannelName: 'National Weather Service (NWS)',
      channelId: 'UC9hQvMjzSxurMirYDgOMezw',
      feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC9hQvMjzSxurMirYDgOMezw',
      verificationSource: 'weather.gov documents youtube.com/usweathergov.',
    }),
  }
  const panel = composeLiveIntelPanel({
    now,
    latitude: 40.272,
    longitude: -81.86,
    place: 'Coshocton, OH',
    city: 'Coshocton',
    county: 'Coshocton County',
    state: 'Ohio',
    country: 'United States',
    countryCode: 'US',
    news: [nwsSeed],
    newsCoverage: 'LIVE',
    localIntel: {
      seeds: [],
      coverage: 'NO_COVERAGE',
      health: 'NO_FEED',
      mix: [],
      shortLabel: 'COSHOCTON, OH',
      rejectedCount: 0,
      reason: 'No local station sources in this fixture.',
    },
  })
  const earthItem = panel.sections.find(section => section.id === 'EARTH')?.items.find(item => item.id === nwsSeed.id)
  const localHasVideo = panel.sections.find(section => section.id === 'LOCAL')?.items.some(item => item.id === nwsSeed.id)
  results.push(check(
    'nws_video_enters_earth_not_local',
    Boolean(earthItem) && !localHasVideo,
    `earth=${Boolean(earthItem)} local=${Boolean(localHasVideo)}`,
  ))
  results.push(check(
    'official_video_is_reported_not_confirmed',
    earthItem?.verificationState === 'REPORTED',
    String(earthItem?.verificationState),
  ))
  results.push(check(
    'official_video_is_yt_mute_embed',
    earthItem?.mediaPreview?.type === 'YT_MUTE_EMBED'
      && earthItem.mediaPreview.youtubeVideoId === 'zz3jM6lu7Fs'
      && earthItem.mediaPreview.posterUrl === 'https://i.ytimg.com/vi/zz3jM6lu7Fs/hqdefault.jpg',
    earthItem?.mediaPreview?.type ?? 'missing',
  ))
  results.push(check(
    'provenance_names_official_channel',
    Boolean(earthItem?.mediaPreview?.provenance.officialChannelName === 'National Weather Service (NWS)'
      && earthItem.mediaPreview.provenance.channelId === 'UC9hQvMjzSxurMirYDgOMezw'
      && observedMediaFacts(earthItem.mediaPreview).some(line => /Official YouTube channel/i.test(line))),
    earthItem?.mediaPreview?.provenance.officialChannelName ?? 'missing',
  ))
  results.push(check(
    'empty_xml_yields_no_runtime_fixtures',
    parseYoutubeChannelAtomFeed('<feed></feed>', 'UC9hQvMjzSxurMirYDgOMezw').length === 0,
    'empty',
  ))

  const crowded = composeLiveIntelPanel({
    now,
    objects: Array.from({ length: 8 }, (_, index) => ({
      id: `usgs-ci${index}`,
      layer: 'intelligence_events' as const,
      type: 'earthquake',
      category: 'hazards',
      title: `M 5.${index} - crowd ${index}`,
      summary: null,
      latitude: 34.05,
      longitude: -118.2,
      observedAt: '2026-09-16T18:50:00.000Z',
      receivedAt: now,
      provider: 'usgs_earthquake_feed',
      publisherFamily: 'USGS',
      sourceFamily: 'usgs_earthquake_feed',
      evidenceId: `usgs-ci${index}`,
      discoveryProvenance: { discoveredVia: 'usgs_earthquake_feed', alsoDiscoveredVia: [], upstreamEngines: [], storageOrigin: null },
      country: 'US',
      region: 'California',
      jurisdiction: null,
      freshness: 'LIVE' as const,
      confidence: null,
      sourceUrl: `https://earthquake.usgs.gov/earthquakes/eventpage/ci${index}`,
      coordinateOrigin: 'observed',
      identityKey: null,
    })),
    news: [nwsSeed],
    newsCoverage: 'LIVE',
  })
  const crowdedEarth = crowded.sections.find(section => section.id === 'EARTH')?.items ?? []
  results.push(check(
    'official_video_survives_earth_cap',
    crowdedEarth.length <= 6 && crowdedEarth.some(item => item.id === nwsSeed.id && item.mediaPreview?.type === 'YT_MUTE_EMBED'),
    crowdedEarth.map(item => item.id).join(','),
  ))
  return results
}

export function runVerifiedVideoIngestionValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runVerifiedVideoIngestionValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra verified video ingestion: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
