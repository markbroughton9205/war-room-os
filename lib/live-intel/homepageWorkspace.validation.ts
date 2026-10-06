/**
 * Homepage workspace / Live Intel / minimizable session validation.
 * Runs via:
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/live-intel/homepageWorkspace.validation.ts`
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { composeLiveIntel, unreadLiveIntelCount } from './composeLiveIntel'
import {
  getLiveIntelStoreSnapshot,
  publishLiveIntelItem,
  resetLiveIntelStore,
} from './liveIntelStore'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const now = '2026-09-19T20:00:00.000Z'

const idle = composeLiveIntel({ presencePhase: 'idle', now })
expect(
  'idle_does_not_invent_world_or_ai_news',
  !idle.items.some(item => item.source === 'world' || item.source === 'ai-news'),
  idle.items.map(item => item.source).join(','),
)
expect(
  'idle_does_not_invent_foundry_events',
  !idle.items.some(item => item.source === 'foundry'),
  idle.items.map(item => item.id).join(','),
)
expect(
  'idle_unread_is_zero',
  idle.unreadCount === 0 && unreadLiveIntelCount(idle.items) === 0,
  String(idle.unreadCount),
)
expect(
  'idle_war_room_badge_connected_without_fake_count',
  idle.badges.find(badge => badge.source === 'war-room')?.connected === true
    && idle.badges.find(badge => badge.source === 'war-room')?.count === 0,
  JSON.stringify(idle.badges.find(badge => badge.source === 'war-room')),
)
expect(
  'idle_world_badge_is_disconnected',
  idle.badges.find(badge => badge.source === 'world')?.connected === false
    && idle.badges.find(badge => badge.source === 'world')?.count === 0,
  JSON.stringify(idle.badges.find(badge => badge.source === 'world')),
)

const researching = composeLiveIntel({
  presencePhase: 'researching',
  liveResearchHud: {
    mode: 'active',
    sourcesCount: 3,
    label: 'Gathering live sources',
  },
  terraNote: 'Active Terra location: Cleveland',
  sourcesPreview: 'usgs.gov · weather.gov',
  now,
})
expect(
  'research_item_is_real_hud_label',
  researching.items.some(item => item.id === 'research:hud' && item.title === 'Gathering live sources'),
  researching.items.map(item => item.id).join(','),
)
expect(
  'terra_item_only_when_note_exists',
  researching.items.some(item => item.source === 'terra' && item.message.includes('Cleveland')),
  researching.items.filter(item => item.source === 'terra').map(item => item.message).join('|'),
)
expect(
  'no_highlighted_fake_headline',
  researching.highlighted?.source !== 'world' && researching.highlighted?.source !== 'ai-news',
  researching.highlighted?.source ?? 'null',
)
expect(
  'compose_without_hud_omits_research',
  !composeLiveIntel({ presencePhase: 'idle', now }).items.some(item => item.source === 'research'),
  'research leaked into idle snapshot',
)

resetLiveIntelStore()
expect('store_starts_empty', getLiveIntelStoreSnapshot().extras.length === 0 && getLiveIntelStoreSnapshot().toasts.length === 0, JSON.stringify(getLiveIntelStoreSnapshot()))
publishLiveIntelItem({
  id: 'foundry:pass-006',
  source: 'foundry',
  severity: 'operational',
  title: 'Build validation completed.',
  message: 'PASS-006',
  timestamp: now,
  read: false,
  toastEligible: true,
  metadata: { id: 'PASS-006' },
}, { toast: true })
expect('store_does_not_self_seed', getLiveIntelStoreSnapshot().extras.length === 1, String(getLiveIntelStoreSnapshot().extras.length))
expect('toast_only_from_publish', getLiveIntelStoreSnapshot().toasts.length === 1, String(getLiveIntelStoreSnapshot().toasts.length))
const withExtra = composeLiveIntel({
  presencePhase: 'idle',
  extraItems: getLiveIntelStoreSnapshot().extras,
  now,
})
expect('published_foundry_item_appears', withExtra.items.some(item => item.id === 'foundry:pass-006'), withExtra.items.map(item => item.id).join(','))
resetLiveIntelStore()

const shell = source('components/war-room/live-room/LiveRoomShell.tsx')
expect(
  'live_intel_no_longer_reserves_17rem_column',
  !shell.includes('xl:grid-cols-[16rem_minmax(0,1fr)_17rem]') && !shell.includes('_17rem]'),
  '17rem right column still present',
)
expect(
  'workspace_grid_is_sessions_plus_main',
  shell.includes('md:grid-cols-[16rem_minmax(0,1fr)]') && shell.includes("data-layout={showLeft ? 'sessions-workspace' : 'workspace'}"),
  'layout marker missing',
)
expect(
  'inspector_is_overlay_not_column',
  shell.includes('showInspector') && shell.includes('absolute inset-y-0 right-0'),
  'inspector overlay missing',
)

const page = source('app/page.tsx')
expect(
  'live_intel_moved_to_intel_row',
  page.includes('intelRow={(') && page.includes('<CommanderLiveIntelRail'),
  'rail not wired to intelRow',
)
expect(
  'live_intel_not_permanent_right_panel',
  !page.includes(') : (\n              <CommanderLiveIntelRail'),
  'rail still in rightPanel else branch',
)

const rail = source('components/war-room/live-room/CommanderLiveIntelRail.tsx')
expect('live_intel_toggle_exists', rail.includes('data-testid="live-intel-toggle"') && rail.includes('aria-expanded={open}'), 'toggle missing')
expect('live_intel_drawer_exists', rail.includes('data-testid="live-intel-drawer"') && rail.includes("event.key === 'Escape'"), 'drawer/escape missing')
expect('live_intel_empty_feed_copy', rail.includes('No intelligence feed connected.'), 'empty state missing')
expect('live_intel_not_a_marquee', !rail.includes('marquee') && !rail.includes('animate-pulse') && !/ticker/i.test(rail), 'ticker/marquee found')

const godsEye = source('components/war-room/terra/GodsEyeCommandCenter.tsx')
expect(
  'minimize_control_exists',
  godsEye.includes('data-testid="gods-eye-minimize"') && godsEye.includes('Minimize conversation'),
  'minimize control missing',
)
expect(
  'minimize_does_not_unmount_conversation',
  !godsEye.includes("chatMode !== 'minimized' ?") && godsEye.includes('{council}') && godsEye.includes('inert={minimized ? true : undefined}'),
  'conversation still conditionally unmounted',
)
expect(
  'restore_dock_exists',
  godsEye.includes('<MinimizedSessionDock'),
  'dock wiring missing',
)
expect('restore_testid_on_dock_component', source('components/war-room/live-room/MinimizedSessionDock.tsx').includes('data-testid="restore-conversation"'), 'restore control missing')
expect(
  'workspace_reflow_flex_sibling',
  godsEye.includes('data-testid="gods-eye-workspace"') && godsEye.includes("chatMode === 'minimized'") && godsEye.includes('flex-[0_0_0]'),
  'workspace reflow missing',
)
expect(
  'conversation_no_longer_overlays_terra',
  !godsEye.includes("left-[42%]") && !godsEye.includes('pointer-events-none absolute z-40'),
  'overlay positioning still present',
)

const preview = source('components/war-room/terra/TerraHomeGlobePreview.tsx')
const earth3d = source('components/war-room/terra/TerraHomeEarth3D.tsx')
const earthRenderer = source('components/war-room/terra/terraHomeEarth/earthRenderer.ts')
const earthMaterials = source('components/war-room/terra/terraHomeEarth/earthMaterials.ts')
const earthQuality = source('components/war-room/terra/terraHomeEarth/earthQuality.ts')
const earthAssets = source('components/war-room/terra/terraHomeEarth/earthAssets.ts')
const homeEarthSources = [preview, earth3d, earthRenderer, earthMaterials, earthQuality, earthAssets].join('\n')
expect(
  'terra_preview_no_longer_reserves_overlay_column',
  !preview.includes("gridTemplateColumns: '42% 58%'"),
  '42/58 overlay split still present',
)
expect(
  'terra_preview_is_lightweight_3d_not_full_shell',
  !homeEarthSources.includes('TerraShell')
    && !homeEarthSources.includes('loadCesium')
    && !homeEarthSources.includes("from 'cesium'")
    && !homeEarthSources.includes("from 'globe.gl'")
    && earthRenderer.includes("from 'three'")
    && earthRenderer.includes('SphereGeometry')
    && earthRenderer.includes('WebGLRenderer'),
  'homepage globe missing lightweight three renderer or loaded Cesium/TerraShell',
)
expect(
  'terra_preview_activity_governor',
  preview.includes('useApplicationActivity') && preview.includes("mode === 'HOME_ACTIVE'") && preview.includes('activity.visible'),
  'homepage globe activity pause missing',
)
expect(
  'terra_preview_keeps_entry_and_truth_label',
  preview.includes('terra-home-enter-button') && preview.includes('EARTH_STATUS_LABEL') && preview.includes('EARTH_VISUAL_LABEL') && !preview.includes('Terra · Live'),
  'homepage Terra entry/truth labels missing',
)
expect(
  'terra_preview_webgl_fallback',
  preview.includes('3D_RENDER_UNAVAILABLE') && preview.includes('css-fallback') && preview.includes('TerraHomeGlobeCssFallback'),
  'WebGL fallback missing',
)
expect(
  'terra_home_earth_assets_are_local_nasa',
  earthAssets.includes('/terra/home-earth') && earthAssets.includes('public-domain') && earthAssets.includes('day-2k.jpg') && existsSync(path.join(process.cwd(), 'public/terra/home-earth/ATTRIBUTION.md')),
  'local NASA earth assets missing',
)
expect(
  'terra_home_earth_quality_governor',
  earthQuality.includes("'ECO'") && earthQuality.includes("'BALANCED'") && earthQuality.includes("'CINEMATIC'") && earthQuality.includes('maxDpr'),
  'quality governor missing',
)
expect(
  'terra_home_earth_axial_tilt',
  earthQuality.includes('23.4') && earthRenderer.includes('EARTH_AXIAL_TILT_RAD'),
  'axial tilt missing',
)

const foundryHomeIcon = source('components/war-room/foundry/FoundryHomeAppIcon.tsx')
const foundryNav = source('lib/native-builder/foundryNavigation.ts')
const foundryIconPath = path.join(process.cwd(), 'public/foundry/foundry-icon.png')
expect(
  'foundry_home_icon_png_exists',
  existsSync(foundryIconPath),
  foundryIconPath,
)
expect(
  'foundry_home_icon_png_is_exact_saved_bytes',
  existsSync(foundryIconPath) && createHash('sha256').update(readFileSync(foundryIconPath)).digest('hex') === '518f23e879728385ca2a9bfc1a48fceba6753ad8830a5e9b425cf0710f05d6a1',
  existsSync(foundryIconPath) ? createHash('sha256').update(readFileSync(foundryIconPath)).digest('hex') : 'missing',
)
expect(
  'foundry_home_icon_uses_saved_src',
  foundryNav.includes("FOUNDRY_HOME_ICON_SRC = '/foundry/foundry-icon.png'") && foundryHomeIcon.includes('FOUNDRY_HOME_ICON_SRC'),
  'icon src constant missing',
)
expect(
  'foundry_home_icon_reuses_existing_navigation',
  foundryHomeIcon.includes('FoundryEntryLink') && foundryNav.includes("FOUNDRY_CANONICAL_PATH = '/war-room/engineering'"),
  'FoundryEntryLink / canonical path not reused',
)
expect(
  'foundry_home_icon_accessible',
  foundryHomeIcon.includes('ariaLabel="Open Foundry"') && foundryHomeIcon.includes('alt="Foundry"'),
  'aria/alt missing',
)
expect(
  'foundry_home_icon_is_css_dom_animation',
  !foundryHomeIcon.includes('WebGL') && !foundryHomeIcon.includes('requestAnimationFrame') && !foundryHomeIcon.includes('<canvas') && foundryHomeIcon.includes('foundry-home-app-icon-glyph'),
  'heavy animation runtime detected',
)
expect(
  'foundry_home_icon_on_home_workspace_not_replacing_terra',
  godsEye.includes('<FoundryHomeAppIcon') && godsEye.includes('<TerraHomeGlobePreview') && !godsEye.includes('<FoundryShell'),
  'Foundry home launcher missing or Terra/Foundry shell collision',
)
expect(
  'foundry_home_icon_pauses_when_hidden',
  foundryHomeIcon.includes("data-forge-motion={motion}") && foundryHomeIcon.includes("mode === 'HOME_ACTIVE'") && foundryHomeIcon.includes('activity.visible'),
  'visibility pause missing',
)

const css = source('app/globals.css')
const terraGlobeCss = source('app/terra-home-globe.css')
const pageStyles = source('app/page.tsx')
expect(
  'reduced_motion_covers_new_chrome',
  (css.includes('.live-intel-motion') || pageStyles.includes('.live-intel-motion'))
    && css.includes('.foundry-home-app-icon')
    && terraGlobeCss.includes('.terra-home-globe-orbit')
    && (css.includes('prefers-reduced-motion') || terraGlobeCss.includes('prefers-reduced-motion') || pageStyles.includes('prefers-reduced-motion')),
  'reduced motion missing',
)
expect(
  'terra_preview_living_earth_grade',
  terraGlobeCss.includes('.terra-home-earth-canvas') && terraGlobeCss.includes('.terra-home-globe-atmosphere') && terraGlobeCss.includes('.terra-home-globe-pulse') && earthMaterials.includes('ATMOSPHERE_FRAGMENT') && earthMaterials.includes('oceanBlue') && earthMaterials.includes('vegTeal'),
  '3D earth atmosphere/pulse missing',
)
expect(
  'terra_preview_spin_is_operational',
  earthQuality.includes('EARTH_SPIN_PERIOD_SEC = 90') && earthQuality.includes('EARTH_HOME_YAW_RAD'),
  'homepage earth spin/yaw missing',
)
expect(
  'terra_preview_reduced_motion',
  preview.includes("prefers-reduced-motion: reduce") && terraGlobeCss.includes("data-terra-motion='reduced'") && terraGlobeCss.includes('terra-home-globe-orbit'),
  'homepage globe reduced motion missing',
)

const hvsHomeIcon = source('components/war-room/higher-vision-studios/HvsHomeAppIcon.tsx')
const hvsNav = source('lib/media-command/navigation.ts')
const hvsIconPath = path.join(process.cwd(), 'public/hvs/higher-vision-studios-icon.png')
const hvsAnimatedPath = path.join(process.cwd(), 'public/hvs/higher-vision-studios-icon-animated.webp')
const hvsGifPath = path.join(process.cwd(), 'public/hvs/higher-vision-studios-icon-animated.gif')
expect(
  'hvs_canonical_path_is_not_media',
  hvsNav.includes("HVS_CANONICAL_PATH = '/higher-vision-studios'") && !hvsNav.includes("HVS_CANONICAL_PATH = '/media'"),
  'HVS path collided with War Room Media',
)
expect(
  'hvs_home_icon_on_home_workspace_not_replacing_terra_or_foundry',
  godsEye.includes('<HvsHomeAppIcon') && godsEye.includes('<FoundryHomeAppIcon') && godsEye.includes('<TerraHomeGlobePreview'),
  'HVS home launcher missing or colliding',
)
expect(
  'hvs_home_icon_accessible',
  hvsHomeIcon.includes('aria-label="Open Higher Vision Studios"') && source('components/war-room/higher-vision-studios/HvsStudioMark.tsx').includes('hvs-home-app-icon-mark'),
  'HVS aria missing',
)
expect(
  'hvs_home_icon_png_exists',
  existsSync(hvsIconPath),
  hvsIconPath,
)
expect(
  'hvs_home_icon_png_is_exact_saved_bytes',
  existsSync(hvsIconPath) && createHash('sha256').update(readFileSync(hvsIconPath)).digest('hex') === '3bcac97d79b74bdca663dfbe342db4676506b47b6d65ba5cad8fb9f13b6048ff',
  existsSync(hvsIconPath) ? createHash('sha256').update(readFileSync(hvsIconPath)).digest('hex') : 'missing',
)
expect(
  'hvs_home_icon_uses_saved_src_archive',
  hvsNav.includes("HVS_HOME_ICON_SRC = '/hvs/higher-vision-studios-icon.png'"),
  'HVS archived icon src constant missing',
)
expect(
  'hvs_home_icon_uses_studio_mark',
  hvsHomeIcon.includes('HvsStudioMark') && source('components/war-room/higher-vision-studios/HvsStudioMark.tsx').includes('hvs-studio-mark-lens') && source('components/war-room/higher-vision-studios/HvsStudioMark.tsx').includes('hvs-studio-mark-timeline'),
  'studio mark missing',
)
expect(
  'hvs_home_icon_tv_is_not_primary',
  !hvsHomeIcon.includes('HVS_HOME_ICON_SRC') && !hvsHomeIcon.includes('HVS_HOME_ICON_ANIMATED_SRC') && !hvsHomeIcon.includes('<img'),
  'TV/png still primary homepage visual',
)
expect(
  'hvs_home_icon_animated_assets_exist',
  existsSync(hvsAnimatedPath) && existsSync(hvsGifPath),
  `webp=${existsSync(hvsAnimatedPath)} gif=${existsSync(hvsGifPath)}`,
)
expect(
  'hvs_home_icon_is_css_dom',
  !hvsHomeIcon.includes('WebGL') && !hvsHomeIcon.includes('requestAnimationFrame') && !hvsHomeIcon.includes('<canvas'),
  'HVS heavy animation runtime detected',
)
expect(
  'hvs_reduced_motion',
  css.includes('.hvs-home-app-icon') && css.includes("data-hvs-motion='reduced'") && hvsHomeIcon.includes("mode === 'HOME_ACTIVE'") && css.includes('.hvs-studio-mark-iris'),
  'HVS reduced motion missing',
)

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, total: results.length }))
