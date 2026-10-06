/**
 * HVS-DIRECTOR-CHARACTER-03B — persistent interactive Unreal + real MetaHuman Creator open.
 * `pnpm run validate:hvs-character-operator-step`
 */
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { HVS_UE01_PROJECT_ID } from './unreal/package'
import {
  formatUnrealLaunchCommand,
  isHvsUnrealEditorCommand,
  probeUnrealStability,
  unrealLaunchArgs,
} from './unreal/process'
import {
  HVS_OPERATOR_STEP_FAILED,
  HVS_OPERATOR_STEP_OPEN_LABEL,
  HVS_OPERATOR_STEP_OPENING,
  HVS_OPERATOR_STEP_OPENING_MHC,
  HVS_OPERATOR_STEP_READY,
  HVS_OPERATOR_STEP_RETRY,
  HVS_OPERATOR_STEP_WAITING,
  HVS_RAEL_MHC_PATH,
} from './character-production/types'
import { characterProductionPath } from './character-production/persist'
import { hvsCharacterProductionOrchestrator } from './character-production/orchestrator'
import { unrealPackageDir } from './unreal/storage'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const started = process.hrtime.bigint()
const projectId = HVS_UE01_PROJECT_ID
const productionFile = characterProductionPath(projectId)
const requestFile = path.join(unrealPackageDir(projectId), 'character-ops', 'hvs_unreal_character_conform.request.json')
const productionBackup = `${productionFile}.operator-step-validate-bak`
const requestBackup = `${requestFile}.operator-step-validate-bak`

const ui = source('components/war-room/higher-vision-studios/HvsCharacterProductionPanel.tsx')
const css = source('components/war-room/higher-vision-studios/hvs-digital-human.css')
const route = source('app/api/media-command/character-production/route.ts')
const orch = source('lib/media-command/character-production/orchestrator.ts')
const adapter = source('lib/media-command/character-production/likeness-adapter.ts')
const processSrc = source('lib/media-command/unreal/process.ts')
const py = source('lib/media-command/unreal/hvs_likeness_ops.py')
const initPy = source('lib/media-command/unreal/hvs_init_unreal.py')
const packageJson = source('package.json')
const openRequiredFn = adapter.slice(adapter.indexOf('openRequiredStep('), adapter.indexOf('requestEpicSignIn('))

if (existsSync(productionFile)) copyFileSync(productionFile, productionBackup)
else if (existsSync(productionBackup)) rmSync(productionBackup)
if (existsSync(requestFile)) copyFileSync(requestFile, requestBackup)
else if (existsSync(requestBackup)) rmSync(requestBackup)

try {
  const dry = hvsCharacterProductionOrchestrator.openRequiredStep(projectId, { launchUnreal: false })
  const request = existsSync(requestFile)
    ? JSON.parse(readFileSync(requestFile, 'utf8')) as Record<string, unknown>
    : null
  const persistArgs = unrealLaunchArgs(undefined, { interactive: true, persist: true })
  const persistCmd = formatUnrealLaunchCommand(undefined, { interactive: true, persist: true })
  const scriptedArgs = unrealLaunchArgs('/tmp/hvs_likeness_ops.py', { interactive: true })
  const earlyFail = probeUnrealStability(projectId, null)

  expect(
    'button_rendered',
    ui.includes('data-testid="hvs-open-required-step"')
      && ui.includes('type="button"')
      && ui.includes('HVS_OPERATOR_STEP_OPEN_LABEL')
      && ui.includes('hvs-actor-actions'),
    'typed button in actor-actions',
  )
  expect(
    'button_enabled_operator_attention',
    ui.includes("operatorGate?.kind === 'CREATOR_LANDMARK'")
      && ui.includes('disabled={stepBusy}'),
    'enabled unless opening/waiting/opening MHC',
  )
  expect(
    'typed_api',
    route.includes("body.action === 'open-required-step'")
      && route.includes('hvsCharacterProductionOrchestrator.openRequiredStep')
      && ui.includes("action: 'open-required-step'")
      && orch.includes('OPEN_REQUIRED_STEP'),
    'open-required-step',
  )
  expect('canonical_mhc', HVS_RAEL_MHC_PATH === '/Game/HVS/Characters/Rael/MHC_Rael_Commander' && openRequiredFn.includes('HVS_RAEL_MHC_PATH') && request?.mhc === HVS_RAEL_MHC_PATH, HVS_RAEL_MHC_PATH)
  expect('no_cloud_side_effect', request?.executeCloud === false && request?.action === 'open_mhc' && dry.operatorStepUi?.executeCloud === false && /executeCloud:\s*false/.test(openRequiredFn), String(request?.executeCloud))
  expect('no_autorig', !/request_auto_rigging|RequestAutoRigging|executeCloud:\s*true/.test(openRequiredFn) && dry.operatorStepUi?.autoRigCalled === false && py.includes('if request.get("executeCloud") is True'), 'open_mhc only')
  expect('no_second_identity', orch.includes('notASecondIdentity: true') && !/second identity|new MetaHuman|browse Content Browser/i.test(openRequiredFn), 'rael-commander only')
  expect(
    'interactive_launch_mode',
    persistArgs.includes('/home/chosenone/HVSRuntime/HVSRuntime.uproject')
      && persistArgs.includes('-nosplash')
      && !persistArgs.some(arg => arg.includes('-unattended') || arg.includes('nullrhi') || arg.includes('renderoffscreen') || arg.includes('commandlet') || arg.includes('ExecutePythonScript'))
      && persistCmd.includes('DISPLAY=:0')
      && persistCmd.includes('XDG_RUNTIME_DIR=/run/user/1000')
      && persistCmd.includes('XDG_SESSION_TYPE=x11')
      && persistCmd.includes('SDL_VIDEODRIVER=x11')
      && persistCmd.includes('SDL_VIDEO_DRIVER=x11')
      && persistCmd.includes('env -u WAYLAND_DISPLAY')
      && processSrc.includes('ensureInteractiveUnrealEditor')
      && openRequiredFn.includes('ensureInteractiveUnrealEditor'),
    persistCmd,
  )
  expect(
    'persistent_editor_lifecycle',
    processSrc.includes('options?.persist')
      && processSrc.includes('FEditorPythonExecuter')
      && processSrc.includes('QUIT_EDITOR')
      && !openRequiredFn.includes('ExecutePythonScript')
      && initPy.includes('start_operator_step_poller')
      && py.includes('editor stays open'),
    'persist launch omits ExecutePythonScript',
  )
  expect(
    'no_shutdown_after_open_mhc',
    !py.includes('QUIT_EDITOR')
      && !py.includes('request_exit')
      && !py.includes('sys.exit')
      && py.includes('quitEditor": False')
      && processSrc.includes('if (options?.persist) return args')
      && scriptedArgs.some(arg => arg.includes('ExecutePythonScript')),
    'open_mhc does not define editor lifetime',
  )
  expect(
    'one_instance_reuse',
    processSrc.includes("if (current.status === 'RUNNING') return")
      && (openRequiredFn.includes('duplicateRefused') || adapter.includes('duplicateRefused'))
      && processSrc.includes('ensureInteractiveUnrealEditor')
      && processSrc.includes("duplicateRefused: true"),
    'reuse running HVSRuntime',
  )
  expect(
    'pgrep_ignores_sandbox',
    isHvsUnrealEditorCommand('1234 cursorsandbox UnrealEditor HVSRuntime') === false
      && isHvsUnrealEditorCommand('3340886 /home/chosenone/Unreal/Engine/Binaries/Linux/UnrealEditor /home/chosenone/HVSRuntime/HVSRuntime.uproject') === true
      && isHvsUnrealEditorCommand('99 pgrep -af UnrealEditor') === false,
    'HVSRuntime only',
  )
  expect(
    'asset_editor_open_request',
    py.includes('AssetEditorSubsystem')
      && py.includes('open_editor_for_assets')
      && py.includes('AssetTypeActivationOpenedMethod.EDIT')
      && py.includes('assetEditorOpened')
      && !py.includes('find_editor_for_asset')
      && !openRequiredFn.includes('try_add_object_to_edit'),
    'AssetEditorSubsystem.open_editor_for_assets',
  )
  expect(
    'ready_delayed_until_stability',
    orch.includes('probeUnrealStability')
      && orch.includes('operatorStepMhcProofReady')
      && orch.includes("status === 'OPENING_MHC'")
      && !orch.includes("if (ui.status === 'OPENING' && processStatus === 'RUNNING') {\n    return {\n      ...ui,\n      status: 'READY'")
      && dry.operatorStepUi?.status !== 'READY'
      && HVS_OPERATOR_STEP_WAITING === 'WAITING FOR UNREAL...'
      && HVS_OPERATOR_STEP_OPENING_MHC === 'OPENING METAHUMAN CREATOR...',
    dry.operatorStepUi?.status ?? 'missing',
  )
  expect(
    'stability_probe',
    processSrc.includes('HVS_UNREAL_STABILITY_MS = 3000')
      && earlyFail.alive === false
      && earlyFail.stable === false
      && probeUnrealStability(projectId, new Date(Date.now() - 100).toISOString()).stable === false,
    `${earlyFail.elapsedMs}ms`,
  )
  expect(
    'failure_when_process_exits_early',
    ui.includes('HVS_OPERATOR_STEP_FAILED')
      && HVS_OPERATOR_STEP_FAILED === 'UNREAL COULD NOT STAY OPEN'
      && orch.includes('HVS_UNREAL_LAUNCH_GRACE_MS')
      && (dry.unrealProcess.status === 'STOPPED' ? dry.operatorStepUi?.status === 'FAILED' : true),
    dry.operatorStepUi?.status ?? 'missing',
  )
  expect(
    'retry',
    ui.includes('hvs-open-required-step-retry')
      && ui.includes('HVS_OPERATOR_STEP_RETRY')
      && HVS_OPERATOR_STEP_RETRY === 'RETRY',
    'RETRY',
  )
  expect(
    'resume_remains_separate',
    ui.includes('data-testid="hvs-resume-build"')
      && ui.includes("action: 'resume'")
      && ui.includes('async function resume()')
      && ui.includes('async function openRequiredStep()')
      && !openRequiredFn.includes("'resume'"),
    `${dry.primaryCta ?? 'none'}/${dry.productionState}`,
  )
  expect(
    'opening_ready_copy',
    HVS_OPERATOR_STEP_OPENING === 'OPENING UNREAL...'
      && HVS_OPERATOR_STEP_READY.includes('UNREAL READY')
      && HVS_OPERATOR_STEP_OPEN_LABEL === 'OPEN REQUIRED STEP'
      && ui.includes('HVS_OPERATOR_STEP_WAITING')
      && ui.includes('HVS_OPERATOR_STEP_OPENING_MHC'),
    HVS_OPERATOR_STEP_OPEN_LABEL,
  )
  expect('styled_clickable', css.includes('.hvs-actor-actions button') && css.includes('cursor: pointer'), 'actor-actions cursor')
  expect(
    'python_open_mhc_only',
    py.includes('def consume_operator_step')
      && py.includes('editors.open_editor_for_assets')
      && py.includes('MHC_PATH = "/Game/HVS/Characters/Rael/MHC_Rael_Commander"')
      && py.includes('start_operator_step_poller()')
      && py.includes('consume_operator_step()')
      && !/poll_once\(\)/.test(py.slice(py.indexOf('if __name__'))),
    'open_mhc poller, no AutoRig main',
  )
  expect('separate_open_mhc', adapter.includes('function openCanonicalMetaHumanCharacter') && openRequiredFn.includes('openCanonicalMetaHumanCharacter') && openRequiredFn.includes('ensureInteractiveUnrealEditor'), 'ensure then open')
  expect('validate_script', packageJson.includes('validate:hvs-character-operator-step') && packageJson.includes('hvs.character-operator-step.local.validation.ts'), 'script')
} finally {
  if (existsSync(productionBackup)) renameSync(productionBackup, productionFile)
  else if (existsSync(productionFile)) rmSync(productionFile)
  if (existsSync(requestBackup)) renameSync(requestBackup, requestFile)
  else if (existsSync(requestFile)) rmSync(requestFile)
}

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
