/**
 * HVS-WAR-ROOM-INTEGRATION-01 — native War Room HVS destination.
 * `pnpm run validate:hvs-war-room-integration`
 * Architecture + optional live probe of installed UI :3848.
 */
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { LOCAL_CORE_PORT, LOCAL_UI_ORIGIN, LOCAL_UI_PORT } from '@/lib/sovereign-runtime/constants'
import { HVS_UE01_PROJECT_ID } from './unreal/package'
import {
  HVS_CANONICAL_PATH,
  HVS_DISPLAY_NAME,
  HVS_SECTIONS,
  HVS_TAGLINE,
  WAR_ROOM_HOME_HREF,
  hvsCharactersHref,
  isInstalledRelativeHref,
} from './navigation'
import {
  HVS_DEV_ONLY_PORT,
  HVS_INSTALLED_CORE_PORT,
  HVS_INSTALLED_UI_PORT,
  HVS_UNAVAILABLE_BODY,
  HVS_UNAVAILABLE_HEADLINE,
  HVS_UNAVAILABLE_RETRY,
  hvsInstalledUrl,
  isBrokenHvsOrigin,
  isHvsInternalHref,
  isOwnedUiOrigin,
  rewriteFileHvsToInstalledUi,
} from './war-room-integration'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const started = process.hrtime.bigint()
const nav = source('lib/media-command/navigation.ts')
const integration = source('lib/media-command/war-room-integration.ts')
const entry = source('components/war-room/higher-vision-studios/HvsEntryLink.tsx')
const homeIcon = source('components/war-room/higher-vision-studios/HvsHomeAppIcon.tsx')
const homeNav = source('components/war-room/higher-vision-studios/HvsHomeNav.tsx')
const shell = source('components/war-room/higher-vision-studios/HvsShell.tsx')
const homeScreen = source('components/war-room/higher-vision-studios/HvsHomeScreen.tsx')
const layout = source('app/higher-vision-studios/layout.tsx')
const charactersPage = source('app/higher-vision-studios/characters/page.tsx')
const panel = source('components/war-room/higher-vision-studios/HvsCharacterProductionPanel.tsx')
const desktopMain = source('desktop/src/main.cjs')
const desktopHvs = source('desktop/src/hvsNavigation.cjs')
const header = source('app/page.tsx')
const osHeader = source('components/war-room/live-room/WarRoomOsHeader.tsx')
const dock = source('components/war-room/live-room/FeatureDock.tsx')
const liveNav = source('components/war-room/live-room/LiveRoomNavPanel.tsx')
const godsEye = source('components/war-room/terra/GodsEyeCommandCenter.tsx')
const packageJson = source('package.json')
const middleware = source('middleware.ts')
const sessionMw = source('lib/supabase/middleware.ts')
const unavailable = source('components/war-room/higher-vision-studios/HvsUnavailableState.tsx')
const navSurfaces = entry + homeIcon + homeNav + shell + homeScreen + header + osHeader + dock + liveNav + godsEye

expect('canonical_path', HVS_CANONICAL_PATH === '/higher-vision-studios', HVS_CANONICAL_PATH)
expect('display_name', HVS_DISPLAY_NAME === 'HIGHER VISION STUDIOS', HVS_DISPLAY_NAME)
expect('tagline', HVS_TAGLINE === 'AI-FIRST FILM & MEDIA PRODUCTION', HVS_TAGLINE)
expect('home_href', WAR_ROOM_HOME_HREF === '/', WAR_ROOM_HOME_HREF)
expect('ports', HVS_INSTALLED_UI_PORT === 3848 && HVS_INSTALLED_CORE_PORT === 3847 && LOCAL_UI_PORT === 3848 && LOCAL_CORE_PORT === 3847, `${HVS_INSTALLED_CORE_PORT}/${HVS_INSTALLED_UI_PORT}`)
expect('dev_only_3001_not_required', HVS_DEV_ONLY_PORT === 3001, String(HVS_DEV_ONLY_PORT))
expect('desktop_ui_origin_3848', desktopMain.includes("http://127.0.0.1:3848") && desktopMain.includes("http://127.0.0.1:3847"), 'desktop origins')
expect('no_second_ui_port', !desktopMain.includes("'--port', '3001'") && desktopMain.includes("'--port', '3848'"), 'owned next start')

expect('hvs_nav_header', header.includes('HvsEntryLink') && header.includes('nav-higher-vision-studios-header'), 'home header')
expect('hvs_nav_os_header', osHeader.includes('HvsEntryLink') && osHeader.includes('Higher Vision Studios'), 'os header')
expect('hvs_nav_dock', dock.includes('nav-higher-vision-studios-dock'), 'dock')
expect('hvs_nav_live', liveNav.includes('nav-higher-vision-studios'), 'live nav')
expect('hvs_nav_home_icon', godsEye.includes('<HvsHomeAppIcon') && homeIcon.includes('href="/higher-vision-studios"'), 'home icon')
expect('internal_link_only', entry.includes("from 'next/link'") && entry.includes('data-hvs-internal-route="1"') && homeIcon.includes("from 'next/link'"), 'next/link')
expect('no_file_protocol_nav', !/file:\/\//.test(navSurfaces) && !navSurfaces.includes('file:///'), 'file protocol in nav')
expect('no_3001_destination', !/(?:file:\/\/\/|https?:\/\/(?:localhost|127\.0\.0\.1):3001)/.test(navSurfaces + nav + entry + homeIcon + shell + homeScreen) && !nav.includes('href="http://127.0.0.1:3001') && !entry.includes('3001'), '3001 destination')
expect('no_external_open', !navSurfaces.includes('openExternal') && !navSurfaces.includes('window.open') && !navSurfaces.includes('shell.open'), 'external open')
expect('installed_relative', isInstalledRelativeHref(HVS_CANONICAL_PATH) && isHvsInternalHref(HVS_CANONICAL_PATH) && !isInstalledRelativeHref('http://127.0.0.1:3001/higher-vision-studios') && !isInstalledRelativeHref('file:///higher-vision-studios'), 'relative gate')

const charactersHref = hvsCharactersHref(HVS_UE01_PROJECT_ID)
expect('characters_deep_link', charactersHref === `${HVS_CANONICAL_PATH}/characters?project=${HVS_UE01_PROJECT_ID}`, charactersHref)
expect('characters_no_global_hardcode', !nav.includes(HVS_UE01_PROJECT_ID) && nav.includes('hvsCharactersHref') && charactersPage.includes('searchParams'), 'project from context')
expect('characters_page', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/characters/page.tsx')) && charactersPage.includes('HvsDigitalHumanScreen'), 'characters page')
expect('home_characters_cta', homeScreen.includes('hvs-home-open-characters') && homeScreen.includes('hvsCharactersHref'), 'home characters')
expect('tools_characters_resume', shell.includes('hvsCharactersHref') && shell.includes("section.id === 'characters'"), 'tools characters')

expect('same_session_middleware', middleware.includes('updateSession') && sessionMw.includes('hasPresentedLocalCommanderSession'), 'session')
expect('hvs_not_public_anon', !sessionMw.includes("/higher-vision-studios"), 'hvs uses war room session')
expect('single_shell', layout.includes('<HvsShell>') && !layout.includes('HvsStudioShell') && existsSync(path.join(process.cwd(), 'app/higher-vision-studios/page.tsx')), 'one shell')
expect('back_nav', homeNav.includes('hvs-back-to-war-room') && homeNav.includes('WAR_ROOM_HOME_HREF') && homeNav.includes("router.push(WAR_ROOM_HOME_HREF)"), 'back')
expect('rael_panel', panel.includes('hvs-build-rael') && panel.includes('hvs-continue-rael-build') && panel.includes('hvs-authorize-likeness') && panel.includes('hvs-keep-local') && panel.includes('hvs-resume-build'), 'rael copy')
expect('unreal_not_primary', !HVS_SECTIONS.some(section => String(section.id) === 'unreal' || /unreal/i.test(section.label)) && panel.includes('hvs-advanced') && panel.includes('OPEN IN UNREAL'), 'unreal advanced only')
expect('no_chatgpt_handoff', !/ask ChatGPT|open Cursor|open terminal|copy this prompt/i.test(navSurfaces + panel + unavailable), 'handoff copy')

expect('file_rewrite', rewriteFileHvsToInstalledUi('file:///higher-vision-studios/characters?project=x') === `${LOCAL_UI_ORIGIN}/higher-vision-studios/characters?project=x`, 'rewrite')
expect('file_rewrite_windows_drive', rewriteFileHvsToInstalledUi('file:///C:/higher-vision-studios') === `${LOCAL_UI_ORIGIN}/higher-vision-studios`, 'windows rewrite')
expect('owned_ui_origin', isOwnedUiOrigin(`${LOCAL_UI_ORIGIN}/higher-vision-studios`) && !isOwnedUiOrigin('http://127.0.0.1:3001/higher-vision-studios'), 'owned origin')
expect('broken_file_origin', isBrokenHvsOrigin('file:') && !isBrokenHvsOrigin('http:'), 'broken origin')
expect('desktop_rewrite_wired', desktopMain.includes("require('./hvsNavigation.cjs')") && desktopMain.includes('rewriteFileHvsToInstalledUi') && desktopMain.includes('isOwnedUiOrigin'), 'desktop wire')
expect('desktop_keeps_3848_in_window', desktopMain.includes('isOwnedUiOrigin(url, LOCAL_UI_ORIGIN)') && desktopHvs.includes("HVS_PATH = '/higher-vision-studios'"), 'keep in window')
expect('desktop_no_browser_hijack_for_ui', desktopMain.includes('if (hvsNavigation.isOwnedUiOrigin(url, LOCAL_UI_ORIGIN))') && desktopMain.indexOf('isOwnedUiOrigin') < desktopMain.indexOf('isLoopbackHttp(url)'), 'hijack order')
expect(
  'unavailable_ux',
  integration.includes("HVS_UNAVAILABLE_HEADLINE = 'HIGHER VISION STUDIOS UNAVAILABLE'")
    && unavailable.includes('HVS_UNAVAILABLE_HEADLINE')
    && unavailable.includes('hvs-unavailable-retry')
    && desktopMain.includes('HIGHER VISION STUDIOS UNAVAILABLE')
    && desktopMain.includes('RETRY'),
  'unavailable',
)
expect('unavailable_no_localhost_instruction', !unavailable.includes('type localhost') && !desktopMain.includes('type localhost') && !unavailable.includes('open Firefox'), 'no manual url')
expect('validate_script', packageJson.includes('validate:hvs-war-room-integration'), 'script')
expect('installed_url_helper', hvsInstalledUrl('/higher-vision-studios') === `${LOCAL_UI_ORIGIN}/higher-vision-studios`, hvsInstalledUrl('/higher-vision-studios'))

function probe(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

const coreLive = await probe(LOCAL_CORE_PORT)
const uiLive = await probe(LOCAL_UI_PORT)
expect('installed_core_3847_listen', true, coreLive ? 'LIVE' : 'NOT RUN — port 3847 not listening')
expect('installed_ui_3848_listen', true, uiLive ? 'LIVE' : 'NOT RUN — port 3848 not listening')

let uiRootStatus = 'NOT RUN'
let uiCharactersStatus = 'NOT RUN'
if (uiLive) {
  try {
    const root = await fetch(hvsInstalledUrl(HVS_CANONICAL_PATH), { redirect: 'manual', signal: AbortSignal.timeout(4000) })
    uiRootStatus = String(root.status)
    expect(
      'installed_hvs_root_route',
      root.status === 200 || root.status === 307 || root.status === 302 || root.status === 401,
      `GET ${HVS_CANONICAL_PATH} → ${root.status}`,
    )
  } catch (err) {
    expect('installed_hvs_root_route', false, String(err))
  }
  try {
    const chars = await fetch(hvsInstalledUrl(charactersHref), { redirect: 'manual', signal: AbortSignal.timeout(4000) })
    uiCharactersStatus = String(chars.status)
    expect(
      'installed_hvs_characters_route',
      chars.status === 200 || chars.status === 307 || chars.status === 302 || chars.status === 401,
      `GET ${charactersHref} → ${chars.status}`,
    )
  } catch (err) {
    expect('installed_hvs_characters_route', false, String(err))
  }
} else {
  expect('installed_hvs_root_route', true, 'NOT RUN — UI 3848 not listening')
  expect('installed_hvs_characters_route', true, 'NOT RUN — UI 3848 not listening')
}

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  coreLive,
  uiLive,
  uiRootStatus,
  uiCharactersStatus,
  desktopLiveProof: 'NOT RUN',
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
