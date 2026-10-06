/**
 * HVS-RAEL-HUMAN-01 — Ra'el high-fidelity human foundation + Commander face-reference capture.
 * `pnpm run validate:hvs-rael-human-foundation`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { RAEL_CHARACTER_ID } from './digital-human/types'
import { identityActionAllowed } from './digital-human/authority'
import {
  assessFaceStill,
  emptyFaceReferenceSet,
  HVS_FACE_CONSENT,
  HVS_FACE_REFERENCE_OPTIONAL,
  HVS_FACE_REFERENCE_REQUIRED,
  jpegDimensions,
  readFaceReferenceSet,
  retakeStill,
  saveCapturedStill,
} from './digital-human/face-reference'
import { detectUnrealRuntime } from './unreal/detect'
import {
  HVS_UE01_MOTION_ID,
  HVS_UE01_PROJECT_ID,
  HVS_UE01_TAKE_ID,
  HVS_UE02_UPROJECT,
  buildUnrealScenePackage,
  loadHvsProject,
} from './unreal/package'
import { readUnrealScenePackage } from './unreal/storage'
import { detectMetaHumanSupport, deferredPlugins, requiredCreatorPlugins } from './unreal/metahuman-detect'
import {
  HVS_MHC_RESERVED_MARKER,
  HVS_MHC_RESERVED_PATH,
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
const detect = detectMetaHumanSupport()
const binding = ensureMetaHumanBinding(HVS_UE01_PROJECT_ID)
const pkg = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
const derived = loadHvsProject(HVS_UE01_PROJECT_ID)
const rebuilt = derived ? buildUnrealScenePackage(derived, 'status') : null
const manny = pkg?.characters[0]?.binding
const face = readFaceReferenceSet(HVS_UE01_PROJECT_ID)
const uproject = JSON.parse(readFileSync(HVS_UE02_UPROJECT, 'utf8')) as { Plugins?: Array<{ Name: string; Enabled?: boolean }> }
const enabled = new Set((uproject.Plugins ?? []).filter(item => item.Enabled).map(item => item.Name))
const ui = source('components/war-room/higher-vision-studios/HvsFaceReferencePanel.tsx')
const screen = source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx')
const api = source('app/api/media-command/face-reference/route.ts')
const faceSrc = source('lib/media-command/digital-human/face-reference.ts')
const bindSrc = source('lib/media-command/unreal/metahuman-binding.ts')
const detectSrc = source('lib/media-command/unreal/metahuman-detect.ts')
const bodySrc = source('lib/media-command/digital-human/skinned-body.ts')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const packageJson = source('package.json')
const forbidden = /face-api|insightface|rekognition|cloudinary|openai|anthropic|https:\/\/api\./i
const jpegProbe = jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))

expect('creator_plugin', detect.creatorPlugin === 'YES' && detect.creatorFriendlyName === 'MetaHuman Creator', `${detect.creatorPlugin}/${detect.creatorFriendlyName}`)
expect('core_data', detect.coreData === 'YES' && Boolean(detect.coreDataPath), `${detect.coreData}/${detect.coreDataPath}`)
expect('linux_support', detect.linuxSupport === 'DETECTED' && detect.linuxCreatorBinary && detect.linuxRigLogicBinary, detect.linuxSupport)
expect('riglogic_groom', detect.rigLogic === 'YES' && detect.groom === 'YES' && detect.controlRig === 'YES' && detect.ikRig === 'YES', `${detect.rigLogic}/${detect.groom}`)
expect('plugins_enabled', requiredCreatorPlugins().every(item => enabled.has(item.name)), [...enabled].join(','))
expect('animator_not_enabled', !enabled.has('MetaHuman') && !enabled.has('MetaHumanLiveLink') && deferredPlugins().every(name => !enabled.has(name) || name === 'MetaHumanSDK'), [...enabled].join(','))
expect('one_identity', binding.characterId === RAEL_CHARACTER_ID && binding.identityId === RAEL_CHARACTER_ID && binding.notASecondIdentity === true, binding.characterId)
expect('reserved_mhc', binding.metahumanCharacterPath === HVS_MHC_RESERVED_PATH && (binding.assetState === 'RESERVED' || binding.assetState === 'CREATED') && existsSync(HVS_MHC_RESERVED_MARKER), `${binding.assetState}/${binding.metahumanCharacterPath}`)
expect('cine_neutral', binding.assemblyPipeline === 'CINE' && binding.body === 'NEUTRAL' && binding.bodyOverrideFromWebcam === false && binding.wardrobeIntent === 'RAEL_BLACK_SUIT', binding.assemblyPipeline)
expect('riglogic_no_fake_dna', binding.rigLogic.architecture === 'RIGLOGIC' && binding.rigLogic.dnaAssetPath === null && binding.rigLogic.dnaPresent === false, JSON.stringify(binding.rigLogic))
expect('likeness_not_final', binding.likeness === 'NOT_FINAL' && binding.animator === 'NOT_STARTED' && binding.liveLink === 'NOT_ENABLED', binding.likeness)
expect('manny_untouched', manny?.adapter === 'GENERIC_UE_HUMANOID' && manny?.metahumanCharacterPath == null && rebuilt?.characters[0]?.binding.metahumanCharacterPath == null, String(manny?.adapter))
expect('take3_preserved', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3.uasset') && existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3_Manny.uasset') && binding.take3Preserved && binding.mannyPreserved, HVS_UE01_TAKE_ID)
expect('same_ids', derived?.id === HVS_UE01_PROJECT_ID && pkg?.characters[0]?.performanceTakeId === HVS_UE01_TAKE_ID && pkg?.performances[0]?.motionId === HVS_UE01_MOTION_ID, `${derived?.id}/${HVS_UE01_MOTION_ID}`)
expect('face_slots', HVS_FACE_REFERENCE_REQUIRED.join(',') === 'FRONT_NEUTRAL,LEFT_THREE_QUARTER,RIGHT_THREE_QUARTER,LEFT_PROFILE,RIGHT_PROFILE' && HVS_FACE_REFERENCE_OPTIONAL[0] === 'FRONT_SMILE', HVS_FACE_REFERENCE_REQUIRED.join(','))
expect('face_status', face.status === 'REFERENCE CAPTURE REQUIRED' || face.status === 'REFERENCE CAPTURED', face.status)
expect('consent_local', face.consent === HVS_FACE_CONSENT && face.consentScope.captureOnly && !face.consentScope.training && !face.consentScope.cloud && !face.consentScope.embeddings && !face.consentScope.identityRecognition && !face.consentScope.animatorSolve, face.consent)
expect('camera_default_off', face.cameraDefaultOff === true && ui.includes('CAMERA OFF') && !/useEffect\([\s\S]{0,400}getUserMedia/.test(ui), 'off')
expect('explicit_start', ui.includes('Start camera') && ui.includes('getUserMedia') && api.includes("action === 'check-camera'") && api.includes('cameraStarted: false'), 'explicit')
expect('ui_section', screen.includes('HvsFaceReferencePanel') && ui.includes('High-fidelity Ra') && ui.includes('hvs-high-fidelity-rael'), 'ui')
expect('no_recognition', !forbidden.test(faceSrc + api + bindSrc + detectSrc + ui) && face.consentScope.embeddings === false && identityActionAllowed('commander', 'FACE_REFERENCE_ENROLLMENT') && !identityActionAllowed('director', 'FACE_REFERENCE_ENROLLMENT'), 'local')
expect('no_webcam_previs', !/getUserMedia|\/dev\/video|recordPerformanceTake|face-reference|captureFace/.test(bodySrc + viewport), 'previs clean')
expect('three_js', viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')"), 'previs')
expect('no_home_metahumans', !existsSync('/home/chosenone/MetaHumans') && !existsSync('/home/chosenone/HVSRuntime/Content/MetaHumans'), 'no fab dir')
expect('jpeg_gate', jpegProbe?.width === 640 && jpegProbe?.height === 480 && emptyFaceReferenceSet(HVS_UE01_PROJECT_ID).localOnly === true, JSON.stringify(jpegProbe))
expect('matrix_187', HVS_MATRIX_ROWS.length === 187 && detectUnrealRuntime().metahumanAssets === 'NOT_FOUND', String(HVS_MATRIX_ROWS.length))
expect('validate_script', packageJson.includes('validate:hvs-rael-human-foundation') && packageJson.includes('hvs.rael-human-foundation.local.validation.ts'), 'script')
expect('official_only', detect.officialOnly === true && detect.experimentalGenerator === 'PRESENT_NOT_ENABLED' && binding.officialOnly === true && binding.sourceOfTruth === 'HVS', detect.experimentalGenerator)

const FACE_REPAIR_PROJECT = 'hvs-face01-repair-test'
const emptySet = emptyFaceReferenceSet(FACE_REPAIR_PROJECT)
let missingBytesThrew = false
try {
  jpegDimensions(undefined)
  assessFaceStill({ meanLuma: 80, centerLuma: 90, sharpness: 12 })
} catch {
  missingBytesThrew = true
}
function syntheticJpeg(width = 640, height = 480, minBytes = 5000): Buffer {
  const comment = Buffer.alloc(Math.max(minBytes, 64), 0x41)
  const comLen = comment.length + 2
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xfe, (comLen >> 8) & 0xff, comLen & 0xff]),
    comment,
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]),
    Buffer.from([0xff, 0xd9]),
  ])
}
const probeBytes = syntheticJpeg()
function acceptedCount(projectId: string): number {
  const next = readFaceReferenceSet(projectId)
  return HVS_FACE_REFERENCE_REQUIRED.filter(type => next.stills?.[type]?.accepted).length
}
let captureThrew = false
let captureAccepted = -1
let usedAccepted = -1
let retakeAccepted = -1
let captureDims: { width: number; height: number } | null = null
try {
  retakeStill(FACE_REPAIR_PROJECT, 'FRONT_NEUTRAL')
  const captured = saveCapturedStill({
    projectId: FACE_REPAIR_PROJECT,
    type: 'FRONT_NEUTRAL',
    jpeg: probeBytes,
    meanLuma: 80,
    centerLuma: 90,
    sharpness: 20,
    accept: false,
  })
  captureAccepted = acceptedCount(FACE_REPAIR_PROJECT)
  captureDims = jpegDimensions(probeBytes)
  const used = saveCapturedStill({
    projectId: FACE_REPAIR_PROJECT,
    type: 'FRONT_NEUTRAL',
    jpeg: probeBytes,
    meanLuma: 80,
    centerLuma: 90,
    sharpness: 20,
    accept: true,
  })
  usedAccepted = acceptedCount(FACE_REPAIR_PROJECT)
  retakeStill(FACE_REPAIR_PROJECT, 'FRONT_NEUTRAL')
  retakeAccepted = acceptedCount(FACE_REPAIR_PROJECT)
  void captured
  void used
} catch (error) {
  captureThrew = true
  writeFileSync(path.join(process.cwd(), '.tmp', 'hvs-face01-repair-error.txt'), String(error))
}
retakeStill(FACE_REPAIR_PROJECT, 'FRONT_NEUTRAL')

expect('arrays_initialized', Array.isArray(emptySet.required) && Array.isArray(emptySet.optional) && emptySet.stills != null && typeof emptySet.stills === 'object', JSON.stringify({ required: emptySet.required.length, stills: Object.keys(emptySet.stills).length }))
expect('missing_bytes_safe', !missingBytesThrew, 'jpegDimensions/assessFaceStill must not throw on missing bytes')
expect('capture_no_throw', !captureThrew && probeBytes.length > 4000, `throw=${captureThrew} bytes=${probeBytes.length}`)
expect('capture_not_accepted', captureAccepted === 0, `accepted after capture=${captureAccepted}`)
expect('use_increments_once', usedAccepted === 1, `accepted after use=${usedAccepted}`)
expect('retake_does_not_increment', retakeAccepted === 0, `accepted after retake=${retakeAccepted}`)
expect('typed_capture_response', api.includes("code: body.action === 'use' ? 'STILL_ACCEPTED' : 'CAPTURE_REVIEW'") && api.includes("ok: false") && api.includes("'CAPTURE_FAILED'"), 'typed api')
expect('operator_error_ui', ui.includes('Could not capture the still. Please try again.') && ui.includes('operatorError') && !ui.includes("setError(err.message)"), 'operator ui')
expect('jpeg_bytes_mapped', faceSrc.includes('bytes: input.jpeg') && faceSrc.includes('input.bytes ?? input.jpeg'), 'bytes mapped from jpeg')
expect('reload_shape', readFaceReferenceSet(FACE_REPAIR_PROJECT).stills != null && readFaceReferenceSet(FACE_REPAIR_PROJECT).cameraDefaultOff === true, 'reload stills')
expect('camera_default_off_contract', emptySet.cameraDefaultOff === true && api.includes('cameraStarted: false') && api.includes('cameraDefaultOff: true'), 'camera off')
expect('privacy_local_only', emptySet.localOnly === true && emptySet.consentScope.cloud === false && emptySet.consentScope.embeddings === false && emptySet.consentScope.identityRecognition === false && !forbidden.test(faceSrc + api + ui), 'local only')
expect('front_probe_dims', (captureDims?.width ?? 0) >= 640 && (captureDims?.height ?? 0) >= 480, JSON.stringify(captureDims))
expect('canonical_face_dir', faceSrc.includes('face-reference') && faceSrc.includes('RAEL_CHARACTER_ID'), 'rael-commander nested dir')

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  detect,
  reserved: binding.metahumanCharacterPath,
  faceStatus: face.status,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
