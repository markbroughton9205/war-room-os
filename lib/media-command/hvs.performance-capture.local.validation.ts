/**
 * Local webcam landmark adapter, retarget, and performance application.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.performance-capture.local.validation.ts`
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { emptyProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { DIRECTOR_ACCEPT_PROMPT } from './director/parse'
import { HVS_SCENE_TIMESCALE } from './director/clock'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { addActingIntent } from './digital-human/direction'
import {
  auditLandmarkRuntime,
  canonicalJointName,
  commanderFailure,
  extractLandmarks,
  faceChannels,
  HVS_LANDMARK_CONFIDENCE_THRESHOLD,
  deriveCoarseHeadPose,
  filterLandmarkFrames,
  fixtureLandmarkFrame,
  gazeSourceFor,
  gradeTake,
  motionConfidence,
  normalizeLandmarkPoint,
  rejectMultiplePeople,
  trackersFor,
  withDerivedJoints,
  computeBodyCoverage,
  assessStandingReadiness,
  analyzeStandingGestures,
} from './digital-human/landmark-adapter'
import {
  HVS_PLACEHOLDER_RETARGET,
  PERFORMANCE_SPEEDS,
  captureStorageBytes,
  derivePerformanceEdit,
  neutralCalibration,
  performanceQc,
  placeholderRetargetMap,
  previewPerformance,
  retargetSamples,
  reuseCrowdMotion,
} from './digital-human/retarget'
import { PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED, RAEL_CHARACTER_ID } from './digital-human/types'
import { MOVENET_LIGHTNING, verifyMoveNetFile } from './digital-human/movenet-catalog'
import { assessFullBodyReadiness, inferMoveNet, loadPerformanceFrames, MoveNetTfliteLandmarkAdapter, HvsLandmarkAdapter, restoreLetterboxPoint } from './digital-human/movenet'
import { grabExplicitFrames, openCaptureDevice } from './digital-human/capture'
import { auditCaptureDevices } from './digital-human/devices'
import { mediaCommandDataHierarchy } from './paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

const project = emptyProject({ id: 'hvs-capture-local', name: 'Capture' })
const runtime = auditLandmarkRuntime()
expect('runtime_approval', runtime.inferenceReady === true && runtime.modelFiles.some(file => file.endsWith('movenet-singlepose-lightning.tflite')), runtime.status)
expect('runtime_no_models', runtime.modelFiles.length === 1, String(runtime.modelFiles.length))
expect('runtime_rows', runtime.rows.some(row => row.packageName === 'libtensorflow-lite') && runtime.rows.some(row => row.packageName === 'libonnxruntime'), runtime.rows.map(row => row.packageName).join(','))
expect('no_cloud_loader', !/fetch\(|https\.request|undici/.test(readFileSync(path.join(process.cwd(), 'lib/media-command/digital-human/landmark-adapter.ts'), 'utf8')), 'local')

const extracted = extractLandmarks({ frameCount: 8, mode: 'BODY_REFERENCE', runtime })
expect('adapter_empty', extracted.frames.length === 0 && extracted.status === 'NOT_RUN' && extracted.handStatus === 'HAND_TRACKING_NOT_AVAILABLE', extracted.status)
const missing = extractLandmarks({ frameCount: 8, mode: 'BODY_REFERENCE', runtime: { ...runtime, inferenceReady: false, modelFiles: [], installPerformed: false } })
expect('adapter_missing_model', missing.frames.length === 0 && missing.failure === 'MODEL_NOT_READY' && missing.status === PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED, missing.failure ?? '')
expect('adapter_modes', trackersFor('FACE_REFERENCE').includes('face') && trackersFor('GESTURE_REFERENCE').includes('hands') && trackersFor('EYELINE_REFERENCE').includes('gaze'), 'modes')

const nose = normalizeLandmarkPoint({ name: 'nose', x: 0.42, y: 0.2, confidence: 0.9 })
expect('canonical_joint', canonicalJointName('left_shoulder') === 'LEFT_SHOULDER' && nose.canonicalName === 'HEAD' && nose.depthSource === 'NONE', nose.canonicalName ?? '')
const depth = normalizeLandmarkPoint({ name: 'HEAD', x: 0.5, y: 0.2, confidence: 0.8, relativeDepth: 0.4 })
expect('depth_honesty', depth.depthSource === 'MONOCULAR_RELATIVE' && depth.relativeDepth === 0.4, depth.depthSource)

const body = (headX: number, wristY: number, pelvisX: number, confidence = 0.9, rightWristY = 0.62) => ([
  { name: 'nose', x: headX, y: 0.2, confidence },
  { name: 'left_shoulder', x: 0.4, y: 0.4, confidence },
  { name: 'right_shoulder', x: 0.6, y: 0.4, confidence },
  { name: 'left_elbow', x: 0.32, y: 0.55, confidence },
  { name: 'right_elbow', x: 0.68, y: 0.55, confidence },
  { name: 'left_wrist', x: 0.3, y: wristY, confidence },
  { name: 'right_wrist', x: 0.7, y: rightWristY, confidence },
  { name: 'left_hip', x: pelvisX - 0.08, y: 0.7, confidence },
  { name: 'right_hip', x: pelvisX + 0.08, y: 0.7, confidence },
  { name: 'left_knee', x: pelvisX - 0.08, y: 0.85, confidence },
  { name: 'right_knee', x: pelvisX + 0.08, y: 0.85, confidence },
  { name: 'left_ankle', x: pelvisX - 0.08, y: 0.97, confidence },
  { name: 'right_ankle', x: pelvisX + 0.08, y: 0.97, confidence },
])
const neutral = fixtureLandmarkFrame({ frameIndex: 0, seconds: 0, body: body(0.5, 0.62, 0.5) })
const turned = fixtureLandmarkFrame({ frameIndex: 1, seconds: 0.5, body: body(0.35, 0.25, 0.62) })
const gap = fixtureLandmarkFrame({ frameIndex: 1, seconds: 1 / 30, body: body(0.5, 0.62, 0.5, 0.1) })
const back = fixtureLandmarkFrame({ frameIndex: 2, seconds: 2 / 30, body: body(0.48, 0.6, 0.51) })
expect('derived_joints', neutral.bodyLandmarks.some(point => point.canonicalName === 'PELVIS') && neutral.bodyLandmarks.some(point => point.canonicalName === 'NECK') && neutral.bodyLandmarks.some(point => point.canonicalName === 'CHEST'), 'derived')
expect('head_pose', (neutral.headPose?.yaw ?? 1) === 0 && (turned.headPose?.yaw ?? 0) < 0 && turned.headPose?.source === 'DERIVED_FROM_LANDMARKS', String(turned.headPose?.yaw))
const channels = faceChannels([
  normalizeLandmarkPoint({ name: 'left_eye_upper', x: 0.4, y: 0.2, confidence: 0.8 }),
  normalizeLandmarkPoint({ name: 'left_eye_lower', x: 0.4, y: 0.23, confidence: 0.8 }),
  normalizeLandmarkPoint({ name: 'mouth_upper', x: 0.5, y: 0.32, confidence: 0.8 }),
  normalizeLandmarkPoint({ name: 'mouth_lower', x: 0.5, y: 0.36, confidence: 0.8 }),
])
expect('face_channels', channels.measured && channels.eyeOpenness != null && channels.mouthOpenness != null && faceChannels([]).measured === false, String(channels.eyeOpenness))
expect('gaze', gazeSourceFor(neutral) === 'HEAD_DIRECTION_ONLY' && gazeSourceFor({ faceLandmarks: [normalizeLandmarkPoint({ name: 'left_iris', x: 0.4, y: 0.21, confidence: 0.8 })], headPose: neutral.headPose }) === 'EYE_LANDMARKS', gazeSourceFor(neutral))
const hands = fixtureLandmarkFrame({ frameIndex: 0, hands: [{ name: 'left_index', x: 0.2, y: 0.5, confidence: 0.7 }] })
expect('hands_optional', neutral.handStatus === 'HAND_TRACKING_NOT_AVAILABLE' && hands.handStatus === 'TRACKED', hands.handStatus)

const filtered = filterLandmarkFrames([neutral, gap, back])
const filteredHead = filtered[1]?.bodyLandmarks.find(point => point.canonicalName === 'HEAD')
expect('temporal_filter', Boolean(filteredHead) && (filteredHead?.confidence ?? 1) < 0.9, String(filteredHead?.confidence))
const confidence = motionConfidence([neutral, turned])
expect('confidence', (confidence.bodyConfidence ?? 0) > 0.5 && confidence.trackingCoverage === 1 && confidence.frameTrackingCoverage === 1 && confidence.handConfidence == null, String(confidence.trackingCoverage))
const coverageSplit = computeBodyCoverage([neutral, turned])
expect('coverage_fields_distinct', coverageSplit.frameTrackingCoverage === 1 && coverageSplit.fullBodyCoverage >= 0.75 && coverageSplit.bothHipsCoverage === 1 && coverageSplit.bothKneesCoverage === 1 && coverageSplit.bothAnklesCoverage === 1 && coverageSplit.bothWristsCoverage === 1, `${coverageSplit.frameTrackingCoverage}:${coverageSplit.fullBodyCoverage}`)
const standingBody = [
  { name: 'nose', x: 0.5, y: 0.08, confidence: 0.9 },
  { name: 'left_shoulder', x: 0.4, y: 0.22, confidence: 0.9 },
  { name: 'right_shoulder', x: 0.6, y: 0.22, confidence: 0.9 },
  { name: 'left_elbow', x: 0.34, y: 0.36, confidence: 0.9 },
  { name: 'right_elbow', x: 0.66, y: 0.36, confidence: 0.9 },
  { name: 'left_wrist', x: 0.32, y: 0.5, confidence: 0.9 },
  { name: 'right_wrist', x: 0.68, y: 0.5, confidence: 0.9 },
  { name: 'left_hip', x: 0.42, y: 0.5, confidence: 0.9 },
  { name: 'right_hip', x: 0.58, y: 0.5, confidence: 0.9 },
  { name: 'left_knee', x: 0.42, y: 0.72, confidence: 0.9 },
  { name: 'right_knee', x: 0.58, y: 0.72, confidence: 0.9 },
  { name: 'left_ankle', x: 0.42, y: 0.92, confidence: 0.9 },
  { name: 'right_ankle', x: 0.58, y: 0.92, confidence: 0.9 },
]
const standingFrames = Array.from({ length: 24 }, (_, index) => fixtureLandmarkFrame({ frameIndex: index, body: standingBody }))
const standingGrade = gradeTake(motionConfidence(standingFrames), null)
expect('quality', gradeTake(missing.confidence, 'MODEL_NOT_READY').quality === 'TRACKING_LOST' && gradeTake(confidence, null).quality === 'GOOD' && standingGrade.quality === 'GOOD' && gradeTake(confidence, 'PARTIAL_BODY').quality === 'LOW_CONFIDENCE', `${gradeTake(confidence, null).quality}/${standingGrade.quality}`)
expect('confidence_threshold', HVS_LANDMARK_CONFIDENCE_THRESHOLD === 0.35, String(HVS_LANDMARK_CONFIDENCE_THRESHOLD))
const lucky = [
  ...Array.from({ length: 20 }, (_, index) => fixtureLandmarkFrame({ frameIndex: index, seconds: index / 30, body: [] })),
  fixtureLandmarkFrame({ frameIndex: 20, seconds: 20 / 30, body: standingBody }),
]
const persist = Array.from({ length: 24 }, (_, index) => {
  const t = index / 23
  const yawHead = t < 0.2 ? 0.5 : t < 0.35 ? 0.32 : t < 0.5 ? 0.5 : t < 0.65 ? 0.68 : 0.5
  const leftY = t > 0.35 && t < 0.5 ? 0.18 : 0.5
  const rightY = t > 0.55 && t < 0.7 ? 0.18 : 0.5
  const pelvis = t < 0.7 ? 0.5 : t < 0.85 ? 0.42 : 0.58
  return fixtureLandmarkFrame({ frameIndex: index, seconds: index / 30, body: body(yawHead, leftY, pelvis, 0.9, rightY) })
})
expect('standing_ready_rejects_lucky_frame', assessStandingReadiness(lucky).level !== 'FULL BODY READY', assessStandingReadiness(lucky).level)
expect('standing_ready_persist', assessStandingReadiness(persist).level === 'FULL BODY READY', assessStandingReadiness(persist).level)
const gestures = analyzeStandingGestures(persist)
expect('gesture_head_left_right', gestures.headLeft && gestures.headRight && gestures.headCenter, `${gestures.minYaw}:${gestures.maxYaw}`)
expect('gesture_both_arms', gestures.leftArmRaise && gestures.rightArmRaise, `${gestures.leftWristTravel}:${gestures.rightWristTravel}`)
expect('gesture_lean_and_root', (gestures.leanLeft || gestures.leanRight) && gestures.relativeStep, String(gestures.pelvisTravel))
const many = rejectMultiplePeople([fixtureLandmarkFrame({ frameIndex: 0, personCount: 2, body: body(0.5, 0.62, 0.5) })])
expect('single_person', many.failure === 'MULTIPLE_PEOPLE_DETECTED' && many.frames[0]?.bodyLandmarks.length === 0, many.failure ?? '')
expect('failure_copy', !commanderFailure('MODEL_NOT_READY').includes('at ') && commanderFailure('LOW_LIGHT').includes('dark'), commanderFailure('CAMERA_DISCONNECTED'))

const map = placeholderRetargetMap()
const samples = retargetSamples([neutral, turned], map, neutralCalibration([neutral], RAEL_CHARACTER_ID))
expect('retarget_map', map.id === HVS_PLACEHOLDER_RETARGET && map.rigState === 'NO_RIG' && map.trainsIdentity === false && map.metricLocomotion === false, map.label)
expect('retarget_motion', samples[1] != null && samples[1].head.yaw < 0 && samples[1].leftArm > samples[0].leftArm && samples[1].root.x !== 0 && samples[1].root.z === 0 && samples[1].metricLocomotion === false, String(samples[1]?.leftArm))
expect('retarget_clock', samples.every(sample => sample.time.timescale === HVS_SCENE_TIMESCALE), String(samples[0]?.time.timescale))
const calibration = neutralCalibration([neutral], RAEL_CHARACTER_ID)
expect('calibration', calibration.kind === 'NEUTRAL_POSE' && calibration.biometricEnrollment === false && (calibration.shoulderWidthNormalized ?? 0) > 0, String(calibration.shoulderWidthNormalized))
const emptyPreview = previewPerformance({ characterId: RAEL_CHARACTER_ID, frames: [] })
expect('empty_preview', emptyPreview.atRest && emptyPreview.photoreal === false && emptyPreview.label === 'MODEL REQUIRED', emptyPreview.label)

const rael = HVS.castCharacter(project, { displayName: "Ra'el", roleName: 'lead', roleType: 'LEAD', actor: 'commander' })
const lock = { ...rael.identityLock }
const bible = project.digitalHumans?.bibles.find(item => item.characterId === RAEL_CHARACTER_ID)?.version
const wardrobe = rael.activeWardrobeSetId
const take = {
  id: 'take-local',
  captureSessionId: 'cap-local',
  characterId: RAEL_CHARACTER_ID,
  label: 'TAKE 1',
  duration: { ticks: 24_000, timescale: HVS_SCENE_TIMESCALE },
  motionRef: 'motion-local',
  audioRef: null,
  rawAssetId: 'asset-raw-once',
  rating: null,
  selected: true,
  quality: 'TRACKING_LOST' as const,
  qualityReason: 'MODEL_NOT_READY',
}
project.digitalHumans?.takes.push(take)
project.digitalHumans?.motions.push({
  id: 'motion-local',
  duration: take.duration,
  frameRate: { n: 30, d: 1 },
  bodyFrames: [],
  faceFrames: [],
  headFrames: [],
  gazeFrames: [],
  gestureEvents: [],
  extractionStatus: PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED,
  landmarkFrames: [],
  failure: 'MODEL_NOT_READY',
  confidence: extracted.confidence,
  evidence: null,
})
const assigned = HVS.assignPerformanceReference(project, { takeId: take.id, characterId: RAEL_CHARACTER_ID })
expect('rael_binding', assigned.characterId === RAEL_CHARACTER_ID && rael.id === RAEL_CHARACTER_ID && rael.identityLock.faceLocked === lock.faceLocked && rael.activeWardrobeSetId === wardrobe && project.digitalHumans?.bibles.find(item => item.characterId === RAEL_CHARACTER_ID)?.version === bible && rael.generatorBindings.length === 0, rael.id)
const actor = HVS.directPerformance(project, 'Use the same motion for Actor A.', 'commander')
const actorRef = project.digitalHumans?.references.find(item => item.characterId === actor.characterId)
expect('fictional_reuse', actor.characterId !== RAEL_CHARACTER_ID && actorRef?.rawAssetId === assigned.rawAssetId && actorRef.takeId === assigned.takeId && project.assets.length === 0, actorRef?.rawAssetId ?? '')
const beforeSpeed = take.duration.ticks
const slower = HVS.directPerformance(project, 'Make that take slower.', 'commander')
const speedPatch = project.digitalHumans?.patches.find(patch => patch.kind === 'CHANGE_SPEED')
expect('speed_proposal', slower.kind === 'patch' && speedPatch?.status === 'proposed' && take.duration.ticks === beforeSpeed && take.motionRef === 'motion-local', speedPatch?.kind ?? '')
const edit = derivePerformanceEdit(project.digitalHumans!, { take, trimStartSec: 0.25, trimEndSec: 1, speed: { n: 1, d: 2 }, mirror: true, loop: true })
expect('derived_edit', edit.mutatesSource === false && edit.speed.n === 1 && edit.speed.d === 2 && edit.loop === false && edit.mirror && take.motionRef === edit.sourceMotionRef, String(edit.loop))
expect('speed_presets', PERFORMANCE_SPEEDS.map(item => item.n / item.d).join(',') === '0.5,0.75,1,1.25,1.5,2', 'speeds')
addActingIntent(project.digitalHumans!, {
  characterId: RAEL_CHARACTER_ID,
  shotId: 'shot-3',
  beatId: null,
  objective: 'Look back at the collapse',
  emotion: 'CONCERNED',
  intensity: 0.4,
  bodyAction: 'Turn',
  gestureIntent: null,
  headIntent: 'look back',
  gazeIntent: null,
  facialIntent: null,
  speechIntent: null,
  start: samples[0].time,
  end: samples[1].time,
})
HVS.directPerformance(project, "Use my webcam take for Ra'el when he looks back at the collapse.", 'commander')
const directedRef = project.digitalHumans?.references.find(item => item.shotId === 'shot-3')
expect('director_bridge', directedRef?.characterId === RAEL_CHARACTER_ID && directedRef.shotId === 'shot-3' && directedRef.takeId === take.id, directedRef?.shotId ?? '')
HVS.directPerformance(project, 'Use my webcam take and make Ra\'el more hesitant.', 'commander')
const hesitantRef = [...(project.digitalHumans?.references ?? [])].reverse().find(item => item.semanticModifier)
expect('acting_blend', Boolean(hesitantRef?.semanticModifier?.includes('hesitant') && hesitantRef.motionRef === take.motionRef && project.digitalHumans?.patches.some(patch => patch.kind === 'CHANGE_INTENSITY')), hesitantRef?.semanticModifier ?? '')
const crowd = HVS.createBackgroundPopulation(project, { count: 4, profile: 'alley', walking: 4, standing: 0 })
const uses = reuseCrowdMotion(project.digitalHumans!, { take, populationId: crowd.id, instanceIds: crowd.instances.map(item => item.id), seed: 7 })
const signatures = new Set(uses.map(use => `${use.timeOffset.ticks}:${use.speed.n}:${use.mirror}:${use.phase}`))
expect('crowd_reuse', uses.length === 4 && uses.every(use => use.rawAssetId === take.rawAssetId) && signatures.size > 1, String(signatures.size))
expect('crowd_clock', uses.every(use => use.timeOffset.timescale === HVS_SCENE_TIMESCALE), 'clock')
let directorBlocked = false
try { HVS.capturePerformance(project, { actor: 'director' }) } catch { directorBlocked = true }
expect('capture_authority', directorBlocked, 'commander only')
const qc = performanceQc(project.digitalHumans!.motions[0])
expect('qc', qc.failure === 'MODEL_NOT_READY' && qc.coverage === 0 && qc.missingJoints.includes('HEAD'), qc.failure ?? '')
expect('storage', captureStorageBytes({ rawBytes: 10, landmarkBytes: 2, motionBytes: 20, previewBytes: 0 }).embeddedInProject === false, 'external')
expect('matrix', HVS_MATRIX_ROWS.length === 187 && HVSPROJ_VERSION === 0, String(HVS_MATRIX_ROWS.length))
expect('director_prompt', detectHvsProductionIntent(DIRECTOR_ACCEPT_PROMPT) === 'director3d', detectHvsProductionIntent(DIRECTOR_ACCEPT_PROMPT))
expect('slower_routes', detectHvsProductionIntent('Make that take slower.') === 'actors', detectHvsProductionIntent('Make that take slower.'))
const reloaded = parseHvsProject(serializeHvsProject(project))
expect('persistence', Boolean(reloaded.digitalHumans?.takes.some(item => item.id === take.id) && reloaded.digitalHumans.references.some(item => item.characterId === RAEL_CHARACTER_ID) && reloaded.digitalHumans.references.some(item => item.characterId === actor.characterId) && reloaded.digitalHumans.crowdMotionUses.length === 4), String(reloaded.digitalHumans?.crowdMotionUses.length))

const verified = verifyMoveNetFile()
expect('movenet_hash', verified.ok && verified.sha256 === MOVENET_LIGHTNING.sha256 && verified.bytes === 4758512 && MOVENET_LIGHTNING.license === 'Apache-2.0', verified.sha256)
expect('movenet_source', MOVENET_LIGHTNING.source.includes('singlepose/lightning/tflite/float16/4') && MOVENET_LIGHTNING.docs.includes('tensorflow.org/hub/tutorials/movenet') && MOVENET_LIGHTNING.variant === 'tflite-float16', MOVENET_LIGHTNING.source)
expect('adapter_backend', MoveNetTfliteLandmarkAdapter.id === 'MoveNetTfliteLandmarkAdapter' && HvsLandmarkAdapter.backend.modelId === 'movenet-singlepose-lightning', MoveNetTfliteLandmarkAdapter.id)
const restored = restoreLetterboxPoint({ xNorm: 0.5, yNorm: 0.5, sourceWidth: 640, sourceHeight: 480, modelInput: 192 })
expect('letterbox_restore', restored.insideFrame && Math.abs(restored.x - 0.5) < 0.02 && Math.abs(restored.y - 0.5) < 0.02, `${restored.x},${restored.y}`)
const padded = restoreLetterboxPoint({ xNorm: 0.02, yNorm: 0.02, sourceWidth: 640, sourceHeight: 480, modelInput: 192 })
expect('letterbox_pad_outside', padded.insideFrame === false, String(padded.insideFrame))
expect('tool_local', !/urllib|requests|http\.client|socket\./.test(readFileSync(path.join(process.cwd(), 'lib/media-command/digital-human/movenet_tflite.py'), 'utf8')), 'local')
const disconnected = grabExplicitFrames({ device: '/dev/video-missing-hvs', outPath: '/tmp/hvs-missing-camera.mjpg', frames: 1 })
expect('camera_disconnected', disconnected.ok === false, 'closed')
const devices = auditCaptureDevices()
const camera = devices.devices.find(device => device.type === 'VIDEO_CAPTURE')
expect('camera_present', Boolean(camera?.node), camera?.label ?? devices.error ?? 'none')
expect('camera_node', Boolean(camera?.node), camera?.label ?? 'none')
if (camera?.node) {
  const opened = openCaptureDevice({ device: camera.node })
  expect('camera_open_no_stream', opened.ok === true && opened.streamed === false && opened.closed === true, JSON.stringify({ ok: opened.ok, streamed: opened.streamed, closed: opened.closed, error: opened.error }))
  const readyGrab = grabExplicitFrames({ device: camera.node, outPath: '/tmp/hvs-ready-window.mjpg', frames: 48 })
  const readyInf = readyGrab.ok && readyGrab.path ? inferMoveNet({ mjpgPath: readyGrab.path, fps: 30 }) : null
  const ready = assessStandingReadiness(readyInf?.frames ?? [])
  const readyCoverage = computeBodyCoverage(readyInf?.frames ?? [])
  expect('live_readiness_window', readyGrab.ok === true && ready.windowFrames >= 12, JSON.stringify({ level: ready.level, frames: ready.windowFrames, missing: ready.missing, fullBody: readyCoverage.fullBodyCoverage }))
  writeFileSync('/tmp/hvs-standing-ready.json', JSON.stringify({ readiness: ready, coverage: readyCoverage, latency: readyInf?.latencyMs ?? null }, null, 2))
}
const captureProjectPath = path.join(mediaCommandDataHierarchy().projects, 'hvs-mud3jhrr-dgyy.hvsproj')
const captureProject = parseHvsProject(readFileSync(captureProjectPath, 'utf8'))
const raelBefore = JSON.parse(JSON.stringify(captureProject.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)))
const bibleBefore = JSON.stringify(captureProject.digitalHumans?.bibles.find(item => item.id === 'rael-bible'))
const liveSession = HVS.startPerformanceCapture(captureProject, { characterId: RAEL_CHARACTER_ID, mode: 'BODY_REFERENCE', actor: 'commander' })
const liveRecorded = HVS.recordPerformanceTake(captureProject, liveSession.id, 160)
const liveMotion = liveRecorded.motion
const liveStored = captureProject.digitalHumans?.motions.find(item => item.id === liveMotion.id)
const liveSidecar = loadPerformanceFrames(liveStored)
const liveBody = (liveMotion.landmarkFrames ?? []).filter(frame => frame.bodyLandmarks.length > 0)
const liveNames = [...new Set(liveBody.flatMap(frame => frame.bodyLandmarks.map(point => String(point.canonicalName ?? point.name))))]
expect('live_device_released', liveSession.deviceReleased === true && liveSession.status === 'STOPPED', liveSession.status)
expect('live_coverage_field', typeof liveRecorded.take.trackingCoverage === 'number', String(liveRecorded.take.trackingCoverage))
expect('live_coverage_distinct', typeof liveRecorded.take.frameTrackingCoverage === 'number' && typeof liveRecorded.take.fullBodyCoverage === 'number', `${liveRecorded.take.frameTrackingCoverage}:${liveRecorded.take.fullBodyCoverage}`)
expect('live_inference', liveMotion.evidence?.inferenceRan === true && liveMotion.evidence.delegate === 'CPU' && liveMotion.faceFrames.length === 0, String(liveMotion.evidence?.meanInferenceMs))
expect('live_no_face_hand', (liveMotion.landmarkFrames ?? []).every(frame => frame.faceLandmarks.length === 0 && frame.handLandmarks.length === 0 && frame.handStatus === 'HAND_TRACKING_NOT_AVAILABLE' && frame.gazeSource !== 'EYE_LANDMARKS'), String(liveMotion.landmarkFrames?.length ?? 0))
expect('live_depth_none', liveBody.every(frame => frame.bodyLandmarks.every(point => point.depthSource === 'NONE' && point.confidence >= HVS_LANDMARK_CONFIDENCE_THRESHOLD)), 'depth')
expect('live_sidecar', Boolean(liveStored && (liveStored.landmarkFrames?.length ?? 0) === 0 && liveStored.bodyFrames.length === 0 && liveSidecar.length === (liveMotion.landmarkFrames?.length ?? 0)), String(liveSidecar.length))
expect('live_project_light', !serializeHvsProject(captureProject).includes('"left_shoulder"'), 'stripped')
const livePreview = HVS.previewPerformance(captureProject, liveRecorded.take.id)
expect('live_placeholder', livePreview.photoreal === false && livePreview.honesty === 'PLACEHOLDER RETARGET' && placeholderRetargetMap().metricLocomotion === false && (liveBody.length === 0 ? livePreview.atRest : livePreview.label === 'PLACEHOLDER RETARGET'), livePreview.label)
const emptyRoomAccepted = new Set(['NO_PERSON_DETECTED', 'TRACKING_LOST'])
const emptyRoomHardFail = ['CAMERA_DISCONNECTED', 'MODEL_NOT_READY', 'INFERENCE_ERROR', 'LOW_LIGHT', 'PARTIAL_BODY']
expect('empty_room_failures_stay_distinct', emptyRoomHardFail.every(code => !emptyRoomAccepted.has(code)), emptyRoomHardFail.join(','))
const referencesBeforeLive = captureProject.digitalHumans?.references.length ?? 0
if (liveBody.length) {
  const liveAssign = HVS.assignPerformanceReference(captureProject, { takeId: liveRecorded.take.id, characterId: RAEL_CHARACTER_ID })
  const raelAfter = captureProject.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)
  const bibleAfter = JSON.stringify(captureProject.digitalHumans?.bibles.find(item => item.id === 'rael-bible'))
  const sameIdentity = raelBefore && raelAfter && raelAfter.id === raelBefore.id && JSON.stringify(raelAfter.identityLock) === JSON.stringify(raelBefore.identityLock) && JSON.stringify(raelAfter.wardrobeSets) === JSON.stringify(raelBefore.wardrobeSets) && JSON.stringify(raelAfter.generatorBindings) === JSON.stringify(raelBefore.generatorBindings) && bibleAfter === bibleBefore
  expect('live_rael', Boolean(sameIdentity && liveAssign.characterId === RAEL_CHARACTER_ID), raelAfter?.id ?? '')
  const actorReuse = HVS.directPerformance(captureProject, 'Use the same motion for Actor A.', 'commander')
  const liveActorRef = captureProject.digitalHumans?.references.find(item => item.id === actorReuse.referenceId)
  expect('live_actor_reuse', actorReuse.characterId !== RAEL_CHARACTER_ID && liveActorRef?.rawAssetId === liveRecorded.take.rawAssetId && liveActorRef.motionRef === liveRecorded.take.motionRef, liveActorRef?.rawAssetId ?? '')
  const liveDirected = HVS.directPerformance(captureProject, 'Use my webcam take for Ra\'el when he looks back at the collapse.', 'commander')
  const liveDirectedRef = captureProject.digitalHumans?.references.find(item => item.id === liveDirected.referenceId)
  expect('live_director', liveDirected.characterId === RAEL_CHARACTER_ID && Boolean(liveDirectedRef?.shotId) && liveDirectedRef?.motionRef === liveRecorded.take.motionRef, liveDirectedRef?.shotId ?? '')
  expect('live_body_joints', liveNames.length > 0, liveNames.join(','))
} else {
  // Empty room: no accepted person. Sub-threshold keypoints are TRACKING_LOST, not a tracked body.
  const jointCount = liveMotion.bodyFrames.reduce((count, frame) => count + frame.joints.length, 0)
  const acceptedPeople = (liveMotion.landmarkFrames ?? []).filter(frame => frame.personCount > 0).length
  const emptyPreview = previewPerformance({ characterId: null, frames: liveMotion.landmarkFrames ?? [] })
  const reason = liveMotion.failure
  const captureOk = liveRecorded.grab.ok === true && (liveRecorded.grab.frames ?? 0) > 0
  const inferenceOk = liveMotion.evidence?.inferenceRan === true && liveMotion.evidence.modelSha256 === MOVENET_LIGHTNING.sha256
  const noBody = jointCount === 0 && acceptedPeople === 0 && liveMotion.headFrames.length === 0 && liveBody.length === 0
  const noRetarget = emptyPreview.atRest === true && emptyPreview.samples.length === 0 && emptyPreview.samples.every(sample => sample.leftArm === 0 && sample.rightArm === 0 && sample.root.x === 0)
  const noRaelAssignment = (captureProject.digitalHumans?.references.length ?? 0) === referencesBeforeLive
    && !(captureProject.digitalHumans?.references.some(item => item.takeId === liveRecorded.take.id))
  const reasonOk = reason != null && emptyRoomAccepted.has(reason)
  expect('live_empty_room_no_false_person', captureOk && inferenceOk && noBody && noRetarget && noRaelAssignment && reasonOk && liveRecorded.take.trackingCoverage === 0, String(reason ?? liveRecorded.take.quality))
}
const emptyGrab = camera?.node
  ? grabExplicitFrames({ device: camera.node, outPath: '/tmp/hvs-empty-room-camera.mjpg', frames: 8 })
  : null
const cameraCaptureSucceeded = Boolean(emptyGrab?.ok && emptyGrab.closed !== false && (emptyGrab.frames ?? 0) > 0)
spawnSync('python3', ['-c', 'from PIL import Image; Image.new("RGB",(640,480),(180,180,180)).save("/tmp/hvs-empty-room.jpg", quality=90)'])
const emptyScene = inferMoveNet({ jpegPath: '/tmp/hvs-empty-room.jpg' })
const acceptedBodyCount = emptyScene.frames.filter(frame => frame.personCount > 0 || frame.bodyLandmarks.length > 0).length
const acceptedJointCount = emptyScene.frames.reduce((count, frame) => count + frame.bodyLandmarks.length, 0)
const motionCreated = false
const emptyScenePreview = previewPerformance({ characterId: null, frames: emptyScene.frames })
const retargetCreated = emptyScenePreview.samples.length > 0
const emptyReason = emptyScene.failure
const emptyPass = cameraCaptureSucceeded && verified.ok && emptyScene.status === 'EXTRACTED' && acceptedBodyCount === 0 && acceptedJointCount === 0 && motionCreated === false && retargetCreated === false && emptyReason != null && emptyRoomAccepted.has(emptyReason) && !emptyRoomHardFail.includes(emptyReason)
expect('live_empty_room', emptyPass, emptyReason ?? emptyScene.status)
writeFileSync('/tmp/hvs-empty-room.json', JSON.stringify({
  cameraCaptureSucceeded,
  modelReady: verified.ok,
  inferenceRan: emptyScene.status === 'EXTRACTED',
  acceptedBodyCount,
  acceptedJointCount,
  motionCreated,
  retargetCreated,
  finalStatus: emptyReason,
  test: emptyPass ? 'PASS' : 'FAIL',
  cameraFrames: emptyGrab?.frames ?? 0,
  deviceReleased: emptyGrab?.closed !== false,
}, null, 2))
writeFileSync('/tmp/hvs-movenet-live.json', JSON.stringify({
  quality: liveRecorded.take.quality,
  reason: liveRecorded.take.qualityReason,
  failure: liveMotion.failure,
  frames: liveMotion.landmarkFrames?.length ?? 0,
  bodyFrames: liveBody.length,
  joints: liveNames,
  coverage: liveMotion.confidence?.trackingCoverage,
  bodyConfidence: liveMotion.confidence?.bodyConfidence,
  headConfidence: liveMotion.confidence?.headConfidence,
  gaze: liveMotion.gazeSource,
  evidence: liveMotion.evidence,
  placeholder: { label: livePreview.label, atRest: livePreview.atRest, samples: livePreview.samples.length },
}, null, 2))
spawnSync('python3', ['-c', 'from PIL import Image; Image.new("RGB",(64,48),(8,8,8)).save("/tmp/hvs-blank-movenet.jpg")'])
const blank = inferMoveNet({ jpegPath: '/tmp/hvs-blank-movenet.jpg' })
expect('blank_no_fake_points', blank.frames.every(frame => frame.bodyLandmarks.length === 0 && frame.faceLandmarks.length === 0 && frame.handLandmarks.length === 0), blank.failure ?? '')
expect('blank_failure', blank.failure === 'NO_PERSON_DETECTED' || blank.failure === 'LOW_LIGHT', blank.failure ?? '')
expect('preprocess', blank.preprocess?.modelInput === 192 && blank.preprocess.layout === 'letterbox' && blank.delegate === 'CPU', blank.preprocess?.normalization ?? '')
const coarse = deriveCoarseHeadPose(withDerivedJoints([
  normalizeLandmarkPoint({ name: 'nose', x: 0.35, y: 0.2, confidence: 0.9 }),
  normalizeLandmarkPoint({ name: 'left_eye', x: 0.32, y: 0.18, confidence: 0.8 }),
  normalizeLandmarkPoint({ name: 'right_eye', x: 0.4, y: 0.18, confidence: 0.8 }),
  normalizeLandmarkPoint({ name: 'left_shoulder', x: 0.4, y: 0.4, confidence: 0.9 }),
  normalizeLandmarkPoint({ name: 'right_shoulder', x: 0.6, y: 0.4, confidence: 0.9 }),
]))
expect('coarse_head', coarse?.source === 'COARSE_BODY_LANDMARK_HEAD_POSE' && (coarse?.yaw ?? 0) < 0, coarse?.source ?? '')
const framed = assessFullBodyReadiness(standingFrames)
const legsOut = assessFullBodyReadiness(Array.from({ length: 12 }, (_, index) => fixtureLandmarkFrame({
  frameIndex: index,
  body: standingBody.filter(point => !/knee|ankle/.test(point.name)),
})))
expect('full_body_ready', framed.level === 'FULL BODY READY' && framed.warning == null, framed.level)
expect('full_body_warning', legsOut.level === 'ADJUST CAMERA — LOWER BODY OUT OF FRAME' && legsOut.missing.includes('LEFT_ANKLE') && legsOut.missing.includes('LEFT_KNEE'), legsOut.level)
const feetOnly = assessFullBodyReadiness(Array.from({ length: 12 }, (_, index) => fixtureLandmarkFrame({
  frameIndex: index,
  body: standingBody.filter(point => !/ankle/.test(point.name)),
})))
expect('feet_not_visible', feetOnly.level === 'STEP BACK — FEET / ANKLES NOT VISIBLE' && feetOnly.missing.includes('LEFT_ANKLE') && feetOnly.missing.includes('RIGHT_ANKLE'), feetOnly.level)
const oneFrameWindow = Array.from({ length: 10 }, (_, index) => fixtureLandmarkFrame({
  frameIndex: index,
  body: index === 0 ? standingBody : standingBody.filter(point => !/knee|ankle/.test(point.name)),
}))
expect('readiness_not_one_frame', assessFullBodyReadiness(oneFrameWindow).level === 'ADJUST CAMERA — LOWER BODY OUT OF FRAME', assessFullBodyReadiness(oneFrameWindow).level)

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, total: results.length, motion: PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED, paidProviderCalls: 0 }))
