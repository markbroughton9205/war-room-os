/**
 * HVS-RAEL-HUMAN-02 — official MHC foundation + local still bind + TAKE 3 body fallback.
 * `pnpm run validate:hvs-rael-human-02`
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { RAEL_CHARACTER_ID } from './digital-human/types'
import {
  HVS_FACE_REFERENCE_REQUIRED,
  jpegDimensions,
  readFaceReferenceSet,
} from './digital-human/face-reference'
import { detectUnrealRuntime } from './unreal/detect'
import {
  HVS_UE01_MOTION_ID,
  HVS_UE01_PROJECT_ID,
  HVS_UE01_TAKE_ID,
  HVS_UE02_UPROJECT,
  loadHvsProject,
} from './unreal/package'
import { readUnrealScenePackage } from './unreal/storage'
import { detectMetaHumanSupport, deferredPlugins } from './unreal/metahuman-detect'
import {
  HVS_HUMAN02_BRIDGE,
  HVS_HUMAN02_PROOF,
  HVS_MHC_RESERVED_MARKER,
  HVS_MHC_RESERVED_PATH,
  HVS_MHC_UASSET,
  ensureMetaHumanBinding,
} from './unreal/metahuman-binding'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const started = process.hrtime.bigint()
const face = readFaceReferenceSet(HVS_UE01_PROJECT_ID)
const binding = ensureMetaHumanBinding(HVS_UE01_PROJECT_ID)
const detect = detectMetaHumanSupport()
const pkg = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
const manny = pkg?.characters[0]?.binding
const derived = loadHvsProject(HVS_UE01_PROJECT_ID)
const uproject = JSON.parse(readFileSync(HVS_UE02_UPROJECT, 'utf8')) as { Plugins?: Array<{ Name: string; Enabled?: boolean }> }
const enabled = new Set((uproject.Plugins ?? []).filter(item => item.Enabled).map(item => item.Name))
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const py = source('lib/media-command/unreal/hvs_human02_mhc.py')
const bindSrc = source('lib/media-command/unreal/metahuman-binding.ts')
const applySrc = source('lib/media-command/unreal/apply-human02-binding.ts')
const ui = source('components/war-room/higher-vision-studios/HvsFaceReferencePanel.tsx')
const packageJson = source('package.json')
const proof = existsSync(HVS_HUMAN02_PROOF) ? JSON.parse(readFileSync(HVS_HUMAN02_PROOF, 'utf8')) as Record<string, unknown> : null
const bridge = existsSync(HVS_HUMAN02_BRIDGE) ? JSON.parse(readFileSync(HVS_HUMAN02_BRIDGE, 'utf8')) as Record<string, unknown> : null
const marker = existsSync(HVS_MHC_RESERVED_MARKER) ? JSON.parse(readFileSync(HVS_MHC_RESERVED_MARKER, 'utf8')) as Record<string, unknown> : null
const forbidden = /face-api|insightface|rekognition|cloudinary|RequestAutoRigging|request_auto_rigging/i
const requiredOk = HVS_FACE_REFERENCE_REQUIRED.every(type => {
  const still = face.stills[type]
  return Boolean(still?.accepted && still.file && existsSync(still.file) && statSync(still.file).size > 20000)
})
const dims = HVS_FACE_REFERENCE_REQUIRED.map(type => {
  const still = face.stills[type]
  const file = still?.file ?? ''
  const jpeg = existsSync(file) ? jpegDimensions(readFileSync(file)) : null
  return `${type}:${jpeg?.width ?? 0}x${jpeg?.height ?? 0}:${existsSync(file) ? statSync(file).size : 0}`
})
const mhcExists = existsSync(HVS_MHC_UASSET)

expect('accepted_5_of_5', face.status === 'REFERENCE CAPTURED' && requiredOk && HVS_FACE_REFERENCE_REQUIRED.filter(type => face.stills[type]?.accepted).length === 5, dims.join(','))
expect('optional_smile_ok', !face.stills.FRONT_SMILE || face.stills.FRONT_SMILE.accepted === true, String(face.stills.FRONT_SMILE?.accepted))
expect('one_identity', binding.characterId === RAEL_CHARACTER_ID && binding.identityId === RAEL_CHARACTER_ID && binding.notASecondIdentity === true, binding.characterId)
expect('plugins', detect.creatorPlugin === 'YES' && detect.rigLogic === 'YES' && detect.coreData === 'YES' && detect.linuxSupport === 'DETECTED', `${detect.creatorPlugin}/${detect.rigLogic}/${detect.coreData}`)
expect('animator_off', !enabled.has('MetaHuman') && !enabled.has('MetaHumanLiveLink') && deferredPlugins().every(name => !enabled.has(name) || name === 'MetaHumanSDK'), [...enabled].join(','))
expect('mhc_path', binding.metahumanCharacterPath === HVS_MHC_RESERVED_PATH && existsSync(HVS_MHC_RESERVED_MARKER), binding.metahumanCharacterPath)
expect('mhc_advanced', binding.assetState === 'CREATED' || binding.assetState === 'RESERVED', `${binding.assetState}/uasset=${mhcExists}`)
expect('cine', binding.assemblyPipeline === 'CINE' && binding.wardrobeIntent === 'RAEL_BLACK_SUIT' && binding.bodyOverrideFromWebcam === false, binding.assemblyPipeline)
expect('no_fake_dna', binding.rigLogic.dnaPresent === false && binding.rigLogic.dnaAssetPath === null && binding.likeness === 'NOT_FINAL', JSON.stringify(binding.rigLogic))
expect('animator_not_started', binding.animator === 'NOT_STARTED' && binding.liveLink === 'NOT_ENABLED', `${binding.animator}/${binding.liveLink}`)
expect('stills_bound', (binding.likenessInput?.acceptedRequired ?? 0) === 5 && (binding.likenessInput?.stills.length ?? 0) >= 5, JSON.stringify(binding.likenessInput?.acceptedRequired))
expect('take3', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3.uasset') && existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3_Manny.uasset') && binding.take3Preserved && binding.bodyExecution?.takeId === HVS_UE01_TAKE_ID && binding.bodyExecution.motionId === HVS_UE01_MOTION_ID, HVS_UE01_TAKE_ID)
expect('manny_fallback', manny?.adapter === 'GENERIC_UE_HUMANOID' && manny?.metahumanCharacterPath == null && binding.bodyExecution?.fallback === 'MANNY_BODY_TEST_REFERENCE', String(manny?.adapter))
expect('same_ids', derived?.id === HVS_UE01_PROJECT_ID && pkg?.characters[0]?.performanceTakeId === HVS_UE01_TAKE_ID && pkg?.performances[0]?.motionId === HVS_UE01_MOTION_ID, `${derived?.id}/${HVS_UE01_MOTION_ID}`)
expect('three_js', viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')") && !/getUserMedia/.test(viewport), 'previs')
expect('local_only', face.localOnly === true && face.consentScope.cloud === false && face.consentScope.embeddings === false && face.consentScope.identityRecognition === false && face.consentScope.animatorSolve === false, face.consent)
expect('no_autoroot', !forbidden.test(py + bindSrc + applySrc) && py.includes('autoRigCalled') && ui.includes('Likeness:'), 'no autoroot')
expect('bridge_file', Boolean(bridge && bridge.characterId === RAEL_CHARACTER_ID && bridge.assemblyPipeline === 'CINE' && bridge.animator === 'NOT_STARTED'), HVS_HUMAN02_BRIDGE)
expect('camera_not_required', face.cameraDefaultOff === true && !py.includes('getUserMedia'), 'camera off')
expect('proof_no_cloud', !proof || (proof.autoRigCalled === false && proof.cloud === false && proof.likenessConformed === false && proof.animatorEnabled === false), JSON.stringify(proof ? { autoRig: proof.autoRigCalled, cloud: proof.cloud } : 'no-ue-proof-yet'))
expect('marker', marker?.characterId === RAEL_CHARACTER_ID && marker?.likeness === 'NOT_FINAL' && (marker?.state === 'CREATED' || marker?.state === 'RESERVED'), JSON.stringify(marker?.state))
expect('ue04_untouched', Boolean(existsSync('/home/chosenone/HVSRuntime/Content/HVS/Characters/Rigs/RTG_HVS_To_Manny.uasset') && manny?.animationSequencePath?.includes('AN_Rael_Take3_Manny')), String(manny?.animationSequencePath))
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('validate_script', packageJson.includes('validate:hvs-rael-human-02') && packageJson.includes('hvs.rael-human-02.local.validation.ts'), 'script')
expect('no_home_metahumans', !existsSync('/home/chosenone/MetaHumans') && !existsSync('/home/chosenone/HVSRuntime/Content/MetaHumans'), 'no fab dir')

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  assetState: binding.assetState,
  mhcUasset: mhcExists,
  faceStatus: face.status,
  gate: binding.conformGate?.code ?? null,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
