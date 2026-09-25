/**
 * PASS 012 CDP fallback governance: localhost bind, target scope, broker-only,
 * expected-state, audit without secrets. Does not expose arbitrary CDP JS.
 */
import { pathToFileURL } from 'node:url'
import { networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  isAllowedWarRoomCdpTarget,
  REMOTE_DEBUGGING_ADDRESS,
  WAR_ROOM_UI_ORIGIN,
} from './foundryComputerUseCdp'
import { discoverWarRoomCdpOrigin, readDesktopCdpRuntime, WAR_ROOM_CDP_ADDRESS } from './foundryDesktopCdp'
import { COMPUTER_TOOL_NAMES } from './foundryComputerUse'
import { actionSuccessIsNotStateSuccess } from './foundryComputerUseGeometry'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function lanCdpUnreachable(): Promise<{ pass: boolean; detail: string }> {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter((item): item is NonNullable<typeof item> => Boolean(item && item.family === 'IPv4' && !item.internal))
    .map(item => item.address)
  if (!addresses.length) return { pass: true, detail: 'no LAN IPv4 to probe; loopback-only bind still required in source' }
  const discovered = await discoverWarRoomCdpOrigin()
  const persisted = readDesktopCdpRuntime()
  const ports = [...new Set([discovered?.port, persisted?.cdpPort].filter((port): port is number => Number.isInteger(port) && (port as number) > 0))]
  if (!ports.length) return { pass: true, detail: 'no War Room CDP port claimed yet; loopback-only bind still required in source' }
  const probes = await Promise.all(addresses.flatMap(ip => ports.map(async port => {
    try {
      const res = await fetch(`http://${ip}:${port}/json/version`, { signal: AbortSignal.timeout(800) })
      return { ip, port, reachable: res.ok }
    } catch {
      return { ip, port, reachable: false }
    }
  })))
  const leaked = probes.filter(item => item.reachable)
  return { pass: leaked.length === 0, detail: JSON.stringify(probes) }
}

async function run() {
  const root = resolveRepoRoot()
  const main = await readFile(`${root}/desktop/src/main.cjs`, 'utf8')
  const installer = await readFile(`${root}/lib/native-builder/installerTool.ts`, 'utf8')
  const runtime = await readFile(`${root}/lib/native-builder/runtimeControl.ts`, 'utf8')
  const cdp = await readFile(`${root}/lib/native-builder/foundryComputerUseCdp.ts`, 'utf8')
  const computer = await readFile(`${root}/lib/native-builder/foundryComputerUse.ts`, 'utf8')
  const catalog = await readFile(`${root}/lib/native-builder/foundryToolCatalog.ts`, 'utf8')

  const results: CaseResult[] = []
  results.push(check(
    'cdp_loopback_only',
    REMOTE_DEBUGGING_ADDRESS === '127.0.0.1'
      && WAR_ROOM_CDP_ADDRESS === '127.0.0.1'
      && /REMOTE_DEBUGGING_ADDRESS = '127\.0\.0\.1'/.test(main)
      && installer.includes('--remote-debugging-address=127.0.0.1')
      && runtime.includes('--remote-debugging-address=127.0.0.1')
      && /claimWarRoomCdpEndpoint/.test(main)
      && !/--remote-debugging-port=9222/.test(installer)
      && !/--remote-debugging-port=9222/.test(runtime)
      && !/listen\([^)]*0\.0\.0\.0/.test(cdp)
      && !/remote-debugging-address['", ]+0\.0\.0\.0/.test(main),
    `address=${REMOTE_DEBUGGING_ADDRESS}`,
  ))
  const lan = await lanCdpUnreachable()
  results.push(check('cdp_lan_unreachable', lan.pass, lan.detail))
  results.push(check(
    'cdp_tool_broker_only',
    !(COMPUTER_TOOL_NAMES as readonly string[]).some(name => /cdp|evaluate|javascript/i.test(name))
      && !/computer\.cdp|computer\.evaluate|Runtime\.evaluate/.test(catalog)
      && /clickAccessibleInInstalledUi/.test(computer),
    COMPUTER_TOOL_NAMES.join(','),
  ))
  results.push(check(
    'cdp_wrong_origin_rejected',
    isAllowedWarRoomCdpTarget({ type: 'page', url: 'https://example.com/', title: 'War Room' }).ok === false
      && isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://192.168.1.10:3848/', title: 'War Room' }).ok === false,
    JSON.stringify({
      example: isAllowedWarRoomCdpTarget({ type: 'page', url: 'https://example.com/', title: 'War Room' }),
      lan: isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://192.168.1.10:3848/', title: 'War Room' }),
    }),
  ))
  results.push(check(
    'cdp_wrong_app_rejected',
    isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9222/', title: 'Cursor' }).ok === false
      && isAllowedWarRoomCdpTarget({ type: 'page', url: 'chrome-devtools://devtools/bundled/inspector.html', title: 'DevTools' }).ok === false
      && isAllowedWarRoomCdpTarget({ type: 'page', url: `${WAR_ROOM_UI_ORIGIN}/war-room/engineering`, title: 'War Room OS' }).ok === true,
    JSON.stringify({
      cursor: isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9222/', title: 'Cursor' }),
      warRoom: isAllowedWarRoomCdpTarget({ type: 'page', url: `${WAR_ROOM_UI_ORIGIN}/war-room/engineering`, title: 'War Room OS' }),
    }),
  ))
  results.push(check(
    'cdp_no_first_page_fallback',
    /pages\.find\(item => isAllowedWarRoomCdpTarget/.test(cdp) && !/pages\[0\]\?\.webSocketDebuggerUrl \?\? null/.test(cdp),
    'strict origin match; first page is not attached',
  ))
  results.push(check(
    'cdp_expected_state_required',
    actionSuccessIsNotStateSuccess(true, false) === true
      && computer.includes('afterCdp')
      && computer.includes('waitForExpected')
      && /viaCdp\.ok && afterCdp\.ok/.test(computer),
    'CDP ACTION_SUCCESS is not STATE_SUCCESS',
  ))
  results.push(check(
    'cdp_audit_fields',
    /missionId/.test(cdp) && /targetSemanticName/.test(cdp) && /pageOriginClass/.test(cdp) && /expectedNextState/.test(cdp) && /engineer: computer.cdp_fallback/.test(cdp),
    'audit contract present',
  ))
  results.push(check(
    'cdp_no_secret_logging',
    /cookie|token|secret|password|authorization|desktop.?trust/.test(cdp)
      && /\[REDACTED\]/.test(cdp)
      && !/document\.documentElement\.outerHTML/.test(cdp),
    'secret keys redacted; no full DOM',
  ))
  results.push(check(
    'atspi_remains_first',
    /activate_control[\s\S]{0,400}clickAccessibleInInstalledUi/.test(computer)
      && computer.includes("activationMethod = 'AT_SPI_ACTION'"),
    'AT-SPI before CDP inside clickAndWait',
  ))
  results.push(check(
    'cdp_after_atspi_state_failure',
    computer.includes('actionSuccessIsNotStateSuccess') && computer.includes('clickAccessibleInInstalledUi'),
    'CDP only after AT-SPI expected-state failure',
  ))
  results.push(check(
    'coordinate_fallback_last',
    computer.includes('SEMANTIC_BOUNDS_CLICK') && computer.includes('COORDINATE_FALLBACK') && computer.includes('EXPLICIT_COORDINATE_FALLBACK refused for required control'),
    'bounds then global x/y last; required controls refuse hardcoded x/y',
  ))
  results.push(check(
    'arbitrary_js_not_exposed',
    !/executeArbitrary|eval\(/.test(catalog) && !/computer\.js/.test(catalog),
    'no generic CDP JS tool',
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry PASS 012 CDP governance: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCdpGovernanceValidation }
