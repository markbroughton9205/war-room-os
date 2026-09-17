import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isLocalDesktopCommanderRuntime, resolveLocalCommanderUserId } from './commanderSessionPolicy'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const COMMANDER_UUID = '11111111-1111-4111-8111-111111111111'
const LOCAL_ID = 'lid_local_commander_1'
const SOURCE = readFileSync(resolve('lib/security/commanderSession.ts'), 'utf8')

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    'loopback_local_session_maps_to_configured_commander',
    resolveLocalCommanderUserId({
      loopbackOk: true,
      localIdentityId: LOCAL_ID,
      linkedRemoteUserId: null,
      configuredCommanderUserId: COMMANDER_UUID,
    }) === COMMANDER_UUID,
    'valid wr_local_session on loopback is the Commander for Terra APIs',
  ))

  results.push(check(
    'linked_remote_uuid_preferred_when_it_matches',
    resolveLocalCommanderUserId({
      loopbackOk: true,
      localIdentityId: LOCAL_ID,
      linkedRemoteUserId: COMMANDER_UUID,
      configuredCommanderUserId: COMMANDER_UUID,
    }) === COMMANDER_UUID,
    'linked remote identity is used when it is the configured Commander',
  ))

  results.push(check(
    'local_identity_used_when_commander_uuid_is_not_configured',
    resolveLocalCommanderUserId({
      loopbackOk: true,
      localIdentityId: LOCAL_ID,
      linkedRemoteUserId: null,
      configuredCommanderUserId: null,
    }) === LOCAL_ID,
    'offline local Commander does not require WAR_ROOM_COMMANDER_USER_ID',
  ))

  results.push(check(
    'non_loopback_never_counts_as_local_commander',
    resolveLocalCommanderUserId({
      loopbackOk: false,
      localIdentityId: LOCAL_ID,
      linkedRemoteUserId: COMMANDER_UUID,
      configuredCommanderUserId: COMMANDER_UUID,
    }) === null,
    'public hosts cannot use wr_local_session as Commander',
  ))

  results.push(check(
    'desktop_runtime_includes_packaged_and_desktop_surface',
    isLocalDesktopCommanderRuntime({ WAR_ROOM_PACKAGED: '1' })
      && isLocalDesktopCommanderRuntime({ WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL' })
      && !isLocalDesktopCommanderRuntime({}),
    'DESKTOP_LOCAL and PACKAGED both count as local desktop runtime',
  ))

  results.push(check(
    'session_reads_bearer_or_cookie',
    SOURCE.includes('extractBearerOrCookieToken') && SOURCE.includes('LOCAL_SESSION_COOKIE'),
    'Terra APIs verify the same wr_local_session cookie/bearer as local-auth',
  ))

  results.push(check(
    'local_session_is_not_gated_only_on_packaged_flag',
    SOURCE.includes('readLoopbackLocalCommander')
      && SOURCE.includes('extractBearerOrCookieToken')
      && !SOURCE.includes('function readPackagedDesktopCommander'),
    'installed 3848 and DEV 3001 share loopback local Commander continuity',
  ))

  results.push(check(
    'middleware_does_not_blanket_401_live_intel',
    readFileSync(resolve('lib/supabase/middleware.ts'), 'utf8').includes("'/api/terra/live-intel'"),
    'live-intel GET reaches the route so public Earth/RSS can return 200',
  ))

  results.push(check(
    'live_intel_and_layers_still_call_requireCommanderSession',
    readFileSync(resolve('app/api/terra/live-intel/route.ts'), 'utf8').includes("requireCommanderSession('Terra live intel')")
      && readFileSync(resolve('app/api/terra/layers/[layerId]/route.ts'), 'utf8').includes("requireCommanderSession('Terra layer data')")
      && readFileSync(resolve('app/api/terra/resolve-location/route.ts'), 'utf8').includes("requireCommanderSession('Terra location resolution')"),
    'Terra live-intel, layers, and resolve-location still invoke Commander session (403 stays blocked; 401 can serve public feeds)',
  ))
  results.push(check(
    'camera_image_still_invokes_commander_session_for_403',
    readFileSync(resolve('app/api/terra/camera-image/route.ts'), 'utf8').includes("requireCommanderSession('Terra camera image proxy')")
      && readFileSync(resolve('app/api/terra/camera-image/route.ts'), 'utf8').includes('isPublicTerraLayer')
      && readFileSync(resolve('app/api/terra/urban-tiles/route.ts'), 'utf8').includes("requireCommanderSession('Terra urban geography')"),
    'camera-image: 403 still blocks; 401 can serve public stills. urban-tiles stay session-gated.',
  ))
  results.push(check(
    'middleware_does_not_blanket_401_public_camera_stills',
    readFileSync(resolve('lib/supabase/middleware.ts'), 'utf8').includes("'/api/terra/camera-image'"),
    'camera-image GET reaches the route so public stills are not middleware-401',
  ))

  const middlewareSource = readFileSync(resolve('lib/supabase/middleware.ts'), 'utf8')
  const layersSource = readFileSync(resolve('app/api/terra/layers/[layerId]/route.ts'), 'utf8')
  const cookieSource = readFileSync(resolve('lib/sovereign-runtime/local-ownership/sessionCookie.ts'), 'utf8')
  results.push(check(
    'middleware_does_not_blanket_401_public_geocode_or_public_layers',
    middlewareSource.includes("'/api/terra/resolve-location'")
      && middlewareSource.includes("'/api/terra/layers/'"),
    'Nominatim search and public hazard layers reach their routes',
  ))
  results.push(check(
    'protected_layers_remain_session_gated_in_route',
    layersSource.includes('isPublicTerraLayer') && layersSource.includes('return commander.response'),
    'non-public Terra layers still 401/403 after middleware exemption',
  ))
  results.push(check(
    'loopback_html_canonicalizes_to_127',
    readFileSync(resolve('components/war-room/LoopbackCanonicalHost.tsx'), 'utf8').includes("next.hostname = '127.0.0.1'")
      && readFileSync(resolve('app/layout.tsx'), 'utf8').includes('LoopbackCanonicalHost'),
    'client host replace; Next middleware Location relativizes same-loopback origins',
  ))
  results.push(check(
    'session_cookie_is_host_only_http_only_lax',
    cookieSource.includes("sameSite: 'lax'") && cookieSource.includes('httpOnly: true') && cookieSource.includes('secure: false') && !cookieSource.includes('domain:'),
    'wr_local_session host-only, not Domain-scoped',
  ))

  const requireFn = SOURCE.indexOf('export async function requireCommanderSession')
  results.push(check(
    'loopback_local_session_is_evaluated_before_supabase',
    requireFn >= 0
      && SOURCE.indexOf('const local = await readLoopbackLocalCommander()', requireFn)
        < SOURCE.indexOf('createSupabaseServerClient()', requireFn),
    'valid wr_local_session cannot be 403ed by a leftover remote cookie',
  ))

  results.push(check(
    'login_page_keeps_local_bootstrap_on_loopback',
    readFileSync(resolve('app/login/page.tsx'), 'utf8').includes('if (remoteUser && !loopback)'),
    'remote Supabase cookie does not skip Local Commander bootstrap UI',
  ))

  results.push(check(
    'middleware_preserves_terra_next_on_login_redirect',
    readFileSync(resolve('lib/supabase/middleware.ts'), 'utf8').includes("loginUrl.searchParams.set('next', current)"),
    'unauthenticated protected pages return after local login',
  ))

  results.push(check(
    'terra_page_is_public_for_provider_auth_cameras',
    readFileSync(resolve('lib/supabase/middleware.ts'), 'utf8').includes("'/terra'"),
    '/terra loads without wr_local_session; Commander-private APIs stay route-gated',
  ))

  results.push(check(
    'terra_chip_uses_auth_required_not_unauthenticated',
    readFileSync(resolve('components/war-room/terra/TerraCommanderSessionChip.tsx'), 'utf8').includes('AUTH_REQUIRED')
      && readFileSync(resolve('components/war-room/terra/TerraCommanderSessionChip.tsx'), 'utf8').includes('BOOTSTRAP_REQUIRED')
      && !readFileSync(resolve('components/war-room/terra/TerraCommanderSessionChip.tsx'), 'utf8').includes('UNAUTHENTICATED'),
    'chip states AUTHENTICATED / AUTH_REQUIRED / BOOTSTRAP_REQUIRED',
  ))

  results.push(check(
    'dev_binds_canonical_loopback_host',
    readFileSync(resolve('package.json'), 'utf8').includes('next dev --port 3001 --hostname 127.0.0.1'),
    'DEV advertises 127.0.0.1 not localhost',
  ))

  return results
}

export function runCommanderSessionValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCommanderSessionValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Commander session continuity: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
