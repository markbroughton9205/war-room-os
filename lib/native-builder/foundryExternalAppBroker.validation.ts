/**
 * ExternalAppBroker structural validation. Does not click Cursor, does not train WRIM,
 * does not modify Harbor/Lane & Box/Inventory/Terra.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { COMPUTER_TOOL_NAMES } from './foundryComputerUse'
import { isAllowedWarRoomCdpTarget, WAR_ROOM_UI_ORIGIN } from './foundryComputerUseCdp'
import {
  ExternalAppBroker,
  CURSOR_REGISTRATION,
  genericDesktopAuthorityGranted,
  EXTERNAL_APP_TOOL_NAMES,
  isExternalAppToolName,
  classifyExternalSafety,
  CURSOR_DEBUG_ONE_TIME_SETUP,
} from './external-app'
import { ENGINEER_TOOL_NAMES, isEngineerToolName } from './engineerTools'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const root = resolveRepoRoot()
  const computer = await readFile(`${root}/lib/native-builder/foundryComputerUse.ts`, 'utf8')
  const cdp = await readFile(`${root}/lib/native-builder/foundryComputerUseCdp.ts`, 'utf8')
  const broker = await readFile(`${root}/lib/native-builder/external-app/broker.ts`, 'utf8')
  const registrySrc = await readFile(`${root}/lib/native-builder/external-app/registry.ts`, 'utf8')
  const results: CaseResult[] = []

  results.push(check(
    'not_a_second_tool_broker',
    /executeEngineerTool/.test(await readFile(`${root}/lib/native-builder/engineerTools.ts`, 'utf8'))
      && /isExternalAppToolName/.test(await readFile(`${root}/lib/native-builder/engineerTools.ts`, 'utf8'))
      && !/createToolBroker|SecondToolBroker/.test(broker),
    'ExternalAppBroker is invoked through existing Foundry engineer tools',
  ))
  results.push(check(
    'war_room_focus_not_broadened',
    computer.includes('computer.focus_window is restricted to the throwaway test app or the War Room window.')
      && !/title\.includes\('Cursor'\)/.test(computer),
    'computer.focus_window remains War Room / test-app scoped',
  ))
  results.push(check(
    'no_generic_any_app',
    genericDesktopAuthorityGranted() === false
      && CURSOR_REGISTRATION.appId === 'cursor'
      && ExternalAppBroker.listApps().length === 1
      && CURSOR_REGISTRATION.interactionBoundaries.some(item => /No generic any-application/.test(item)),
    `apps=${ExternalAppBroker.listApps().map(a => a.appId).join(',')}`,
  ))
  results.push(check(
    'cursor_only_registry',
    ExternalAppBroker.isRegistered('cursor')
      && !ExternalAppBroker.isRegistered('chrome')
      && !ExternalAppBroker.isRegistered('*')
      && CURSOR_REGISTRATION.interactionBoundaries.some(item => /No generic any-application/.test(item)),
    CURSOR_REGISTRATION.appId,
  ))
  results.push(check(
    'cdp_wrong_app_preserved',
    isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9333/', title: 'Cursor' }).ok === false
      && isAllowedWarRoomCdpTarget({ type: 'page', url: `${WAR_ROOM_UI_ORIGIN}/war-room/engineering`, title: 'War Room OS' }).ok === true,
    'War Room CDP still rejects Cursor',
  ))
  results.push(check(
    'tools_are_engineer_tools',
    EXTERNAL_APP_TOOL_NAMES.every(name => isEngineerToolName(name) && isExternalAppToolName(name))
      && EXTERNAL_APP_TOOL_NAMES.every(name => FOUNDRY_MODEL_TOOL_CATALOG.some(entry => entry.name === name))
      && ENGINEER_TOOL_NAMES.includes('external_app.focus'),
    EXTERNAL_APP_TOOL_NAMES.join(','),
  ))
  results.push(check(
    'computer_tools_unchanged_names',
    (COMPUTER_TOOL_NAMES as readonly string[]).includes('computer.focus_window')
      && !(COMPUTER_TOOL_NAMES as readonly string[]).includes('external_app.focus'),
    'external_app.* is a separate layer',
  ))
  results.push(check(
    'no_unrestricted_desktop',
    /genericDesktopAuthorityGranted\(\): boolean \{\s*return false/.test(registrySrc)
      && !/any application/.test(CURSOR_REGISTRATION.appId),
    'no wildcard app id',
  ))
  results.push(check(
    'human_away_contract',
    classifyExternalSafety('insert_text', READONLY) === 'SAFE_AUTONOMOUS'
      && classifyExternalSafety('insert_text', 'paste the password now') === 'COMMANDER_APPROVAL_REQUIRED'
      && classifyExternalSafety('insert_text', 'rm -rf /') === 'BLOCKED',
    'SAFE / APPROVAL / BLOCKED',
  ))
  results.push(check(
    'debug_setup_not_auto_restart',
    CURSOR_DEBUG_ONE_TIME_SETUP.performed === false
      && CURSOR_DEBUG_ONE_TIME_SETUP.required.some(line => /Do not restart Cursor automatically/.test(line))
      && CURSOR_DEBUG_ONE_TIME_SETUP.required.some(line => /127\.0\.0\.1/.test(line))
      && CURSOR_DEBUG_ONE_TIME_SETUP.required.every(line => !/0\.0\.0\.0/.test(line) || /Never bind/.test(line)),
    'one-time loopback debug is documented, not executed',
  ))
  results.push(check(
    'cascade_order_source',
    /accessibility[\s\S]*app-electron-debug[\s\S]*wayland-portal[\s\S]*vision/.test(
      await readFile(`${root}/lib/native-builder/external-app/backends.ts`, 'utf8'),
    ),
    'A→B→C→D cascade',
  ))
  results.push(check(
    'existing_cu_backend_still_excludes_cursor_by_default',
    /"cursor"/.test(await readFile(`${root}/scripts/foundry/computer-use-backend.py`, 'utf8'))
      && /_excluded_desktop_app/.test(await readFile(`${root}/scripts/foundry/computer-use-backend.py`, 'utf8')),
    'War Room CU backend still excludes Cursor unless explicit',
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry ExternalAppBroker: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

const READONLY = 'READ-ONLY TEST.\nReply with exactly:\nFOUNDRY_CURSOR_BRIDGE_OK'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryExternalAppBrokerValidation }
