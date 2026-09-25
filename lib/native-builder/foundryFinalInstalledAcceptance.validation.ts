/**
 * Source contracts for final installed Foundry acceptance + lifecycle closure.
 * Does not start Wave 5. Does not package. Does not modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_TERMINAL_STATES, LEGAL_TRANSITIONS } from './foundryMissionTypes'
import { legalInstallCompletionPath, legalInstallVerificationPath } from './foundryInstallMissionLifecycle'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function run() {
  const results: CaseResult[] = []
  const closer = source('lib/native-builder/foundryInstallMissionLifecycle.ts')
  const acceptOld = source('tmp/foundry-product-operationalization-accept.ts')
  const acceptNew = source('tmp/foundry-final-installed-acceptance.ts')
  const browser = source('desktop/src/warRoomBrowser.cjs')
  const computerCdp = source('lib/native-builder/foundryComputerUseCdp.ts')
  const computer = source('lib/native-builder/foundryComputerUse.ts')
  const mediaHost = source('components/war-room/media/MediaHost.tsx')
  const mediaTabs = source('components/war-room/media/MediaTabs.tsx')
  const mediaLauncher = source('components/war-room/media/MediaLauncher.tsx')

  results.push(check(
    'cleanup_packaging_has_legal_terminal_path',
    JSON.stringify(legalInstallVerificationPath('PACKAGING')) === JSON.stringify(['INSTALLING', 'VERIFYING'])
      && JSON.stringify(legalInstallCompletionPath('PACKAGING', true)) === JSON.stringify(['INSTALLING', 'VERIFYING', 'COMPLETE'])
      && LEGAL_TRANSITIONS.PACKAGING.includes('INSTALLING')
      && !LEGAL_TRANSITIONS.PACKAGING.includes('COMPLETE')
      && FOUNDRY_TERMINAL_STATES.includes('COMPLETE')
      && FOUNDRY_TERMINAL_STATES.includes('CANCELLED'),
    legalInstallCompletionPath('PACKAGING', true).join('→'),
  ))
  results.push(check(
    'cancelled_has_no_complete_edge',
    LEGAL_TRANSITIONS.CANCELLED.length === 0 && legalInstallCompletionPath('CANCELLED', true).length === 0,
    JSON.stringify(LEGAL_TRANSITIONS.CANCELLED),
  ))
  results.push(check(
    'closer_walks_packaging_without_json_force',
    /Package artifacts present; enter INSTALLING before VERIFYING/.test(closer)
      && /transitionMission\(/.test(closer)
      && !/mission\.status = 'COMPLETE'/.test(closer),
    'legal INSTALLING hop',
  ))
  results.push(check(
    'idle_ready_uses_null_current_work',
    /commanderStatusHeadline/.test(source('components/war-room/foundry/FoundryShell.tsx'))
      && /liveWork: Boolean\(liveWork\)/.test(source('components/war-room/foundry/FoundryShell.tsx')),
    'headline from live work',
  ))
  results.push(check(
    'acceptance_uses_electron_computer_use_not_playwright_proof',
    /captureInstalledUiPng/.test(acceptNew)
      && /computer\.click/.test(acceptNew)
      && /listElectronCdpTargets/.test(acceptNew)
      && !/browser\.start/.test(acceptNew)
      && !/browser\.navigate/.test(acceptNew),
    'native Electron path',
  ))
  results.push(check(
    'guest_webcontents_remain_isolated',
    /nodeIntegration:\s*false/.test(browser)
      && /sandbox:\s*true/.test(browser)
      && /PARTITION = 'persist:war-room-browser'/.test(browser)
      && !/preload:/.test(browser),
    'no privileged preload',
  ))
  results.push(check(
    'cdp_can_scope_open_within_project_card',
    /within/.test(computerCdp) && /within/.test(computer),
    'within selector',
  ))
  results.push(check(
    'media_dock_music_note_bottom_center',
    /bottom-3 left-1\/2/.test(mediaHost) && /data-media-dock="bottom-center"/.test(mediaHost) && /IconMusicNote/.test(mediaLauncher) && /tab === 'radio'/.test(mediaTabs) && /operational = MEDIA_TABS.filter\(tab => tab === 'radio'\)/.test(mediaTabs),
    'media dock contract',
  ))
  results.push(check(
    'wrapper_old_accept_exits_after_report',
    /releaseMissionWrapperResources/.test(acceptOld) && /process\.exit\(process\.exitCode \?\? 0\)/.test(acceptOld),
    'operationalization wrapper exit',
  ))
  results.push(check(
    'wrapper_new_accept_exits_without_killing_runtime',
    /releaseMissionWrapperResources/.test(acceptNew)
      &&     /process\.exit\(process\.exitCode \?\? 0\)/.test(acceptNew)
      && !/SIGKILL/.test(acceptNew)
      && /forceRelaunch/.test(acceptNew)
      && /closeAllFoundryTerminals/.test(acceptNew),
    'final accept exit + governed restart',
  ))
  results.push(check(
    'wrapper_does_not_kill_installed_runtime_for_exit',
    !/kill\(.*, 'SIGKILL'\)/.test(acceptNew) && !/runtime\.stop_installed/.test(acceptNew),
    'no SIGKILL/stop_installed in wrapper exit',
  ))

  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  }
  console.log(`${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  run()
}
