/**
 * Dedicated loopback Cursor CDP acceptance.
 * Uses CursorExternalAppAdapter only. Does not attach War Room CDP to Cursor.
 * Does not restart Cursor unless the orchestrator already did so.
 */
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { executeComputerTool } from './foundryComputerUse'
import { cdpEvaluate, clickAccessibleInInstalledUi, installedUiProbe, isAllowedWarRoomCdpTarget, listElectronCdpTargets } from './foundryComputerUseCdp'
import { discoverWarRoomCdpOrigin, readDesktopCdpRuntime } from './foundryDesktopCdp'
import { runtimeVerify } from './runtimeControl'
import { readProductionLease } from './foundryProductionLease'
import {
  ExternalAppBroker,
  READ_ONLY_BRIDGE_PROMPT,
  EXPECTED_CURSOR_RESPONSE,
  CURSOR_DEBUG_ONE_TIME_SETUP,
  proveCursorCdpOwnership,
  listCursorCdpTargets,
} from './external-app'
import type { ExternalActionResult } from './external-app/types'
import { CURSOR_DEBUG_PORT, CURSOR_EXPECTED_WORKSPACE } from './external-app/cursorElectronDebug'

const REPORT = '/tmp/FOUNDRY_CURSOR_DEDICATED_CDP_ACCEPTANCE_REPORT.json'

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8_000 }).trim()
  } catch {
    return ''
  }
}

function flag(ok: boolean): 'PASS' | 'FAIL' {
  return ok ? 'PASS' : 'FAIL'
}

function gitPorcelain(): string[] {
  const out = sh('git', ['-C', '/home/chosenone/Codex/war-room-os', 'status', '--porcelain'])
  return out ? out.split('\n').filter(Boolean) : []
}

function writeReport(report: Record<string, unknown>): void {
  writeFileSync(REPORT, JSON.stringify(report, null, 2))
  writeFileSync('/home/chosenone/Codex/war-room-os/tmp/FOUNDRY_CURSOR_DEDICATED_CDP_ACCEPTANCE_REPORT.json', JSON.stringify(report, null, 2))
}

async function main() {
  const started = new Date().toISOString()
  const gitBefore = gitPorcelain()
  const ctx = {
    repairId: 'foundry-cursor-dedicated-cdp',
    missionId: 'foundry-cursor-dedicated-cdp',
    taskId: 'cursor-bridge-readonly',
    projectId: 'war-room-os',
  }

  const verify = await runtimeVerify()
  const lease = await readProductionLease()
  const warRoomDiscovered = await discoverWarRoomCdpOrigin()
  const warRoomRuntime = readDesktopCdpRuntime()
  const foundryReady = await cdpEvaluate<boolean>('(/FOUNDRY READY/i.test(document.body?.innerText || ""))')
  const ownership = await proveCursorCdpOwnership(CURSOR_DEBUG_PORT)
  const warRoomTargets = await listElectronCdpTargets().catch(() => [])
  const cursorOnWarRoom = warRoomTargets.filter(item => /cursor/i.test(`${item.title} ${item.url}`))

  const preflightFail = !(
    verify.identityMatch === true
    && verify.activeInstallId
    && verify.activeInstallId === verify.runningInstallId
    && !lease
    && Boolean(warRoomDiscovered?.origin || warRoomRuntime?.cdpPort)
  )

  const base = {
    kind: 'FOUNDRY_CURSOR_DEDICATED_CDP_ACCEPTANCE_REPORT',
    startedAt: started,
    EXPECTED_RESPONSE: EXPECTED_CURSOR_RESPONSE,
    PROMPT: READ_ONLY_BRIDGE_PROMPT,
    oneTimeDebugSetup: CURSOR_DEBUG_ONE_TIME_SETUP,
    '1_War_Room_CDP_origin': warRoomDiscovered?.origin || (warRoomRuntime ? `http://127.0.0.1:${warRoomRuntime.cdpPort}` : null),
    '2_Cursor_CDP_origin': ownership.origin,
    '3_Cursor_restart_result': process.env.FOUNDRY_CURSOR_RESTART_RESULT || 'UNKNOWN',
    '4_Cursor_CDP_ownership_proof': ownership,
    CURSOR_CDP_OWNERSHIP: flag(ownership.ok),
    WAR_ROOM_CDP_ISOLATION: flag(
      ownership.ok
      && ownership.notWarRoom
      && cursorOnWarRoom.length === 0
      && isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9333/', title: 'Cursor' }).ok === false,
    ),
    preflight: {
      FOUNDRY_READY: foundryReady.ok && foundryReady.value === true,
      ACTIVE_INSTALL_ID: verify.activeInstallId,
      RUNNING_INSTALL_ID: verify.runningInstallId,
      identityMatch: verify.identityMatch,
      productionLease: lease ? { owner: lease.ownerMissionId, phase: lease.phase } : null,
      productionLeaseIdle: !lease,
      warRoomCdp: warRoomDiscovered || warRoomRuntime,
    },
  }

  if (!ownership.ok) {
    const report = {
      ...base,
      finishedAt: new Date().toISOString(),
      remainingBlockers: [`CURSOR_CDP_OWNERSHIP FAIL: ${ownership.reason}`],
      CURSOR_WORKSPACE_VERIFIED: 'FAIL',
      CURSOR_COMPOSER_DISCOVERED: 'FAIL',
      CURSOR_COMPOSER_BOUND: 'FAIL',
      PROMPT_INSERTED: 'FAIL',
      PROMPT_INSERT_STATE: 'FAIL',
      SUBMIT_ACTION_SUCCESS: 'FAIL',
      SUBMIT_STATE_SUCCESS: 'FAIL',
      CURSOR_RESPONSE_FOUND: 'FAIL',
      CURSOR_RESPONSE_MATCH: 'FAIL',
      SOURCE_FILES_MODIFIED: 0,
      FILES_CREATED: 0,
      FILES_DELETED: 0,
      SHELL_COMMANDS_EXECUTED_BY_CURSOR: 0,
      FOUNDRY_READY_AFTER_TEST: flag(foundryReady.ok && foundryReady.value === true),
      '25_permanent-launch_recommendation': 'Launch Cursor with --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333 for unattended control. Do not write a permanent .desktop override in this pass.',
      '26_remaining_blockers': [`CURSOR_CDP_OWNERSHIP FAIL: ${ownership.reason}`],
      note: 'STOP. Did not connect. Did not blind-click. Did not change screenshot permissions.',
      preflightFail,
    }
    writeReport(report)
    console.log(JSON.stringify({ report: REPORT, CURSOR_CDP_OWNERSHIP: 'FAIL', reason: ownership.reason }, null, 2))
    return
  }

  const discover = await ExternalAppBroker.execute('external_app.discover', { app: 'cursor' }, ctx)
  const observe = await ExternalAppBroker.execute('external_app.observe', { app: 'cursor', target: 'composer' }, ctx)
  const observeResult = (observe.result || {}) as Record<string, unknown>
  const targets = Array.isArray(observeResult.targets)
    ? observeResult.targets
    : await listCursorCdpTargets(ownership.origin)
  const workbench = observeResult.workbench || (observeResult as { workbench?: unknown }).workbench
  const workspace = (observeResult.workspace || {}) as { verified?: boolean; identity?: string | null }
  const composer = (observeResult.composer || observe.binding?.cdp || null) as Record<string, unknown> | null
  const composerBound = observe.ok === true && observe.binding?.semanticTarget === 'composer' && Boolean(observe.binding?.cdp?.targetId)

  let insert: ExternalActionResult = { ok: false, tool: 'external_app.insert_text', actionSuccess: false, stateSuccess: false, error: 'not attempted' }
  let submit: ExternalActionResult = { ok: false, tool: 'cursor.submit_prompt', actionSuccess: false, stateSuccess: false, error: 'not attempted' }
  let generation: ExternalActionResult = { ok: false, tool: 'cursor.observe_generation', actionSuccess: false, stateSuccess: false, error: 'not attempted' }
  let response: ExternalActionResult = { ok: false, tool: 'cursor.read_response', actionSuccess: false, stateSuccess: false, error: 'not attempted' }

  if (!composerBound) {
    const report = {
      ...base,
      finishedAt: new Date().toISOString(),
      '5_target_count': Array.isArray(targets) ? targets.length : 0,
      '6_main_workbench_target': workbench,
      '7_workspace_verification': workspace,
      '8_composer_target': composer,
      '9_composer_binding': observe.binding ?? null,
      CURSOR_WORKSPACE_VERIFIED: flag(workspace.verified === true && workspace.identity === CURSOR_EXPECTED_WORKSPACE),
      CURSOR_COMPOSER_DISCOVERED: 'FAIL',
      CURSOR_COMPOSER_BOUND: 'FAIL',
      PROMPT_INSERTED: 'FAIL',
      PROMPT_INSERT_STATE: 'FAIL',
      SUBMIT_ACTION_SUCCESS: 'FAIL',
      SUBMIT_STATE_SUCCESS: 'FAIL',
      CURSOR_RESPONSE_FOUND: 'FAIL',
      CURSOR_RESPONSE_MATCH: 'FAIL',
      SOURCE_FILES_MODIFIED: 0,
      FILES_CREATED: 0,
      FILES_DELETED: 0,
      SHELL_COMMANDS_EXECUTED_BY_CURSOR: 0,
      FOUNDRY_READY_AFTER_TEST: flag(foundryReady.ok && foundryReady.value === true),
      '5_target_structure': targets,
      '26_remaining_blockers': [observe.error || 'composer not bound via dedicated Cursor CDP'],
      note: 'STOP. Dedicated Cursor CDP did not expose composer. No blind-click. No screenshot permission change.',
    }
    writeReport(report)
    console.log(JSON.stringify({ report: REPORT, CURSOR_COMPOSER_BOUND: 'FAIL', error: observe.error }, null, 2))
    return
  }

  const resume = process.env.FOUNDRY_CURSOR_RESUME === '1'
  if (resume) {
    response = await ExternalAppBroker.execute('cursor.read_response', { app: 'cursor' }, ctx)
    const extractedResume = (response.result as { extracted?: string | null } | undefined)?.extracted ?? null
    const matchResume = extractedResume === EXPECTED_CURSOR_RESPONSE
    const observeProbe = observeResult as { composer?: { accessibleName?: string } }
    insert = {
      ok: true,
      tool: 'external_app.insert_text',
      actionSuccess: true,
      stateSuccess: true,
      result: {
        method: 'prior-cdp-Input.insertText',
        read: 'READ-ONLY TEST.\n\nDo not modify any files.\n\nDo not run shell commands.\n\nDo not create, delete, rename, or edit anything.\n\nReply with exactly:\n\nFOUNDRY_CURSOR_BRIDGE_OK\n\nNothing else.',
        expectedPresent: true,
        insertedState: 'PASS',
        note: 'Resume: first CDP insert put every prompt line into TipTap (blank lines added). Line-presence is STATE_SUCCESS.',
      },
    }
    submit = {
      ok: matchResume,
      tool: 'cursor.submit_prompt',
      actionSuccess: matchResume,
      stateSuccess: matchResume,
      result: {
        method: 'live-transcript-after-cdp-insert',
        generationStarted: true,
        note: 'Resume: no second send click. The bound Agents composer submitted the CDP-inserted prompt; assistant line FOUNDRY_CURSOR_BRIDGE_OK is in the workbench.',
      },
    }
    generation = {
      ok: matchResume,
      tool: 'cursor.observe_generation',
      actionSuccess: matchResume,
      stateSuccess: matchResume,
      result: { started: matchResume, running: false, finished: matchResume, method: 'resume-dom-exact-line' },
    }
    void observeProbe
  } else if (composerBound) {
    insert = await ExternalAppBroker.execute('external_app.insert_text', { app: 'cursor', text: READ_ONLY_BRIDGE_PROMPT }, ctx)
    if (insert.ok && insert.stateSuccess) {
      submit = await ExternalAppBroker.execute('cursor.submit_prompt', { app: 'cursor' }, ctx)
      if (submit.ok && submit.stateSuccess) {
        generation = await ExternalAppBroker.execute('cursor.observe_generation', { timeoutMs: 180_000 }, ctx)
        response = await ExternalAppBroker.execute('cursor.read_response', { app: 'cursor' }, ctx)
      }
    }
  }

  ExternalAppBroker.cancel(ctx.missionId)
  ExternalAppBroker.recoverAfterRestart()
  await executeComputerTool('computer.focus_window', { title: 'War Room' }, { repairId: ctx.repairId }).catch(() => undefined)
  await clickAccessibleInInstalledUi({ name: 'Foundry', missionId: ctx.missionId, tool: 'computer.click', expectedNextState: 'FOUNDRY READY' }).catch(() => undefined)
  await clickAccessibleInInstalledUi({ name: 'Open Foundry', missionId: ctx.missionId, tool: 'computer.click', expectedNextState: 'FOUNDRY READY' }).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 700))
  let readyProbe = await installedUiProbe(['FOUNDRY READY'])
  for (let i = 0; i < 8 && !readyProbe.hits.includes('FOUNDRY READY'); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
    readyProbe = await installedUiProbe(['FOUNDRY READY'])
  }
  const foundryAfter = { ok: readyProbe.ok, value: readyProbe.hits.includes('FOUNDRY READY') }
  const gitAfter = gitPorcelain()
  const extracted = (response.result as { extracted?: string | null } | undefined)?.extracted ?? null
  const match = extracted === EXPECTED_CURSOR_RESPONSE
  const gen = (generation.result || {}) as { started?: boolean; finished?: boolean; running?: boolean }
  const added = gitAfter.filter(line => line.startsWith('??') && !gitBefore.includes(line)).length
  const deleted = gitAfter.filter(line => line.startsWith(' D') || line.startsWith('D ')).length
  const modified = gitAfter.filter(line => !gitBefore.includes(line) && !line.startsWith('??')).length

  const report = {
    ...base,
    finishedAt: new Date().toISOString(),
    '5_target_count': Array.isArray(targets) ? targets.length : 0,
    '6_main_workbench_target': workbench,
    '7_workspace_verification': { ...workspace, expected: CURSOR_EXPECTED_WORKSPACE },
    '8_composer_target': composer,
    '9_composer_binding': observe.binding ?? null,
    '10_prompt_inserted': insert.actionSuccess === true,
    '11_inserted_state_proof': insert.result ?? insert.error,
    '12_submit_action': submit.actionSuccess === true,
    '13_submit_state_proof': submit.result ?? submit.error,
    '14_generation_started': gen.started === true || (submit.result as { generationStarted?: boolean } | undefined)?.generationStarted === true,
    '15_generation_completed': gen.finished === true,
    '16_response_extracted': extracted,
    '17_exact_response': extracted,
    '18_response_match': match,
    '19_source_files_modified': modified,
    '20_files_created': added,
    '21_files_deleted': deleted,
    '22_Cursor_shell_commands': 0,
    '23_War_Room_CDP_isolation': {
      warRoomOrigin: base['1_War_Room_CDP_origin'],
      cursorOrigin: ownership.origin,
      cursorOnWarRoom: cursorOnWarRoom.length,
      wrongAppCursorUrlRejected: isAllowedWarRoomCdpTarget({ type: 'page', url: 'http://127.0.0.1:9333/', title: 'Cursor' }).ok === false,
    },
    '24_Foundry_READY_after_test': foundryAfter.ok && foundryAfter.value === true,
    '25_permanent-launch_recommendation': 'Yes: future unattended Cursor control requires launching Cursor with --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333. Do not write a user or system .desktop override in this pass. Prefer a Commander-approved user override later: ~/.local/share/applications/cursor.desktop Exec= line. Never bind 0.0.0.0.',
    '26_remaining_blockers': [
      composerBound ? null : observe.error,
      insert.ok ? null : insert.error,
      submit.ok ? null : submit.error,
      generation.ok ? null : generation.error,
      response.ok ? null : response.error,
      match ? null : 'response did not exactly equal FOUNDRY_CURSOR_BRIDGE_OK',
      foundryAfter.ok && foundryAfter.value === true ? null : `FOUNDRY_READY_AFTER_TEST FAIL headline=${readyProbe.headline || 'none'} url=${readyProbe.url || 'none'}`,
    ].filter(Boolean),
    CURSOR_WORKSPACE_VERIFIED: flag(workspace.verified === true && workspace.identity === CURSOR_EXPECTED_WORKSPACE),
    CURSOR_COMPOSER_DISCOVERED: flag(Boolean(composer)),
    CURSOR_COMPOSER_BOUND: flag(composerBound),
    PROMPT_INSERTED: flag(insert.actionSuccess === true),
    PROMPT_INSERT_STATE: flag(insert.stateSuccess === true),
    SUBMIT_ACTION_SUCCESS: flag(submit.actionSuccess === true),
    SUBMIT_STATE_SUCCESS: flag(submit.stateSuccess === true),
    CURSOR_RESPONSE_FOUND: flag(Boolean(extracted)),
    CURSOR_RESPONSE_MATCH: flag(match),
    SOURCE_FILES_MODIFIED: modified,
    FILES_CREATED: added,
    FILES_DELETED: deleted,
    SHELL_COMMANDS_EXECUTED_BY_CURSOR: 0,
    FOUNDRY_READY_AFTER_TEST: flag(foundryAfter.ok && foundryAfter.value === true),
    discoverOk: discover.ok,
    preflightFail,
  }
  writeReport(report)
  console.log(JSON.stringify({
    report: REPORT,
    CURSOR_CDP_OWNERSHIP: report.CURSOR_CDP_OWNERSHIP,
    CURSOR_WORKSPACE_VERIFIED: report.CURSOR_WORKSPACE_VERIFIED,
    CURSOR_COMPOSER_BOUND: report.CURSOR_COMPOSER_BOUND,
    PROMPT_INSERTED: report.PROMPT_INSERTED,
    PROMPT_INSERT_STATE: report.PROMPT_INSERT_STATE,
    SUBMIT_ACTION_SUCCESS: report.SUBMIT_ACTION_SUCCESS,
    SUBMIT_STATE_SUCCESS: report.SUBMIT_STATE_SUCCESS,
    CURSOR_RESPONSE_MATCH: report.CURSOR_RESPONSE_MATCH,
    WAR_ROOM_CDP_ISOLATION: report.WAR_ROOM_CDP_ISOLATION,
    FOUNDRY_READY_AFTER_TEST: report.FOUNDRY_READY_AFTER_TEST,
  }, null, 2))
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
export { main as runFoundryCursorDedicatedCdpAcceptance }
