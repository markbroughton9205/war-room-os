/**
 * HVS-DIRECTOR-CHARACTER-01 — Ra'el high-fidelity character production orchestrator.
 * `pnpm run validate:hvs-character-orchestrator`
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { MATRIX_EXTENSION_REQUIRED, RAEL_CHARACTER_ID } from './digital-human/types'
import { HVS_FACE_REFERENCE_REQUIRED, readFaceReferenceSet } from './digital-human/face-reference'
import { HVS_UE01_MOTION_ID, HVS_UE01_PROJECT_ID, HVS_UE01_TAKE_ID } from './unreal/package'
import { readUnrealScenePackage } from './unreal/storage'
import { HVS_MHC_RESERVED_PATH } from './unreal/metahuman-binding'
import { formatUnrealLaunchCommand, inspectUnrealProcess } from './unreal/process'
import { canonicalBuildOperationId, HVS_CHARACTER_BUILD_OPERATION, HVS_RAEL_MHC_PATH } from './character-production/types'
import { characterAuthorityPath, characterProductionPath, characterSubmissionPath, readCharacterProduction } from './character-production/persist'
import { hvsCharacterProductionOrchestrator } from './character-production/orchestrator'
import { resolveProductionIntent, resolveUseRael } from './character-production/director'
import { preservesHuman01Locks } from './character-production/privacy'

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
const authorityFile = characterAuthorityPath(projectId)
const submissionFile = characterSubmissionPath(projectId)
const backup = `${productionFile}.validate-bak`
const authorityBackup = `${authorityFile}.validate-bak`
const submissionBackup = `${submissionFile}.validate-bak`
const hadProduction = existsSync(productionFile)
if (hadProduction) renameSync(productionFile, backup)
else if (existsSync(backup)) rmSync(backup)
if (existsSync(authorityFile)) renameSync(authorityFile, authorityBackup)
else if (existsSync(authorityBackup)) rmSync(authorityBackup)
if (existsSync(submissionFile)) renameSync(submissionFile, submissionBackup)
else if (existsSync(submissionBackup)) rmSync(submissionBackup)

try {
  const face = readFaceReferenceSet(projectId)
  const pkg = readUnrealScenePackage(projectId)
  const manny = pkg?.characters[0]?.binding
  const clean = hvsCharacterProductionOrchestrator.snapshot(projectId)
  const first = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: false, now: '2026-09-23T19:00:00.000Z' })
  const second = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: false, now: '2026-09-23T19:05:00.000Z' })
  const persisted = readCharacterProduction(projectId)
  const director = resolveUseRael(projectId)
  const intent = resolveProductionIntent("Put Ra'el in a black suit walking through a rainy alley", projectId)
  const process = inspectUnrealProcess(projectId)
  const launch = formatUnrealLaunchCommand()
  const ui = source('components/war-room/higher-vision-studios/HvsCharacterProductionPanel.tsx')
  const screen = source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx')
  const orch = source('lib/media-command/character-production/orchestrator.ts')
  const ops = source('lib/media-command/unreal/character-ops.ts')
  const py = source('lib/media-command/unreal/hvs_character_ops.py')
  const detect = source('lib/media-command/unreal/detect.ts')
  const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
  const packageJson = source('package.json')
  const route = source('app/api/media-command/character-production/route.ts')
  const forbidden = /openai|anthropic|https:\/\/api\.|rekognition|insightface|face-api|cloudinary|RequestAutoRigging|request_auto_rigging/i

  const op = first.operation
  const receipts = op?.receipts ?? []
  const faceReceipt = receipts.find(item => item.stage === 'FACE_REFERENCES')
  const assembly = receipts.find(item => item.stage === 'ASSEMBLY')
  const originalBody = receipts.find(item => item.stage === 'BODY_BIND')?.status
  const originalCinema = receipts.find(item => item.stage === 'CAMERA_BIND')?.status
  const originalTakeConnected = first.bodyPerformance.connected
  const originalLenses = first.cinema.shots.map(item => item.lensMm).join(',')
  const conform = receipts.find(item => item.stage === 'CONFORM')

  if (op && assembly) {
    assembly.status = 'FAILED'
    assembly.errorCode = 'ASSEMBLY_TEST_FAIL'
    const later = receipts.filter(item => ['BODY_BIND', 'CAMERA_BIND', 'VALIDATION', 'PREVIEW'].includes(item.stage))
    for (const item of later) {
      item.status = 'PENDING'
      item.completedAt = null
    }
    writeFileSync(productionFile, `${JSON.stringify(op, null, 2)}\n`)
  }
  const resumed = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: false, resume: true, now: '2026-09-23T19:10:00.000Z' })
  const resumedFace = resumed.operation?.receipts.find(item => item.stage === 'FACE_REFERENCES')
  const resumedAssembly = resumed.operation?.receipts.find(item => item.stage === 'ASSEMBLY')
  const resumedPrereq = resumed.operation?.receipts.find(item => item.stage === 'PREREQUISITES')

  expect('accepted_5_of_5', face.status === 'REFERENCE CAPTURED' && HVS_FACE_REFERENCE_REQUIRED.every(type => face.stills[type]?.accepted), `${HVS_FACE_REFERENCE_REQUIRED.filter(type => face.stills[type]?.accepted).length}/5`)
  expect('ready_to_build', clean.productionState === 'CHARACTER_READY_TO_BUILD' && clean.primaryCta === "BUILD RA'EL" && !clean.operation, clean.productionState)
  expect('one_operation', first.operation?.kind === HVS_CHARACTER_BUILD_OPERATION && first.operation.operationId === canonicalBuildOperationId(RAEL_CHARACTER_ID), first.operation?.operationId ?? 'missing')
  expect('one_rael', first.operation?.characterId === RAEL_CHARACTER_ID && first.operation.identityId === RAEL_CHARACTER_ID && first.operation.notASecondIdentity === true, first.operation?.characterId ?? 'missing')
  expect('no_duplicate_build', second.operation?.operationId === first.operation?.operationId && second.operation?.authorizedAt === first.operation?.authorizedAt, `${second.operation?.operationId}/${second.operation?.authorizedAt}`)
  expect('stage_persistence', Boolean(persisted && persisted.operationId === first.operation?.operationId && persisted.receipts.length === 9), String(persisted?.receipts.length ?? 0))
  expect('resume_keeps_face', resumedFace?.status === 'COMPLETE' && resumedPrereq?.status === 'COMPLETE' && resumedAssembly?.status === 'COMPLETE', `${resumedFace?.status}/${resumedAssembly?.status}`)
  expect('bridge_reuse', ops.includes("from './package'") && ops.includes("from './storage'") && orch.includes('dispatchUnrealCharacterOp') && !/second bridge|new Unreal bridge/i.test(orch + ops), 'existing bridge')
  expect('take3_auto', originalBody === 'COMPLETE' && originalTakeConnected && first.bodyPerformance.takeId === HVS_UE01_TAKE_ID && first.bodyPerformance.motionId === HVS_UE01_MOTION_ID && resumed.operation?.receipts.find(item => item.stage === 'BODY_BIND')?.status === 'COMPLETE', `${originalBody}/${HVS_UE01_TAKE_ID}`)
  expect('cinema_auto', originalCinema === 'COMPLETE' && originalLenses === '24,24,24,85' && resumed.operation?.receipts.find(item => item.stage === 'CAMERA_BIND')?.status === 'COMPLETE', first.cinema.shots.map(item => `${item.name}:${item.lensMm}`).join(','))
  expect('privacy', Boolean(first.operation && preservesHuman01Locks(first.operation) && face.localOnly && face.consentScope.cloud === false && face.consentScope.embeddings === false), JSON.stringify(first.operation?.privacy))
  expect('three_js', Boolean(viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')") && first.operation?.previews.some(item => item.renderer === 'THREE_JS')), 'previs')
  expect('manny_preserved', manny?.adapter === 'GENERIC_UE_HUMANOID' && manny?.metahumanCharacterPath == null && first.operation?.mannyRole === 'BODY_TEST_REFERENCE', String(manny?.adapter))
  expect('tech_collapsed', ui.includes('TECHNICAL DETAILS') && ui.includes('hvs-tech-details') && !ui.includes('<details open') && ui.includes('ADVANCED'), 'collapsed')
  expect('no_raw_exception_ui', ui.includes('Build could not finish.') && !/stack_trace|err\.stack|String\(err\)/.test(ui) && route.includes("message: 'Build could not finish.'"), 'plain error')
  expect('local_unreal_bridge', launch.includes('/home/chosenone/Unreal/Engine/Binaries/Linux/UnrealEditor') && launch.includes('HVSRuntime.uproject') && launch.includes('DISPLAY=:0') && launch.includes('SDL_VIDEODRIVER=x11') && launch.includes('env -u WAYLAND_DISPLAY') && detect.includes('Does not install, download, or launch'), launch)
  expect('mhc_path', HVS_RAEL_MHC_PATH === HVS_MHC_RESERVED_PATH && first.operation?.metahumanCharacterPath === HVS_MHC_RESERVED_PATH, HVS_RAEL_MHC_PATH)
  expect('director_use_rael', director.characterId === RAEL_CHARACTER_ID && director.phrase === "Use Ra'el" && intent.generativeVideo === false && intent.wardrobeIntent === 'RAEL_BLACK_SUIT', director.characterId)
  expect('face_not_recaptured', Boolean(faceReceipt?.notes.some(note => /Existing accepted set reused/i.test(note))), faceReceipt?.notes.join(';') ?? '')
  expect('ui_on_characters', screen.includes('HvsCharacterProductionPanel') && ui.includes('BUILD RA&apos;EL') && ui.includes('CAPTURE FACIAL PERFORMANCE') && ui.includes('hvs-build-rael'), 'ui')
  expect('no_manual_prompt', !/ChatGPT|cursor prompt|paste JSON/i.test(ui) && ui.includes('BUILD RA&apos;EL'), 'no prompt')
  expect('process_status', process.status === 'RUNNING' || process.status === 'STOPPED' || process.status === 'UNRESPONSIVE', process.status)
  expect('same_ids', pkg?.characters[0]?.performanceTakeId === HVS_UE01_TAKE_ID && pkg?.performances[0]?.motionId === HVS_UE01_MOTION_ID, HVS_UE01_MOTION_ID)
  expect('no_cloud', !forbidden.test(orch + ops + py + ui + route) && py.includes('autoRigCalled') && py.includes('False'), 'local')
  expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
  expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)
  expect('validate_script', packageJson.includes('validate:hvs-character-orchestrator') && packageJson.includes('hvs.character-orchestrator.local.validation.ts'), 'script')
  expect('blocked_plain', Boolean(conform && (conform.status === 'BLOCKED' || conform.status === 'COMPLETE')) && source('lib/media-command/character-production/view.ts').includes("RA'EL BUILD NEEDS YOUR ATTENTION"), conform?.status ?? 'missing')
  expect('camera_not_auto', ui.includes('The camera stays off until you start it') && !/getUserMedia/.test(ui), 'camera off')
} finally {
  if (existsSync(backup)) renameSync(backup, productionFile)
  else if (existsSync(productionFile)) rmSync(productionFile)
  if (existsSync(authorityBackup)) renameSync(authorityBackup, authorityFile)
  else if (existsSync(authorityFile)) rmSync(authorityFile)
  if (existsSync(submissionBackup)) renameSync(submissionBackup, submissionFile)
  else if (existsSync(submissionFile)) rmSync(submissionFile)
}

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  matrix: HVS_MATRIX_ROWS.length,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
