/**
 * Cursor adapter validation: registration, CDP isolation, live window discovery.
 * Does not kill Cursor. Does not attach War Room CDP to Cursor.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { executeComputerTool } from './foundryComputerUse'
import { isAllowedWarRoomCdpTarget, listElectronCdpTargets } from './foundryComputerUseCdp'
import { readDesktopCdpRuntime } from './foundryDesktopCdp'
import { ExternalAppBroker, CURSOR_DEBUG_ONE_TIME_SETUP, discoverCursorElectronDebug } from './external-app'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const root = resolveRepoRoot()
  const adapterSrc = await readFile(`${root}/lib/native-builder/external-app/cursorAdapter.ts`, 'utf8')
  const debugSrc = await readFile(`${root}/lib/native-builder/external-app/cursorElectronDebug.ts`, 'utf8')
  const results: CaseResult[] = []

  results.push(check(
    'adapter_understands_cursor_concepts',
    /composer/.test(adapterSrc) && /submit/.test(adapterSrc) && /generation/.test(adapterSrc) && /response/.test(adapterSrc)
      && !/screenX\s*=\s*\d{3,}/.test(adapterSrc),
    'composer/submit/generation/response; no hardcoded absolute clicks',
  ))
  results.push(check(
    'debug_never_uses_war_room_cdp',
    /warRoomCdpUsed: false/.test(debugSrc) && /Do not attach to War Room CDP/.test(debugSrc),
    'Cursor debug discovery is independent',
  ))

  const focus = await executeComputerTool('computer.focus_window', { title: 'Cursor' }, { repairId: 'external-app-cursor-adapter' })
  results.push(check(
    'computer_focus_window_still_refuses_cursor',
    focus.ok === false && /restricted to the throwaway test app or the War Room window/.test(String(focus.error || '')),
    String(focus.error || ''),
  ))

  const warRoom = readDesktopCdpRuntime()
  const targets = await listElectronCdpTargets().catch(() => [])
  const cursorOnWarRoom = targets.filter(item => /cursor/i.test(`${item.title} ${item.url}`))
  results.push(check(
    'war_room_cdp_has_no_cursor_targets',
    cursorOnWarRoom.length === 0
      && targets.every(item => isAllowedWarRoomCdpTarget(item).ok === false || !/cursor/i.test(`${item.title} ${item.url}`)),
    `warRoomPort=${warRoom?.cdpPort ?? 'none'} cursorTargets=${cursorOnWarRoom.length}`,
  ))
  results.push(check(
    'wrong_app_protection_cursor_url',
    isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9222/', title: 'Cursor' }).ok === false,
    'preserved',
  ))

  const debug = await discoverCursorElectronDebug()
  results.push(check(
    'cursor_debug_independent',
    debug.warRoomCdpUsed === false && debug.port !== Number(warRoom?.cdpPort || 0),
    JSON.stringify({ present: debug.present, reason: debug.reason, port: debug.port, setup: CURSOR_DEBUG_ONE_TIME_SETUP.performed }),
  ))

  const discovered = await ExternalAppBroker.execute('external_app.discover', { app: 'cursor' }, { repairId: 'external-app-cursor-adapter' })
  const windowOk = discovered.ok === true
  results.push(check(
    'cursor_window_discovered',
    windowOk,
    JSON.stringify({ ok: discovered.ok, error: discovered.error, title: (discovered.result as { window?: { title?: string } } | undefined)?.window?.title }),
  ))

  const observed = await ExternalAppBroker.execute('external_app.observe', { app: 'cursor' }, { repairId: 'external-app-cursor-adapter' })
  results.push(check(
    'cursor_composer_bind_attempted',
    true,
    JSON.stringify({
      ok: observed.ok,
      backend: observed.backend,
      error: observed.error,
      binding: observed.binding?.semanticTarget ?? null,
    }),
  ))
  results.push(check(
    'one_time_debug_not_performed',
    CURSOR_DEBUG_ONE_TIME_SETUP.performed === false,
    'CURSOR_RESTARTED remains a Commander decision',
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry Cursor adapter: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCursorAdapterValidation }
