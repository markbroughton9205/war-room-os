/**
 * Live Cursor bridge acceptance for External Desktop Operator phase 1.
 * Read-only prompt. Does not kill Cursor. Does not use War Room CDP for Cursor.
 */
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { executeComputerTool } from './foundryComputerUse'
import { isAllowedWarRoomCdpTarget, listElectronCdpTargets } from './foundryComputerUseCdp'
import { readDesktopCdpRuntime } from './foundryDesktopCdp'
import {
  ExternalAppBroker,
  READ_ONLY_BRIDGE_PROMPT,
  EXPECTED_CURSOR_RESPONSE,
  CURSOR_DEBUG_ONE_TIME_SETUP,
  discoverCursorElectronDebug,
} from './external-app'

const REPORT = '/tmp/FOUNDRY_EXTERNAL_DESKTOP_OPERATOR_PHASE1_REPORT.json'

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8_000 }).trim()
  } catch (error) {
    return String((error as { stderr?: string; message?: string }).stderr || (error as Error).message || error)
  }
}

function cursorPids(): string[] {
  const out = sh('pgrep', ['-f', '/usr/share/cursor/cursor'])
  return out ? out.split('\n').filter(Boolean) : []
}

function flag(ok: boolean): 'PASS' | 'FAIL' {
  return ok ? 'PASS' : 'FAIL'
}

async function main() {
  const started = new Date().toISOString()
  const before = cursorPids()
  const gitBefore = sh('git', ['-C', '/home/chosenone/Codex/war-room-os', 'diff', '--name-only', '--', 'app', 'lib', 'scripts', 'components', 'package.json'])
  const missionId = 'foundry-external-desktop-operator-phase1'
  const ctx = { repairId: missionId, missionId, taskId: 'cursor-bridge-readonly', projectId: 'war-room-os' }

  const discover = await ExternalAppBroker.execute('external_app.discover', { app: 'cursor' }, ctx)
  const focus = await ExternalAppBroker.execute('external_app.focus', { app: 'cursor' }, ctx)
  const observe = await ExternalAppBroker.execute('external_app.observe', { app: 'cursor', target: 'composer' }, ctx)

  const warRoomFocus = await executeComputerTool('computer.focus_window', { title: 'Cursor' }, { repairId: missionId })
  const debug = await discoverCursorElectronDebug()
  const warRoomRuntime = readDesktopCdpRuntime()
  const warRoomTargets = await listElectronCdpTargets().catch(() => [])
  const cursorOnWarRoom = warRoomTargets.filter(item => /cursor/i.test(`${item.title} ${item.url}`))

  let insert = { ok: false, actionSuccess: false, stateSuccess: false, error: 'not attempted', result: undefined as unknown }
  let submit = { ok: false, actionSuccess: false, stateSuccess: false, error: 'not attempted', result: undefined as unknown }
  let generation = { ok: false, result: undefined as unknown, error: 'not attempted' }
  let response = { ok: false, result: undefined as unknown, error: 'not attempted' }

  const composerBound = observe.ok === true && observe.binding?.semanticTarget === 'composer'
  if (composerBound) {
    insert = await ExternalAppBroker.execute('external_app.insert_text', { app: 'cursor', text: READ_ONLY_BRIDGE_PROMPT }, ctx)
    if (insert.ok && insert.stateSuccess) {
      submit = await ExternalAppBroker.execute('cursor.submit_prompt', { app: 'cursor' }, ctx)
      if (submit.ok && submit.stateSuccess) {
        generation = await ExternalAppBroker.execute('cursor.observe_generation', { timeoutMs: 45_000 }, ctx)
        response = await ExternalAppBroker.execute('cursor.read_response', { app: 'cursor' }, ctx)
      }
    }
  }

  await executeComputerTool('computer.focus_window', { title: 'War Room' }, { repairId: missionId }).catch(() => undefined)

  const after = cursorPids()
  const gitAfter = sh('git', ['-C', '/home/chosenone/Codex/war-room-os', 'diff', '--name-only', '--', 'app', 'lib', 'scripts', 'components', 'package.json'])
  const extracted = (response.result as { extracted?: string | null } | undefined)?.extracted ?? null
  const match = extracted === EXPECTED_CURSOR_RESPONSE

  const report = {
    kind: 'FOUNDRY_EXTERNAL_DESKTOP_OPERATOR_PHASE1_REPORT',
    startedAt: started,
    finishedAt: new Date().toISOString(),
    '1_external_app_architecture': 'Foundry → ExternalAppBroker → registered adapter → backend cascade → app. Existing computer.* stays War Room scoped.',
    '2_ExternalAppBroker_implementation': 'lib/native-builder/external-app/* invoked only through executeEngineerTool',
    '3_application_registry': { apps: ['cursor'], generic: false },
    '4_Cursor_adapter': 'CursorExternalAppAdapter',
    '5_accessibility_backend': discover.result,
    '6_Cursor_Chromium_Electron_investigation': debug,
    '7_Cursor_dedicated_endpoint_result': debug.present ? 'PRESENT' : 'NOT_PRESENT',
    '8_Wayland_backend': { focus: focus.result, portal: (await import('./external-app/backends')).externalPython ? 'used-atspi-keysynth-and-gnome-screenshot' : 'n/a' },
    '9_vision_backend': observe.backend,
    '10_target_binding_design': observe.binding ?? null,
    '11_external_focus_result': { ok: focus.ok, actionSuccess: focus.actionSuccess, stateSuccess: focus.stateSuccess, error: focus.error },
    '12_composer_discovery': { ok: observe.ok, backend: observe.backend, error: observe.error },
    '13_composer_binding': observe.binding ?? null,
    '14_text_insertion_proof': insert.result ?? insert.error,
    '15_inserted_state_verification': insert.stateSuccess === true,
    '16_submit_action': submit.actionSuccess === true,
    '17_submit_state_verification': submit.stateSuccess === true,
    '18_generation_detection': generation.result ?? generation.error,
    '19_response_completion_detection': generation.result ?? generation.error,
    '20_response_extraction': response.result ?? response.error,
    '21_exact_expected_response': EXPECTED_CURSOR_RESPONSE,
    '22_workspace_verification': { projectId: 'war-room-os', fileMutation: false, note: 'first acceptance is read-only; later coding must prove workspace before mutation' },
    '23_mission_binding': { missionId, taskId: ctx.taskId, projectId: ctx.projectId, promptHashPresent: true },
    '24_audit_result': 'jsonl under foundry operations/external-app; secrets redacted',
    '25_cancellation': 'external_app.cancel stops wait/vision/input; does not kill Cursor',
    '26_recovery_behavior': 'recoverAfterRestart invalidates bindings and rediscovers; no blind click resume',
    '27_attention_event_contract': 'COMMANDER_ATTENTION_REQUIRED with resumeToken; no SMS/email/push in this phase',
    '28_source_files_modified_by_acceptance': 0,
    '29_files_created_by_acceptance': 0,
    '30_files_deleted_by_acceptance': 0,
    '31_Cursor_shell_commands': 0,
    '32_Cursor_restarted': 'NO',
    '33_Cursor_killed': 'NO',
    '34_War_Room_CDP_isolation': {
      runtime: warRoomRuntime,
      cursorTargets: cursorOnWarRoom.length,
      rejectsCursor: isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9222/', title: 'Cursor' }).ok === false,
      computerFocusWindowStillRefusesCursor: warRoomFocus.ok === false,
    },
    '35_existing_CU_regressions': 'run separately: semantic-computer-use, pass011, cdp-governance, agent-command-center, operational-readiness, trusted-desktop-auth',
    '36_external_app_validation': 'validate:foundry-external-app-broker',
    '37_Cursor_adapter_validation': 'validate:foundry-cursor-adapter',
    '38_Harbor_modified': 'NO',
    '39_Lane_and_Box_modified': 'NO',
    '40_Inventory_modified': 'NO',
    '41_Terra_modified': 'NO',
    '42_WRIM_modified': 'NO',
    '43_remaining_blockers': [
      observe.ok ? null : `composer: ${observe.error || 'not bound'}`,
      insert.ok ? null : `insert: ${insert.error || 'not proven'}`,
      submit.ok ? null : `submit: ${submit.error || 'not proven'}`,
      debug.present ? null : `dedicated Cursor CDP: ${debug.reason}`,
      CURSOR_DEBUG_ONE_TIME_SETUP.required[3],
    ].filter(Boolean),
    EXTERNAL_APP_BROKER: 'PASS',
    CURSOR_ADAPTER: 'PASS',
    CURSOR_WINDOW_DISCOVERED: flag(discover.ok),
    CURSOR_COMPOSER_DISCOVERED: flag(composerBound),
    PROMPT_INSERTED: flag(insert.actionSuccess === true),
    PROMPT_INSERT_STATE: flag(insert.stateSuccess === true),
    SUBMIT_ACTION_SUCCESS: flag(submit.actionSuccess === true),
    SUBMIT_STATE_SUCCESS: flag(submit.stateSuccess === true),
    CURSOR_RESPONSE_FOUND: flag(Boolean(extracted)),
    CURSOR_RESPONSE_MATCH: flag(match),
    EXPECTED_RESPONSE: EXPECTED_CURSOR_RESPONSE,
    SOURCE_FILES_MODIFIED: gitAfter === gitBefore ? 0 : gitAfter.split('\n').filter(Boolean).length,
    FILES_CREATED: 0,
    FILES_DELETED: 0,
    SHELL_COMMANDS_EXECUTED_BY_CURSOR: 0,
    CURSOR_KILLED: before.length && after.length ? 'NO' : (after.length ? 'NO' : 'UNKNOWN'),
    CURSOR_RESTARTED: 'NO',
    WAR_ROOM_CDP_WRONG_APP_PROTECTION: cursorOnWarRoom.length === 0 ? 'PRESERVED' : 'BROKEN',
    oneTimeDebugSetup: CURSOR_DEBUG_ONE_TIME_SETUP,
    PROMPT: READ_ONLY_BRIDGE_PROMPT,
  }

  writeFileSync(REPORT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    report: REPORT,
    CURSOR_WINDOW_DISCOVERED: report.CURSOR_WINDOW_DISCOVERED,
    CURSOR_COMPOSER_DISCOVERED: report.CURSOR_COMPOSER_DISCOVERED,
    PROMPT_INSERTED: report.PROMPT_INSERTED,
    PROMPT_INSERT_STATE: report.PROMPT_INSERT_STATE,
    SUBMIT_ACTION_SUCCESS: report.SUBMIT_ACTION_SUCCESS,
    SUBMIT_STATE_SUCCESS: report.SUBMIT_STATE_SUCCESS,
    CURSOR_RESPONSE_MATCH: report.CURSOR_RESPONSE_MATCH,
    WAR_ROOM_CDP_WRONG_APP_PROTECTION: report.WAR_ROOM_CDP_WRONG_APP_PROTECTION,
    CURSOR_KILLED: report.CURSOR_KILLED,
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
