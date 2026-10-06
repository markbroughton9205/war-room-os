/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/terraMedia/terraMedia.validation.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MediaPlaybackController } from '@/lib/media/playback/controller'
import { getOhioMediaStations } from '@/lib/media/stationRegistry'
import { computeSmartOrganizeLayout } from '@/lib/terra/workspace/layout'
import {
  TERRA_EMERGENCY_REPORT_DEFAULT_SIZE,
  TERRA_MEDIA_DEFAULT_SIZE,
  TERRA_SMART_CLICK_ROUTES,
  TERRA_WORKSPACE_DOCKABLE_IDS,
  TERRA_WORKSPACE_PANEL_IDS,
  TERRA_WORKSPACE_PANEL_TITLE,
  defaultPanelPosition,
} from '@/lib/terra/workspace/panelIds'
import { runIheartFederationValidation } from '@/lib/media/iheart/iheart.validation'
import { TerraWorkspaceLayoutStore } from '@/components/war-room/terra/workspace/terraWorkspaceStore'
import type { TerraLiveIntelItem } from '@/lib/terra/liveIntelPanelModel'
import type { AreaLiveCameraMedia } from '@/lib/terra/godsEye/areaLiveMedia'
import type { WeatherAlert } from '@/lib/terra/weather'
import { composeLiveIntelPanel } from '@/lib/terra/liveIntelPanelModel'
import { resolveTerraMediaAssetState } from './broadcastState'
import { resolveTerraMediaCandidate } from './candidateRouter'
import { TerraMediaStore, getTerraMediaStore } from './store'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-17T19:00:00.000Z'

function alert(partial: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'nws-summit-1',
    event: 'Severe Thunderstorm Warning',
    headline: 'Severe Thunderstorm Warning for Summit County',
    severity: 'Severe',
    urgency: 'Immediate',
    certainty: 'Observed',
    status: 'Actual',
    messageType: 'Alert',
    sent: NOW,
    effective: NOW,
    onset: NOW,
    ends: null,
    expires: null,
    updated: NOW,
    areaDesc: 'Summit, OH',
    instruction: 'Take shelter.',
    description: 'Damaging winds.',
    sourceUrl: 'https://api.weather.gov/alerts/urn:oid:nws-summit-1',
    provider: 'nws_weather',
    affectedZones: [],
    rings: null,
    bbox: null,
    representativePoint: { latitude: 41.08, longitude: -81.52 },
    geometryBasis: 'ZONE',
    lifecycle: 'ACTIVE',
    retrievedAt: NOW,
    liveIntelId: 'nws-summit-1',
    ...partial,
  }
}

function item(partial: Partial<TerraLiveIntelItem> & Pick<TerraLiveIntelItem, 'id' | 'headline' | 'provider'>): TerraLiveIntelItem {
  return {
    category: 'EARTH',
    summary: null,
    originalLanguage: 'en',
    originalHeadline: partial.headline,
    englishHeadline: partial.headline,
    originalSummary: null,
    englishSummary: null,
    translationState: 'ORIGINAL_ONLY',
    translation: null,
    nativeLocationName: null,
    englishLocationName: null,
    timestamp: NOW,
    utcTimestamp: NOW,
    timezone: null,
    localTime: null,
    utcOffset: null,
    dayNightState: null,
    dstActive: null,
    relativeAge: null,
    location: 'Summit County, OH',
    lat: 41.08,
    lon: -81.52,
    source: partial.provider,
    sourceUrl: 'https://example.gov/event',
    confidence: null,
    verificationState: 'REPORTED',
    coverageState: 'LIVE',
    freshnessState: 'RECENT',
    eventType: 'earthquake',
    severity: null,
    relatedTerraEntityIds: [partial.id],
    relatedEvidenceIds: [partial.id],
    retrievedAt: NOW,
    sourceCount: 1,
    sources: [{ name: partial.provider, url: 'https://example.gov/event', provider: partial.provider, publishedAt: NOW }],
    breakingReason: null,
    coordinateOrigin: 'observed',
    ...partial,
  }
}

function cameraMedia(partial: Partial<AreaLiveCameraMedia> = {}): AreaLiveCameraMedia {
  return {
    kind: 'CAMERA_STILL',
    cameraId: 'cam-1',
    intelItemId: null,
    name: 'I-77 camera',
    headline: 'I-77 at I-271',
    provider: 'OHGO',
    providerId: 'ohgo_cameras',
    agency: 'ODOT',
    road: 'I-77',
    location: 'Richfield, OH',
    latitude: 41.24,
    longitude: -81.64,
    catalogStatus: 'LIVE',
    catalogNote: 'catalog poll',
    captureFreshness: 'still_image',
    captureNote: 'still',
    captureTimestamp: NOW,
    retrievedAt: NOW,
    sourceUrl: 'https://ohgo.com/camera/1',
    stillHref: 'https://ohgo.com/camera/1.jpg',
    streamHref: null,
    youtubeVideoId: null,
    hlsUrl: null,
    embedUrl: null,
    posterUrl: null,
    officialViewerUrl: 'https://ohgo.com/camera/1',
    stillPolicy: 'jpeg',
    imageUrlLawful: true,
    originalLanguage: 'en',
    englishHeadline: 'I-77 at I-271',
    verificationState: 'REPORTED',
    publishedAt: NOW,
    ...partial,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const repo = process.cwd()
  const shell = readFileSync(resolve(repo, 'components/war-room/terra/TerraShell.tsx'), 'utf8')
  const host = readFileSync(resolve(repo, 'components/war-room/media/MediaHost.tsx'), 'utf8')
  const launcher = readFileSync(resolve(repo, 'components/war-room/media/MediaLauncher.tsx'), 'utf8')
  const panelSource = readFileSync(resolve(repo, 'components/war-room/terra/TerraMediaPanel.tsx'), 'utf8')
  const emergencySource = readFileSync(resolve(repo, 'components/war-room/terra/TerraEmergencyReportPanel.tsx'), 'utf8')
  const panelIds = readFileSync(resolve(repo, 'lib/terra/workspace/panelIds.ts'), 'utf8')
  const home = readFileSync(resolve(repo, 'app/page.tsx'), 'utf8')
  const godsEye = readFileSync(resolve(repo, 'components/war-room/terra/GodsEyeCommandCenter.tsx'), 'utf8')
  const liveIntelModel = readFileSync(resolve(repo, 'lib/terra/liveIntelPanelModel.ts'), 'utf8')
  const featureDock = readFileSync(resolve(repo, 'components/war-room/live-room/FeatureDock.tsx'), 'utf8')
  const playbackController = readFileSync(resolve(repo, 'lib/media/playback/controller.ts'), 'utf8')

  results.push(check(
    'terra_media_registered',
    (TERRA_WORKSPACE_PANEL_IDS as readonly string[]).includes('terra_media') && TERRA_WORKSPACE_PANEL_TITLE.terra_media === 'War Room Media',
    TERRA_WORKSPACE_PANEL_IDS.join(','),
  ))
  results.push(check(
    'terra_media_dockable',
    TERRA_WORKSPACE_DOCKABLE_IDS.includes('terra_media'),
    TERRA_WORKSPACE_DOCKABLE_IDS.join(','),
  ))
  results.push(check(
    'terra_media_default_position_on_screen',
    defaultPanelPosition('terra_media', 1920, 1080).x > 1000
      && defaultPanelPosition('terra_media', 1920, 1080).x + TERRA_MEDIA_DEFAULT_SIZE.width < 1920
      && TERRA_MEDIA_DEFAULT_SIZE.width < 1920
      && TERRA_MEDIA_DEFAULT_SIZE.height < 1080,
    JSON.stringify(defaultPanelPosition('terra_media', 1920, 1080)),
  ))
  results.push(check(
    'home_feature_dock_does_not_register_terra_media',
    !/id: 'terra_media'/.test(featureDock) && !/id: 'media'/.test(featureDock),
    'FeatureDock has no terra_media dock id',
  ))
  results.push(check(
    'headerLauncherMounted_does_not_control_panel_ids',
    !panelIds.includes('headerLauncherMounted') && launcher.includes('setHeaderLauncherMounted') && launcher.includes('openOrFocus'),
    'shared flag remains launcher-only; rail uses workspace openOrFocus',
  ))
  results.push(check(
    'terra_rail_launcher_targets_terra_media_panel',
    launcher.includes('TERRA_MEDIA_PANEL_ID') && launcher.includes('data-terra-media-launcher="rail"') && launcher.includes('openOrFocus'),
    'rail launcher opens terra_media',
  ))
  results.push(check(
    'terra_rail_launcher_ensures_station_without_launch',
    launcher.includes('activateFromCommanderRail')
      && /const activate = \(\) => \{\s*if \(workspace\) \{\s*launchWorkspacePanel\(\)\s*controller\.activateFromCommanderRail\(\)\s*return/.test(launcher),
    'rail opens terra_media then treats the click as a Commander playback gesture',
  ))
  const dock = readFileSync(resolve(repo, 'components/war-room/terra/CommanderAgentDock.tsx'), 'utf8')
  results.push(check(
    'media_launcher_always_present_independent_of_terra_media_closed',
    launcher.includes('data-terra-media-launcher-persistent="true"')
      && !/if \(terraClosed\) return null/.test(launcher)
      && !/if \(terraMinimized\) return null/.test(launcher)
      && dock.includes('<MediaLauncher variant="dock" layout="rail"')
      && dock.includes('data-terra-media-launcher-host="commander-rail"')
      && /placement="rail"/.test(shell)
      && host.includes('commander-rail-owns-launcher')
      && host.includes('media-host-terra-suppressed'),
    'launcher stays mounted when terra_media is closed; MediaHost only suppresses floating players',
  ))
  results.push(check(
    'commander_dock_does_not_gate_launcher_on_panel_state',
    dock.includes('Never gate this on panel closed')
      && dock.includes('<MediaLauncher variant="dock" layout="rail" />'),
    'CommanderAgentDock always mounts MediaLauncher for rail placement',
  ))
  results.push(check(
    'ensure_station_priority_current_then_persisted_then_registry_default',
    /ensureStationSelected\(\) \{\s*if \(this\.state\.station\) return\s*this\.hydrateSession\(\)\s*if \(this\.state\.station\) return\s*const fallback = this\.stations\[0\]/.test(playbackController),
    'current → last-selected → getOhioMediaStations()[0]',
  ))
  results.push(check(
    'rail_gesture_starts_or_resumes_without_restarting_playing',
    /activateFromCommanderRail\(\) \{\s*this\.ensureStationSelected\(\)\s*if \(this\.state\.playbackState === 'playing' \|\| this\.state\.playbackState === 'loading'\) return\s*this\.playFromCommanderGesture\(\)/.test(playbackController),
    'paused/idle rail click plays; playing rail click does not restart',
  ))
  results.push(check(
    'terra_media_panel_has_full_compact_minimize',
    panelSource.includes('data-terra-media-chrome="compact"')
      && panelSource.includes('data-testid="terra-media-full"')
      && panelSource.includes('data-testid="terra-media-compact-toggle"')
      && panelSource.includes('data-testid="terra-media-minimize"')
      && panelSource.includes('setPlayerChrome(TERRA_MEDIA_PANEL_ID')
      && panelSource.includes('setMinimized(TERRA_MEDIA_PANEL_ID, true)')
      && panelSource.includes('data-terra-media-fullscreen="false"')
      && !panelSource.includes('CompactMediaPlayer')
      && !panelSource.includes('MediaWindow')
      && !/inset-0|w-screen|h-screen|100vw|100vh/.test(panelSource),
    'compact is terra_media chrome, not a second player or fullscreen takeover',
  ))
  results.push(check(
    'full_player_has_search_filters_and_browser',
    panelSource.includes('data-testid="terra-media-search"')
      && panelSource.includes('data-testid="terra-media-geo-filters"')
      && panelSource.includes('StationBrowser')
      && panelSource.includes('NowPlaying')
      && !panelSource.includes('Emergency Report')
      && !panelSource.includes('terra-media-emergency-report'),
    'full player is the media browser, not an emergency report',
  ))
  results.push(check(
    'emergency_report_is_separate_workspace_panel',
    (TERRA_WORKSPACE_PANEL_IDS as readonly string[]).includes('terra_emergency_report')
      && TERRA_WORKSPACE_PANEL_TITLE.terra_emergency_report === 'Emergency Report'
      && TERRA_WORKSPACE_DOCKABLE_IDS.includes('terra_emergency_report')
      && TERRA_SMART_CLICK_ROUTES.emergency_media.primary === 'terra_emergency_report'
      && TERRA_SMART_CLICK_ROUTES.emergency_media.secondary.includes('terra_media')
      && /<TerraWorkspacePanel id="terra_emergency_report"/.test(shell)
      && emergencySource.includes('data-testid="terra-emergency-report-panel"')
      && emergencySource.includes('openOrFocus(TERRA_MEDIA_PANEL_ID')
      && emergencySource.includes('playFromCommanderGesture'),
    TERRA_SMART_CLICK_ROUTES.emergency_media.primary,
  ))
  results.push(check(
    'emergency_listen_does_not_live_in_media_panel',
    !panelSource.includes('data-testid="terra-media-listen"') && emergencySource.includes('data-testid="terra-media-listen"'),
    'listen lives on emergency panel',
  ))
  results.push(check(
    'full_player_default_size_is_panel_not_fullscreen',
    TERRA_MEDIA_DEFAULT_SIZE.width === 720 && TERRA_MEDIA_DEFAULT_SIZE.height === 540 && TERRA_EMERGENCY_REPORT_DEFAULT_SIZE.width === 336,
    JSON.stringify(TERRA_MEDIA_DEFAULT_SIZE),
  ))
  results.push(check(
    'media_host_suppresses_floating_surfaces_on_terra',
    host.includes("pathname === '/terra'") && host.includes('media-host-terra-suppressed') && host.includes('dismissFloatingPresentation'),
    'MediaWindow/CompactMediaPlayer are not mounted on /terra',
  ))
  results.push(check(
    'terra_media_panel_is_closable',
    /<TerraWorkspacePanel id="terra_media"[^>]*closable/.test(shell),
    'terra_media panel uses workspace close, not a second window',
  ))
  results.push(check(
    'terra_shell_mounts_terra_media_only_outside_command_center',
    /\{!commandCenter && \(\s*<TerraWorkspacePanel id="terra_media"/.test(shell)
      && !/\{commandCenter && \(\s*<TerraWorkspacePanel id="terra_media"/.test(shell),
    'command-center must not destroy registration; it simply does not mount the panel',
  ))
  results.push(check(
    'home_gods_eye_is_command_center_not_full_workspace',
    godsEye.includes('presentation="command-center"') && !home.includes('id="terra_media"'),
    'Home does not leak the Terra Media workspace panel',
  ))
  results.push(check(
    'official_youtube_freshness_not_live_from_fetch',
    /contentType === 'official_youtube'/.test(liveIntelModel) && /officialYoutubeFeedFreshness/.test(liveIntelModel) && !/official_youtube'\) return seed\.fromCache \? 'CACHED' : 'LIVE'/.test(liveIntelModel),
    'youtube freshness helper present',
  ))

  const organized = computeSmartOrganizeLayout({
    panels: {
      live_intel: { x: 10, y: 10, vw: 1600, vh: 1000, locked: false, minimized: false, dock: 'float' },
      terra_media: { x: 20, y: 20, vw: 1600, vh: 1000, locked: false, minimized: false, dock: 'float' },
    },
    sizes: { live_intel: { width: 320, height: 200 }, terra_media: { width: 336, height: 280 } },
    viewportWidth: 1600,
    viewportHeight: 1000,
  })
  results.push(check(
    'smart_organize_includes_terra_media',
    organized.some(row => row.id === 'terra_media' && row.x > 0 && row.y >= 8),
    JSON.stringify(organized.filter(row => row.id === 'terra_media')),
  ))
  const crowded = computeSmartOrganizeLayout({
    panels: {
      nearby_cameras: { x: 8, y: 200, vw: 1600, vh: 1000, locked: false, minimized: false, dock: 'left' },
      terra_media: { x: 8, y: 210, vw: 1600, vh: 1000, locked: false, minimized: false, dock: 'left' },
    },
    sizes: { nearby_cameras: { width: 320, height: 180 }, terra_media: { width: 336, height: 280 } },
    viewportWidth: 1600,
    viewportHeight: 1000,
  })
  const nearbyOrg = crowded.find(row => row.id === 'nearby_cameras')
  const mediaOrg = crowded.find(row => row.id === 'terra_media')
  results.push(check(
    'smart_organize_separates_terra_media_from_nearby_cameras',
    Boolean(nearbyOrg && mediaOrg && (nearbyOrg.x + 320 <= mediaOrg.x || mediaOrg.x + 336 <= nearbyOrg.x || nearbyOrg.y + 180 <= mediaOrg.y || mediaOrg.y + 280 <= nearbyOrg.y)),
    JSON.stringify({ nearbyOrg, mediaOrg }),
  ))

  const store = new TerraWorkspaceLayoutStore()
  const viewport = { width: 1600, height: 1000 }
  const size = { width: 336, height: 280 }
  store.ensurePanel('terra_media', viewport, size)
  store.ensurePanel('terra_emergency_report', viewport, size)
  store.setMinimized('terra_emergency_report', true)
  store.setMinimized('terra_media', true)
  store.notifyInteraction('emergency_media', viewport, {})
  const afterMin = store.getSnapshot()
  results.push(check(
    'smart_open_off_pulses_minimized_emergency_report_without_auto_open',
    afterMin.panels.terra_emergency_report?.minimized === true && afterMin.attention.terra_emergency_report?.reason === 'emergency_media',
    JSON.stringify(afterMin.attention.terra_emergency_report),
  ))
  results.push(check(
    'emergency_secondary_terra_media_gets_attention_only',
    afterMin.panels.terra_media?.minimized === true && afterMin.attention.terra_media?.reason === 'emergency_media',
    JSON.stringify(afterMin.attention.terra_media),
  ))
  store.setMinimized('terra_media', false)
  results.push(check(
    'restore_clears_attention',
    store.getSnapshot().attention.terra_media === undefined && store.getSnapshot().panels.terra_media?.minimized === false,
    'attention after restore',
  ))
  store.setSmartOpenEnabled(true)
  store.setMinimized('terra_emergency_report', true)
  store.notifyInteraction('emergency_media', viewport, { terra_emergency_report: size })
  results.push(check(
    'smart_open_restores_emergency_report_as_primary',
    store.getSnapshot().panels.terra_emergency_report?.minimized === false && TERRA_SMART_CLICK_ROUTES.emergency_media.primary === 'terra_emergency_report',
    `minimized=${store.getSnapshot().panels.terra_emergency_report?.minimized}`,
  ))
  store.persistNow()
  results.push(check(
    'layout_persistence_key_includes_terra_media_after_ensure',
    typeof store.getSnapshot().panels.terra_media === 'object',
    JSON.stringify(store.getSnapshot().panels.terra_media),
  ))
  store.reset(viewport)
  results.push(check(
    'workspace_reset_recovers_terra_media',
    Boolean(store.getSnapshot().panels.terra_media) && store.getSnapshot().panels.terra_media?.minimized === false,
    JSON.stringify(store.getSnapshot().panels.terra_media),
  ))
  results.push(check(
    'terra_media_defaults_closed',
    store.getSnapshot().panels.terra_media?.closed === true,
    JSON.stringify(store.getSnapshot().panels.terra_media),
  ))
  results.push(check(
    'terra_emergency_report_defaults_closed',
    store.getSnapshot().panels.terra_emergency_report?.closed === true,
    JSON.stringify(store.getSnapshot().panels.terra_emergency_report),
  ))

  const launchStore = new TerraWorkspaceLayoutStore()
  launchStore.openOrFocus('terra_media', viewport, size)
  results.push(check(
    'open_or_focus_opens_closed_terra_media',
    launchStore.getSnapshot().panels.terra_media?.closed === false && launchStore.getSnapshot().panels.terra_media?.minimized === false,
    JSON.stringify(launchStore.getSnapshot().panels.terra_media),
  ))
  const zAfterOpen = launchStore.getSnapshot().zOrder.filter(id => id === 'terra_media').length
  launchStore.openOrFocus('terra_media', viewport, size)
  results.push(check(
    'open_or_focus_does_not_duplicate_panel',
    zAfterOpen === 1 && launchStore.getSnapshot().zOrder.filter(id => id === 'terra_media').length === 1 && Object.keys(launchStore.getSnapshot().panels).filter(id => id === 'terra_media').length === 1,
    JSON.stringify(launchStore.getSnapshot().zOrder),
  ))
  launchStore.setMinimized('terra_media', true)
  launchStore.openOrFocus('terra_media', viewport, size)
  results.push(check(
    'open_or_focus_restores_minimized_terra_media',
    launchStore.getSnapshot().panels.terra_media?.minimized === false && launchStore.getSnapshot().zOrder.at(-1) === 'terra_media',
    JSON.stringify(launchStore.getSnapshot().panels.terra_media),
  ))
  launchStore.closePanel('terra_media')
  results.push(check(
    'close_hides_terra_media',
    launchStore.getSnapshot().panels.terra_media?.closed === true,
    JSON.stringify(launchStore.getSnapshot().panels.terra_media),
  ))
  launchStore.openOrFocus('terra_media', viewport, size)
  results.push(check(
    'open_or_focus_reopens_closed_terra_media',
    launchStore.getSnapshot().panels.terra_media?.closed === false && launchStore.getSnapshot().zOrder.at(-1) === 'terra_media',
    JSON.stringify(launchStore.getSnapshot().panels.terra_media),
  ))

  const nws = resolveTerraMediaCandidate({ weatherAlert: alert(), nowIso: NOW })
  results.push(check(
    'nws_severe_creates_unavailable_candidate_without_inventing_stream',
    Boolean(nws && nws.family === 'NWS' && nws.mediaState === 'UNAVAILABLE' && nws.autoplay === false && !nws.watchUrl?.includes('invent')),
    JSON.stringify(nws && { family: nws.family, state: nws.mediaState, autoplay: nws.autoplay }),
  ))
  const nwsMinor = resolveTerraMediaCandidate({ weatherAlert: alert({ severity: 'Minor', sourceUrl: null }), nowIso: NOW })
  results.push(check('nws_minor_without_media_is_not_forced', nwsMinor === null, nwsMinor?.id ?? 'null'))

  const usgs = resolveTerraMediaCandidate({
    intelItem: item({ id: 'usgs-1', headline: 'M 4.2 earthquake', provider: 'usgs_earthquake_feed', eventType: 'earthquake' }),
    nowIso: NOW,
  })
  results.push(check('usgs_official_source_creates_candidate', usgs?.family === 'USGS' && usgs.mediaState === 'UNAVAILABLE', usgs?.family ?? 'null'))

  const eonet = resolveTerraMediaCandidate({
    intelItem: item({ id: 'eonet-1', headline: 'Wildfire', provider: 'nasa_eonet', eventType: 'wildfire_incident' }),
    nowIso: NOW,
  })
  results.push(check('eonet_creates_candidate', eonet?.family === 'EONET', eonet?.family ?? 'null'))

  const firms = resolveTerraMediaCandidate({
    intelItem: item({ id: 'firms-1', headline: 'Thermal anomaly', provider: 'nasa_firms', eventType: 'wildfire_incident' }),
    nowIso: NOW,
  })
  results.push(check('firms_creates_candidate', firms?.family === 'FIRMS', firms?.family ?? 'null'))

  const gdacs = resolveTerraMediaCandidate({
    intelItem: item({ id: 'gdacs-1', headline: 'Flood', provider: 'gdacs', eventType: 'flood_event' }),
    nowIso: NOW,
  })
  results.push(check('gdacs_creates_candidate', gdacs?.family === 'GDACS', gdacs?.family ?? 'null'))

  const unverified = resolveTerraMediaCandidate({
    intelItem: item({
      id: 'rumor-1',
      headline: 'Unverified clip',
      provider: 'random_blog',
      eventType: 'news',
      verificationState: 'UNVERIFIED',
      sourceUrl: null,
      sources: [],
      mediaPreview: { type: 'NONE', accessClass: 'PUBLIC', provenance: {} },
    }),
    nowIso: NOW,
  })
  results.push(check('unverified_without_source_is_rejected', unverified === null, unverified?.id ?? 'null'))

  const recorded = resolveTerraMediaCandidate({
    intelItem: item({
      id: 'yt-nws',
      headline: 'NWS briefing',
      provider: 'nws_youtube',
      eventType: 'news',
      verificationState: 'REPORTED',
      sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      mediaPreview: {
        type: 'YT_MUTE_EMBED',
        youtubeVideoId: 'jNQXAC9IVRw',
        previewUrl: 'https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1&mute=1&playsinline=1',
        accessClass: 'PUBLIC',
        provenance: { mediaSourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', retrievedAt: NOW },
      },
    }),
    nowIso: NOW,
  })
  results.push(check(
    'verified_youtube_is_recorded_not_live',
    recorded?.mediaState === 'RECORDED' && recorded.liveEvidence === null,
    recorded?.mediaState ?? 'null',
  ))

  const liveCam = resolveTerraMediaCandidate({
    areaLive: cameraMedia({ kind: 'CAMERA_STREAM', captureFreshness: 'live_video', streamHref: 'https://example.gov/live.m3u8' }),
    nowIso: NOW,
  })
  results.push(check(
    'camera_live_video_is_live',
    liveCam?.mediaState === 'LIVE' && liveCam.liveEvidence === 'CAMERA_LIVE_VIDEO_STREAM',
    liveCam?.mediaState ?? 'null',
  ))
  results.push(check(
    'camera_catalog_live_still_is_not_broadcast_live',
    resolveTerraMediaCandidate({ areaLive: cameraMedia(), nowIso: NOW })?.mediaState === 'RECORDED',
    resolveTerraMediaCandidate({ areaLive: cameraMedia(), nowIso: NOW })?.mediaState ?? 'null',
  ))

  const unknownHls = resolveTerraMediaAssetState({ hasMedia: true, previewType: 'HLS_MUTE' })
  results.push(check('unknown_hls_is_not_live', unknownHls.state === 'UNKNOWN', unknownHls.state))
  results.push(check(
    'recent_poster_is_recent_not_live',
    resolveTerraMediaAssetState({ hasMedia: true, previewType: 'POSTER', publishedAt: NOW, nowIso: NOW }).state === 'RECENT',
    resolveTerraMediaAssetState({ hasMedia: true, previewType: 'POSTER', publishedAt: NOW, nowIso: NOW }).state,
  ))
  results.push(check(
    'old_poster_without_live_evidence_is_unknown',
    resolveTerraMediaAssetState({ hasMedia: true, previewType: 'POSTER', publishedAt: '2020-01-01T00:00:00.000Z', nowIso: NOW }).state === 'UNKNOWN',
    resolveTerraMediaAssetState({ hasMedia: true, previewType: 'POSTER', publishedAt: '2020-01-01T00:00:00.000Z', nowIso: NOW }).state,
  ))
  results.push(check(
    'freshness_only_youtube_asset_not_live',
    resolveTerraMediaAssetState({ hasMedia: true, previewType: 'YT_MUTE_EMBED', youtubeVideoId: 'jNQXAC9IVRw', publishedAt: NOW }).state === 'RECORDED',
    'recorded',
  ))
  results.push(check(
    'source_declared_live_is_live',
    resolveTerraMediaAssetState({ hasMedia: true, previewType: 'HLS_MUTE', liveEvidence: 'SOURCE_DECLARED_LIVE' }).state === 'LIVE',
    'live',
  ))
  const feedPick = resolveTerraMediaCandidate({
    intelFeed: [
      item({ id: 'usgs-feed', headline: 'M 4.2 earthquake', provider: 'usgs_earthquake_feed', eventType: 'earthquake' }),
      item({
        id: 'yt-feed',
        headline: 'NWS briefing',
        provider: 'nws_youtube',
        eventType: 'news',
        sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        mediaPreview: {
          type: 'YT_MUTE_EMBED',
          youtubeVideoId: 'jNQXAC9IVRw',
          previewUrl: 'https://www.youtube.com/embed/jNQXAC9IVRw?autoplay=1&mute=1&playsinline=1',
          accessClass: 'PUBLIC',
          provenance: { mediaSourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', retrievedAt: NOW },
        },
      }),
    ],
    nowIso: NOW,
  })
  results.push(check(
    'intel_feed_prefers_verified_media_over_bare_event',
    Boolean(feedPick?.id.includes('yt-feed') && feedPick.mediaState === 'RECORDED'),
    feedPick?.id ?? 'null',
  ))

  const mediaStore = new TerraMediaStore()
  const queued = mediaStore.queue(nws!)
  results.push(check('queue_does_not_set_autoplay', queued && mediaStore.getSnapshot().candidate?.autoplay === false, String(mediaStore.getSnapshot().candidate?.autoplay)))
  results.push(check('duplicate_event_does_not_requeue', mediaStore.queue(nws!) === false, 'dup'))

  const playback = new MediaPlaybackController()
  playback.autoSelectStation('oh-waps', 'WEATHER_ALERT')
  results.push(check(
    'auto_select_never_plays',
    playback.getState().playbackState === 'paused' || playback.getState().playbackState === 'idle',
    playback.getState().playbackState,
  ))
  const beforePlay = playback.getState().playbackState
  void playback.play()
  results.push(check(
    'play_without_commander_gesture_stays_silent',
    playback.getState().playbackState === beforePlay || playback.getState().playbackState === 'paused' || playback.getState().playbackState === 'idle',
    playback.getState().playbackState,
  ))
  const terraPlayback = new MediaPlaybackController()
  terraPlayback.setTerraWorkspaceSurfaceActive(true)
  terraPlayback.autoSelectStation('oh-waps', 'WEATHER_ALERT')
  terraPlayback.launch()
  results.push(check(
    'terra_workspace_surface_does_not_spawn_floating_player',
    terraPlayback.getState().presentation !== 'compact' && terraPlayback.getState().presentation !== 'window',
    terraPlayback.getState().presentation,
  ))
  terraPlayback.setTerraWorkspaceSurfaceActive(false)
  const defaultStation = getOhioMediaStations()[0]
  const railSelect = new MediaPlaybackController()
  railSelect.setTerraWorkspaceSurfaceActive(true)
  railSelect.ensureStationSelected()
  results.push(check(
    'terra_rail_ensure_station_uses_registry_default',
    Boolean(defaultStation && railSelect.getState().station?.id === defaultStation.id),
    railSelect.getState().station?.id ?? 'null',
  ))
  results.push(check(
    'terra_rail_ensure_station_is_paused',
    railSelect.getState().playbackState === 'paused',
    railSelect.getState().playbackState,
  ))
  results.push(check(
    'terra_rail_ensure_station_does_not_spawn_floating_player',
    railSelect.getState().presentation !== 'compact' && railSelect.getState().presentation !== 'window',
    railSelect.getState().presentation,
  ))
  const beforeEnsurePlay = railSelect.getState().playbackState
  void railSelect.play()
  results.push(check(
    'terra_rail_ensure_station_does_not_autoplay',
    railSelect.getState().playbackState === beforeEnsurePlay,
    railSelect.getState().playbackState,
  ))
  railSelect.selectStation('oh-wjcu')
  railSelect.ensureStationSelected()
  results.push(check(
    'terra_rail_keeps_current_station_over_default',
    railSelect.getState().station?.id === 'oh-wjcu',
    railSelect.getState().station?.id ?? 'null',
  ))
  const pausedRail = new MediaPlaybackController()
  pausedRail.setTerraWorkspaceSurfaceActive(true)
  pausedRail.ensureStationSelected()
  const pausedBefore = pausedRail.getState().playbackState
  pausedRail.activateFromCommanderRail()
  results.push(check(
    'rail_click_while_paused_authorizes_playback_gesture',
    pausedBefore === 'paused' && pausedRail.getState().station?.id === defaultStation?.id,
    `${pausedBefore} → ${pausedRail.getState().playbackState}`,
  ))
  const playingRail = new MediaPlaybackController()
  playingRail.setTerraWorkspaceSurfaceActive(true)
  playingRail.selectStation('oh-waps')
  playingRail.activateFromCommanderRail()
  const afterFirst = playingRail.getState().station?.id
  playingRail.activateFromCommanderRail()
  results.push(check(
    'rail_click_while_already_activated_keeps_station',
    afterFirst === 'oh-waps' && playingRail.getState().station?.id === 'oh-waps',
    playingRail.getState().station?.id ?? 'null',
  ))
  results.push(check(
    'rail_activation_does_not_spawn_floating_player',
    playingRail.getState().presentation !== 'compact' && playingRail.getState().presentation !== 'window',
    playingRail.getState().presentation,
  ))
  const silentBoot = new MediaPlaybackController()
  results.push(check(
    'fresh_controller_is_silent_before_rail',
    silentBoot.getState().playbackState === 'idle' && silentBoot.getState().station === null,
    silentBoot.getState().playbackState,
  ))
  results.push(check(
    'browser_store_helper_exists',
    typeof getTerraMediaStore === 'function',
    'getTerraMediaStore',
  ))

  const youtubePanel = composeLiveIntelPanel({
    now: NOW,
    news: [{
      id: 'official-yt',
      title: 'Official briefing clip',
      summary: null,
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      sourceName: 'National Weather Service (NWS)',
      provider: 'nws_youtube',
      publishedAt: NOW,
      retrievedAt: NOW,
      contentType: 'official_youtube',
      reliability: 'HIGH',
    }],
  })
  const officialYt = youtubePanel.sections.flatMap(section => section.items).find(row => row.id === 'official-yt')
  results.push(check(
    'live_intel_official_youtube_freshness_is_not_live',
    Boolean(officialYt && officialYt.freshnessState !== 'LIVE' && (officialYt.freshnessState === 'RECENT' || officialYt.freshnessState === 'STALE' || officialYt.freshnessState === 'CACHED')),
    officialYt?.freshnessState ?? 'missing',
  ))
  const rssPanel = composeLiveIntelPanel({
    now: NOW,
    news: [{
      id: 'rss-live-trap',
      title: 'Just fetched headline',
      summary: null,
      url: 'https://www.bbc.com/news/just-fetched',
      sourceName: 'BBC World News',
      provider: 'public_rss',
      publishedAt: NOW,
      retrievedAt: NOW,
      reliability: 'HIGH',
    }],
  })
  const rssRow = rssPanel.sections.flatMap(section => section.items).find(row => row.id === 'rss-live-trap')
  results.push(check(
    'rss_recency_is_recent_not_live',
    rssRow?.freshnessState === 'RECENT',
    rssRow?.freshnessState ?? 'missing',
  ))

  results.push(...runIheartFederationValidation())

  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`Terra Media validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

export { run }
