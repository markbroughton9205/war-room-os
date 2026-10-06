/**
 * Provider-neutral landmark adapter.
 * Camera extraction returns no points unless a local model file is present.
 * Fixture coordinates are caller-supplied and are never treated as webcam inference.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { sceneTime } from '../director/clock'
import { auditMotionRuntime } from './motion-runtime'
import { ensureMoveNetCatalog, movenetModelPath, verifyMoveNetFile } from './movenet-catalog'
import {
  HVS_CANONICAL_JOINTS,
  PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED,
  type HvsCanonicalJoint,
  type HvsCaptureFailure,
  type HvsCaptureMode,
  type HvsGazeSource,
  type HvsHandTrackingStatus,
  type HvsHeadPerformanceFrame,
  type HvsLandmarkFrame,
  type HvsLandmarkPoint,
  type HvsBodyCoverageReport,
  type HvsMotionConfidence,
  type HvsPerformanceTakeQuality,
  type HvsStandingReadiness,
} from './types'

export type HvsFaceChannelSet = {
  eyeOpenness: number | null
  blink: number | null
  brow: number | null
  mouthOpenness: number | null
  smile: number | null
  jawOpenness: number | null
  measured: boolean
}

export type HvsRuntimeRow = {
  packageName: string
  version: string
  license: string
  location: string
  capability: string
  modelFiles: string[]
  modelBytes: number
  installed: boolean
  inferenceReady: boolean
}

export type HvsLandmarkRuntimeAudit = {
  status: typeof PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED
  rows: HvsRuntimeRow[]
  modelFiles: string[]
  inferenceReady: boolean
  installPerformed: boolean
  recommendation: {
    runtime: string
    packageName: string
    model: string
    license: string
    source: string
    publishedSize: string
    expectedStorage: string
    why: string
    rejected: string[]
  }
}

const PROVIDER_BODY: Record<string, HvsCanonicalJoint> = {
  nose: 'HEAD',
  left_shoulder: 'LEFT_SHOULDER',
  right_shoulder: 'RIGHT_SHOULDER',
  left_elbow: 'LEFT_ELBOW',
  right_elbow: 'RIGHT_ELBOW',
  left_wrist: 'LEFT_WRIST',
  right_wrist: 'RIGHT_WRIST',
  left_hip: 'LEFT_HIP',
  right_hip: 'RIGHT_HIP',
  left_knee: 'LEFT_KNEE',
  right_knee: 'RIGHT_KNEE',
  left_ankle: 'LEFT_ANKLE',
  right_ankle: 'RIGHT_ANKLE',
}

const LIB_DIR = '/usr/lib/x86_64-linux-gnu'

function libRow(prefix: string, packageName: string, license: string, capability: string): HvsRuntimeRow {
  let location = 'not installed'
  let version = 'absent'
  let installed = false
  let bytes = 0
  if (existsSync(LIB_DIR)) {
    const match = readdirSync(LIB_DIR).find(name => name.startsWith(prefix) && /\.so\.\d/.test(name))
    if (match) {
      location = path.join(LIB_DIR, match)
      version = match.match(/\.so\.(.+)$/)?.[1] ?? 'unknown'
      installed = true
      bytes = statSync(location).size
    }
  }
  return {
    packageName,
    version,
    license,
    location,
    capability: `${capability} Library bytes ${bytes}.`,
    modelFiles: [],
    modelBytes: 0,
    installed,
    inferenceReady: false,
  }
}

function modelFilesUnder(root: string, depth = 0): string[] {
  if (depth > 3 || !existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'captures' || entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) found.push(...modelFilesUnder(full, depth + 1))
    else if (/\.(tflite|task|onnx)$/i.test(entry.name) && /pose|face|hand|movenet|blaze|landmark/i.test(entry.name)) found.push(full)
  }
  return found
}

function licenseExcerpt(docDir: string): string {
  const file = path.join(docDir, 'copyright')
  if (!existsSync(file)) return 'license file not present on this machine'
  const text = readFileSync(file, 'utf8')
  const line = text.split('\n').find(row => /^License:/i.test(row.trim()))
  return line?.replace(/^License:\s*/i, '').trim() || 'copyright file present; license line not found'
}

export function auditLandmarkRuntime(root = process.cwd()): HvsLandmarkRuntimeAudit {
  const home = process.env.HOME ?? ''
  const models = [
    ...modelFilesUnder(path.join(root, 'lib/media-command')),
    ...modelFilesUnder(path.join(home, '.local/share/war-room-os/data/media-command')),
  ]
  const node = auditMotionRuntime(root)
  const rows: HvsRuntimeRow[] = [
    libRow('libonnxruntime.so.', 'libonnxruntime', licenseExcerpt('/usr/share/doc/libonnxruntime1.23'), 'CPU shared library. No Node or Python binding in this repo.'),
    libRow('libtensorflow-lite.so.', 'libtensorflow-lite', licenseExcerpt('/usr/share/doc/libtensorflow-lite2.14.1'), 'CPU shared library. No Node or Python binding in this repo.'),
    {
      packageName: 'node-vision-packages',
      version: node.found.join(', ') || 'absent',
      license: 'n/a',
      location: path.join(root, 'node_modules'),
      capability: 'MediaPipe, OpenCV, onnxruntime-node, and tfjs-tflite are not project dependencies.',
      modelFiles: [],
      modelBytes: 0,
      installed: node.found.length > 0,
      inferenceReady: false,
    },
    {
      packageName: 'browser-mediapipe-wasm',
      version: 'absent',
      license: 'n/a',
      location: 'not installed',
      capability: 'No browser MediaPipe / WASM vision package is in this app. WebGPU vision runtime is not wired.',
      modelFiles: [],
      modelBytes: 0,
      installed: false,
      inferenceReady: false,
    },
  ]
  const movenet = verifyMoveNetFile()
  if (movenet.ok) ensureMoveNetCatalog()
  return {
    status: PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED,
    rows,
    modelFiles: movenet.ok ? [movenetModelPath()] : models.filter(file => !file.endsWith('movenet-singlepose-lightning.tflite')),
    inferenceReady: movenet.ok,
    installPerformed: movenet.ok,
    recommendation: {
      runtime: 'TensorFlow Lite CPU, already present as a system library',
      packageName: 'movenet_singlepose_lightning.tflite',
      model: 'MoveNet SinglePose Lightning',
      license: 'Apache-2.0 for the published MoveNet TFLite weights and the TensorFlow Lite runtime',
      source: 'https://www.tensorflow.org/hub/tutorials/movenet',
      publishedSize: 'Confirm the exact file bytes at approval time. The published Lightning TFLite file is a few megabytes, not a photoreal generator.',
      expectedStorage: 'The TFLite shared library is already on this machine. Approval would add one small model file under the local media-command data directory. No cloud runtime.',
      why: 'It is a single-person body landmark model with a small file, a permissive license, and a CPU runtime library that is already installed. It does not provide iris gaze or a facial rig.',
      rejected: [
        'Cloud vision APIs: forbidden.',
        'MediaPipe task bundles: not installed, and the face/pose task files would be a separate download.',
        'OpenCV without a landmark model: no body landmarks.',
        'ONNX Runtime is installed as a library, and no pose model file is present.',
        'Photoreal human generators, face recognition, and lip-sync models: not authorized.',
      ],
    },
  }
}

export function trackersFor(mode: HvsCaptureMode): Array<'body' | 'face' | 'head' | 'hands' | 'gaze'> {
  if (mode === 'FACE_REFERENCE' || mode === 'DIALOGUE_PERFORMANCE') return ['face', 'head']
  if (mode === 'HEAD_REFERENCE') return ['head']
  if (mode === 'GESTURE_REFERENCE') return ['body', 'hands']
  if (mode === 'EYELINE_REFERENCE') return ['head', 'gaze']
  if (mode === 'DIRECTOR_BLOCKING') return ['body', 'head']
  return ['body']
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function canonicalJointName(name: string): HvsCanonicalJoint | null {
  const upper = name.toUpperCase()
  if ((HVS_CANONICAL_JOINTS as readonly string[]).includes(upper)) return upper as HvsCanonicalJoint
  return PROVIDER_BODY[name.toLowerCase()] ?? null
}

export function normalizeLandmarkPoint(input: {
  name: string
  x: number
  y: number
  confidence: number
  relativeDepth?: number | null
}): HvsLandmarkPoint {
  const relativeDepth = input.relativeDepth ?? null
  return {
    name: input.name,
    canonicalName: canonicalJointName(input.name),
    x: clamp01(input.x),
    y: clamp01(input.y),
    confidence: clamp01(input.confidence),
    relativeDepth,
    depthSource: relativeDepth == null ? 'NONE' : 'MONOCULAR_RELATIVE',
  }
}

function midpoint(a: HvsLandmarkPoint, b: HvsLandmarkPoint, name: HvsCanonicalJoint): HvsLandmarkPoint {
  return normalizeLandmarkPoint({
    name,
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    confidence: Math.min(a.confidence, b.confidence),
  })
}

export function withDerivedJoints(points: HvsLandmarkPoint[]): HvsLandmarkPoint[] {
  const body = points.map(point => ({ ...point, canonicalName: point.canonicalName ?? canonicalJointName(point.name) }))
  const byName = (name: HvsCanonicalJoint) => body.find(point => point.canonicalName === name)
  const leftShoulder = byName('LEFT_SHOULDER')
  const rightShoulder = byName('RIGHT_SHOULDER')
  const leftHip = byName('LEFT_HIP')
  const rightHip = byName('RIGHT_HIP')
  const head = byName('HEAD')
  if (leftShoulder && rightShoulder && !byName('CHEST')) body.push(midpoint(leftShoulder, rightShoulder, 'CHEST'))
  if (leftHip && rightHip && !byName('PELVIS')) body.push(midpoint(leftHip, rightHip, 'PELVIS'))
  if (head && leftShoulder && rightShoulder && !byName('NECK')) {
    const chest = byName('CHEST') ?? midpoint(leftShoulder, rightShoulder, 'CHEST')
    body.push(midpoint(head, chest, 'NECK'))
  }
  return body
}

export const HVS_LANDMARK_CONFIDENCE_THRESHOLD = 0.35

export function deriveCoarseHeadPose(points: HvsLandmarkPoint[]): HvsHeadPerformanceFrame | null {
  const named = (name: string) => points.find(point => point.name === name || point.canonicalName === name)
  const nose = named('nose') ?? named('HEAD')
  const leftShoulder = named('LEFT_SHOULDER')
  const rightShoulder = named('RIGHT_SHOULDER')
  if (!nose || !leftShoulder || !rightShoulder) return null
  const shoulder = Math.max(0.001, Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y))
  const midX = (leftShoulder.x + rightShoulder.x) / 2
  const midY = (leftShoulder.y + rightShoulder.y) / 2
  const leftEye = named('left_eye')
  const rightEye = named('right_eye')
  const leftEar = named('left_ear')
  const rightEar = named('right_ear')
  let yaw = (nose.x - midX) / shoulder
  if (leftEar && rightEar) yaw = yaw * 0.7 + ((nose.x - (leftEar.x + rightEar.x) / 2) / shoulder) * 0.3
  let pitch = (midY - nose.y) / shoulder
  if (leftEye && rightEye) pitch = ((leftEye.y + rightEye.y) / 2 - nose.y) / shoulder
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return {
    yaw: clamp(yaw),
    pitch: clamp(pitch),
    roll: clamp((leftShoulder.y - rightShoulder.y) / shoulder),
    confidence: Math.min(nose.confidence, leftShoulder.confidence, rightShoulder.confidence),
    source: 'COARSE_BODY_LANDMARK_HEAD_POSE',
  }
}

export function deriveHeadPose(points: HvsLandmarkPoint[]): HvsHeadPerformanceFrame | null {
  const head = points.find(point => point.canonicalName === 'HEAD')
  const left = points.find(point => point.canonicalName === 'LEFT_SHOULDER')
  const right = points.find(point => point.canonicalName === 'RIGHT_SHOULDER')
  if (!head || !left || !right) return null
  const shoulder = Math.max(0.001, Math.hypot(left.x - right.x, left.y - right.y))
  const midX = (left.x + right.x) / 2
  const midY = (left.y + right.y) / 2
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return {
    yaw: clamp((head.x - midX) / shoulder),
    pitch: clamp((midY - head.y) / shoulder),
    roll: clamp((left.y - right.y) / shoulder),
    confidence: Math.min(head.confidence, left.confidence, right.confidence),
    source: 'DERIVED_FROM_LANDMARKS',
  }
}

function pairDistance(points: HvsLandmarkPoint[], a: string, b: string): number | null {
  const first = points.find(point => point.name === a)
  const second = points.find(point => point.name === b)
  if (!first || !second) return null
  return Math.hypot(first.x - second.x, first.y - second.y)
}

export function faceChannels(points: HvsLandmarkPoint[]): HvsFaceChannelSet {
  const eye = pairDistance(points, 'left_eye_upper', 'left_eye_lower')
  const brow = pairDistance(points, 'left_brow', 'left_eye_upper')
  const mouth = pairDistance(points, 'mouth_upper', 'mouth_lower')
  const smile = pairDistance(points, 'mouth_left', 'mouth_right')
  const jaw = pairDistance(points, 'chin', 'mouth_lower')
  const measured = [eye, brow, mouth, smile, jaw].some(value => value != null)
  return {
    eyeOpenness: eye,
    blink: eye == null ? null : clamp01(1 - eye * 8),
    brow,
    mouthOpenness: mouth,
    smile,
    jawOpenness: jaw,
    measured,
  }
}

export function gazeSourceFor(frame: Pick<HvsLandmarkFrame, 'faceLandmarks' | 'headPose'>): HvsGazeSource {
  const iris = frame.faceLandmarks.some(point => /iris/i.test(point.name) && point.confidence >= 0.5)
  if (iris) return 'EYE_LANDMARKS'
  if (frame.headPose && frame.headPose.source !== 'NOT_MEASURED') return 'HEAD_DIRECTION_ONLY'
  return 'NOT_MEASURED'
}

export function handStatusFor(frame: Pick<HvsLandmarkFrame, 'handLandmarks'>): HvsHandTrackingStatus {
  return frame.handLandmarks.length ? 'TRACKED' : 'HAND_TRACKING_NOT_AVAILABLE'
}

export function fixtureLandmarkFrame(input: {
  frameIndex: number
  seconds?: number
  personCount?: number
  body?: Array<{ name: string; x: number; y: number; confidence: number; relativeDepth?: number | null }>
  face?: Array<{ name: string; x: number; y: number; confidence: number }>
  hands?: Array<{ name: string; x: number; y: number; confidence: number }>
}): HvsLandmarkFrame {
  const bodyLandmarks = withDerivedJoints((input.body ?? []).map(normalizeLandmarkPoint))
  const faceLandmarks = (input.face ?? []).map(normalizeLandmarkPoint)
  const handLandmarks = (input.hands ?? []).map(normalizeLandmarkPoint)
  const headPose = deriveHeadPose(bodyLandmarks)
  const frame: HvsLandmarkFrame = {
    time: sceneTime(input.seconds ?? input.frameIndex / 30),
    frameIndex: input.frameIndex,
    bodyLandmarks,
    faceLandmarks,
    handLandmarks,
    headPose,
    gazeSource: 'NOT_MEASURED',
    handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
    confidence: bodyLandmarks.length ? Math.min(...bodyLandmarks.map(point => point.confidence)) : 0,
    source: 'FIXTURE',
    modelId: null,
    personCount: input.personCount ?? 1,
  }
  frame.gazeSource = gazeSourceFor(frame)
  frame.handStatus = handStatusFor(frame)
  return frame
}

function jointSeries(frames: HvsLandmarkFrame[], name: HvsCanonicalJoint): Array<HvsLandmarkPoint | null> {
  return frames.map(frame => frame.bodyLandmarks.find(point => point.canonicalName === name) ?? null)
}

export function filterLandmarkFrames(frames: HvsLandmarkFrame[], options?: { confidenceThreshold?: number; maxGap?: number; alpha?: number }): HvsLandmarkFrame[] {
  const threshold = options?.confidenceThreshold ?? HVS_LANDMARK_CONFIDENCE_THRESHOLD
  const maxGap = options?.maxGap ?? 2
  const alpha = options?.alpha ?? 0.65
  const names = new Set<HvsCanonicalJoint>()
  for (const frame of frames) {
    for (const point of frame.bodyLandmarks) {
      if (point.canonicalName && (HVS_CANONICAL_JOINTS as readonly string[]).includes(point.canonicalName)) names.add(point.canonicalName as HvsCanonicalJoint)
    }
  }
  const smoothed = new Map<HvsCanonicalJoint, Array<HvsLandmarkPoint | null>>()
  for (const name of names) {
    const series = jointSeries(frames, name).map(point => (point && point.confidence >= threshold ? point : null))
    for (let index = 0; index < series.length; index += 1) {
      if (series[index]) continue
      let previous = index - 1
      while (previous >= 0 && !series[previous]) previous -= 1
      let next = index + 1
      while (next < series.length && !series[next]) next += 1
      if (previous < 0 || next >= series.length || next - previous - 1 > maxGap) continue
      const start = series[previous]
      const end = series[next]
      if (!start || !end) continue
      const span = next - previous
      const weight = (index - previous) / span
      series[index] = normalizeLandmarkPoint({
        name,
        x: start.x + (end.x - start.x) * weight,
        y: start.y + (end.y - start.y) * weight,
        confidence: Math.min(start.confidence, end.confidence) * 0.5,
        relativeDepth: start.relativeDepth,
      })
    }
    let last: HvsLandmarkPoint | null = null
    smoothed.set(name, series.map(point => {
      if (!point) {
        last = null
        return null
      }
      if (!last) {
        last = point
        return point
      }
      const next = normalizeLandmarkPoint({
        name,
        x: last.x * (1 - alpha) + point.x * alpha,
        y: last.y * (1 - alpha) + point.y * alpha,
        confidence: point.confidence,
        relativeDepth: point.relativeDepth,
      })
      last = next
      return next
    }))
  }
  return frames.map((frame, index) => {
    const extras = frame.bodyLandmarks.filter(point => !point.canonicalName && point.confidence >= threshold)
    const bodyLandmarks = [...[...smoothed.values()].map(series => series[index]).filter((point): point is HvsLandmarkPoint => point != null && point.confidence >= threshold), ...extras]
    const coarse = frame.modelId === 'movenet-singlepose-lightning' || frame.headPose?.source === 'COARSE_BODY_LANDMARK_HEAD_POSE' || extras.some(point => /eye|ear/.test(point.name))
    const next = { ...frame, bodyLandmarks, headPose: coarse ? deriveCoarseHeadPose(bodyLandmarks) : deriveHeadPose(bodyLandmarks) }
    next.gazeSource = gazeSourceFor(next)
    return next
  })
}

export const FULL_BODY_REQUIRED_JOINTS = [
  'HEAD',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_ELBOW',
  'RIGHT_ELBOW',
  'LEFT_WRIST',
  'RIGHT_WRIST',
  'LEFT_HIP',
  'RIGHT_HIP',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_ANKLE',
] as const

export const FULL_BODY_READY_JOINTS = [
  'HEAD',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_HIP',
  'RIGHT_HIP',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_ANKLE',
] as const

export const FULL_BODY_DERIVED_JOINTS = ['NECK', 'CHEST', 'PELVIS'] as const

const READINESS_PERSIST = 0.5
const READINESS_MIN_FRAMES = 8
const READINESS_WINDOW_MIN = 12

function namesIn(frame: HvsLandmarkFrame): Set<string> {
  return new Set(frame.bodyLandmarks.map(point => String(point.canonicalName ?? point.name)))
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0
}

function bothPresent(names: Set<string>, left: string, right: string): boolean {
  return names.has(left) && names.has(right)
}

export function computeBodyCoverage(frames: HvsLandmarkFrame[]): HvsBodyCoverageReport {
  const totalFrames = frames.length
  const accepted = frames.filter(frame => frame.bodyLandmarks.length > 0)
  const jointCoverage: Record<string, number> = {}
  for (const name of [...FULL_BODY_REQUIRED_JOINTS, ...FULL_BODY_DERIVED_JOINTS]) {
    jointCoverage[name] = ratio(frames.filter(frame => namesIn(frame).has(name)).length, totalFrames)
  }
  const required = FULL_BODY_REQUIRED_JOINTS.map(name => jointCoverage[name] ?? 0)
  const fullBodyCoverage = required.length ? required.reduce((sum, value) => sum + value, 0) / required.length : 0
  const pair = (left: string, right: string) => ratio(frames.filter(frame => bothPresent(namesIn(frame), left, right)).length, totalFrames)
  const frameTrackingCoverage = ratio(accepted.length, totalFrames)
  return {
    totalFrames,
    acceptedPersonFrames: accepted.length,
    frameTrackingCoverage,
    fullBodyCoverage,
    jointCoverage,
    bothShouldersCoverage: pair('LEFT_SHOULDER', 'RIGHT_SHOULDER'),
    bothElbowsCoverage: pair('LEFT_ELBOW', 'RIGHT_ELBOW'),
    bothWristsCoverage: pair('LEFT_WRIST', 'RIGHT_WRIST'),
    bothHipsCoverage: pair('LEFT_HIP', 'RIGHT_HIP'),
    bothKneesCoverage: pair('LEFT_KNEE', 'RIGHT_KNEE'),
    bothAnklesCoverage: pair('LEFT_ANKLE', 'RIGHT_ANKLE'),
  }
}

export function assessStandingReadiness(frames: HvsLandmarkFrame[], options?: { meanLuma?: number | null }): HvsStandingReadiness {
  const windowFrames = frames.length
  const accepted = frames.filter(frame => frame.bodyLandmarks.length > 0)
  const persistRatio: Record<string, number> = {}
  const persistCount: Record<string, number> = {}
  for (const name of FULL_BODY_READY_JOINTS) {
    const count = frames.filter(frame => namesIn(frame).has(name)).length
    persistCount[name] = count
    persistRatio[name] = ratio(count, windowFrames)
  }
  const stable = (name: (typeof FULL_BODY_READY_JOINTS)[number]) => (persistCount[name] ?? 0) >= READINESS_MIN_FRAMES && (persistRatio[name] ?? 0) >= READINESS_PERSIST
  const persisted = FULL_BODY_READY_JOINTS.filter(name => stable(name))
  const missing = FULL_BODY_READY_JOINTS.filter(name => !stable(name))
  const upper = stable('HEAD') && stable('LEFT_SHOULDER') && stable('RIGHT_SHOULDER')
  const hips = stable('LEFT_HIP') && stable('RIGHT_HIP')
  const knees = stable('LEFT_KNEE') && stable('RIGHT_KNEE')
  const ankles = stable('LEFT_ANKLE') && stable('RIGHT_ANKLE')
  const dark = options?.meanLuma != null && options.meanLuma < 18
  const weak = windowFrames === 0 || accepted.length / Math.max(1, windowFrames) < 0.25
  const enough = accepted.length >= Math.min(READINESS_WINDOW_MIN, windowFrames)
  const feetMissing = !ankles
  const legsMissing = !hips || !knees || !ankles
  let level: HvsStandingReadiness['level'] = 'IMPROVE LIGHTING — TRACKING WEAK'
  if (!dark && !weak && enough) {
    if (upper && hips && knees && ankles) {
      const xs: number[] = []
      for (const frame of frames) {
        for (const name of ['HEAD', 'LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP']) {
          const point = frame.bodyLandmarks.find(item => String(item.canonicalName ?? item.name) === name)
          if (point) xs.push(point.x)
        }
      }
      const center = xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : 0.5
      level = center < 0.32 || center > 0.68 ? 'CENTER BODY' : 'FULL BODY READY'
    } else if (hips && knees && feetMissing) {
      level = 'STEP BACK — FEET / ANKLES NOT VISIBLE'
    } else if (legsMissing && (upper || hips || knees)) {
      level = 'ADJUST CAMERA — LOWER BODY OUT OF FRAME'
    }
  }
  return {
    level,
    warning: level === 'FULL BODY READY' ? null : level,
    present: [...persisted],
    missing: [...missing],
    persistRatio,
    windowFrames,
    acceptedFrames: accepted.length,
  }
}

export type HvsStandingGestureProof = {
  headLeft: boolean
  headRight: boolean
  headCenter: boolean
  leftArmRaise: boolean
  rightArmRaise: boolean
  leanLeft: boolean
  leanRight: boolean
  relativeStep: boolean
  minYaw: number
  maxYaw: number
  leftWristTravel: number
  rightWristTravel: number
  pelvisTravel: number
}

function consecutive(flags: boolean[], need = 3): boolean {
  let run = 0
  for (const flag of flags) {
    run = flag ? run + 1 : 0
    if (run >= need) return true
  }
  return false
}

export function analyzeStandingGestures(frames: HvsLandmarkFrame[]): HvsStandingGestureProof {
  const yaws = frames.map(frame => frame.headPose?.yaw ?? 0)
  const leftRaise = frames.map(frame => {
    const shoulder = frame.bodyLandmarks.find(point => point.canonicalName === 'LEFT_SHOULDER')
    const wrist = frame.bodyLandmarks.find(point => point.canonicalName === 'LEFT_WRIST')
    if (!shoulder || !wrist) return 0
    return shoulder.y - wrist.y
  })
  const rightRaise = frames.map(frame => {
    const shoulder = frame.bodyLandmarks.find(point => point.canonicalName === 'RIGHT_SHOULDER')
    const wrist = frame.bodyLandmarks.find(point => point.canonicalName === 'RIGHT_WRIST')
    if (!shoulder || !wrist) return 0
    return shoulder.y - wrist.y
  })
  const leans = frames.map(frame => {
    const chest = frame.bodyLandmarks.find(point => point.canonicalName === 'CHEST')
    const pelvis = frame.bodyLandmarks.find(point => point.canonicalName === 'PELVIS')
    if (!chest || !pelvis) return 0
    return chest.x - pelvis.x
  })
  const pelvisX = frames.map(frame => frame.bodyLandmarks.find(point => point.canonicalName === 'PELVIS')?.x ?? 0)
  const span = (values: number[]) => (values.length ? Math.max(...values) - Math.min(...values) : 0)
  return {
    headLeft: consecutive(yaws.map(value => value <= -0.12)),
    headRight: consecutive(yaws.map(value => value >= 0.12)),
    headCenter: consecutive(yaws.map(value => Math.abs(value) <= 0.08)),
    leftArmRaise: span(leftRaise) >= 0.08 && Math.max(...leftRaise, 0) >= 0.1,
    rightArmRaise: span(rightRaise) >= 0.08 && Math.max(...rightRaise, 0) >= 0.1,
    leanLeft: consecutive(leans.map(value => value <= -0.04)),
    leanRight: consecutive(leans.map(value => value >= 0.04)),
    relativeStep: span(pelvisX) >= 0.04,
    minYaw: yaws.length ? Math.min(...yaws) : 0,
    maxYaw: yaws.length ? Math.max(...yaws) : 0,
    leftWristTravel: span(leftRaise),
    rightWristTravel: span(rightRaise),
    pelvisTravel: span(pelvisX),
  }
}

export function motionConfidence(frames: HvsLandmarkFrame[]): HvsMotionConfidence {
  const coverage = computeBodyCoverage(frames)
  if (!frames.length) {
    return {
      bodyConfidence: null,
      faceConfidence: null,
      headConfidence: null,
      handConfidence: null,
      trackingCoverage: 0,
      frameTrackingCoverage: 0,
      fullBodyCoverage: 0,
    }
  }
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const body = frames.filter(frame => frame.bodyLandmarks.length > 0)
  const face = frames.filter(frame => frame.faceLandmarks.length > 0)
  const head = frames.filter(frame => frame.headPose && frame.headPose.source !== 'NOT_MEASURED')
  const hands = frames.filter(frame => frame.handStatus === 'TRACKED')
  return {
    bodyConfidence: mean(body.map(frame => frame.confidence)),
    faceConfidence: mean(face.flatMap(frame => frame.faceLandmarks.map(point => point.confidence))),
    headConfidence: mean(head.map(frame => frame.headPose?.confidence ?? 0)),
    handConfidence: hands.length ? mean(hands.flatMap(frame => frame.handLandmarks.map(point => point.confidence))) : null,
    trackingCoverage: coverage.frameTrackingCoverage,
    frameTrackingCoverage: coverage.frameTrackingCoverage,
    fullBodyCoverage: coverage.fullBodyCoverage,
  }
}

export function gradeTake(confidence: HvsMotionConfidence, failure: HvsCaptureFailure | null): { quality: HvsPerformanceTakeQuality; reason: string } {
  if (failure === 'MODEL_NOT_READY' || failure === 'CAMERA_DISCONNECTED' || failure === 'TRACKING_LOST' || failure === 'NO_PERSON_DETECTED' || failure === 'MULTIPLE_PEOPLE_DETECTED') {
    return { quality: 'TRACKING_LOST', reason: failure }
  }
  if (failure === 'LOW_LIGHT' || failure === 'PARTIAL_BODY') return { quality: 'LOW_CONFIDENCE', reason: failure }
  if (confidence.bodyConfidence == null) return { quality: 'TRACKING_LOST', reason: 'No body landmarks were measured.' }
  const frameCoverage = confidence.frameTrackingCoverage ?? confidence.trackingCoverage
  const fullCoverage = confidence.fullBodyCoverage ?? 0
  if (fullCoverage >= 0.75 && frameCoverage >= 0.75 && confidence.bodyConfidence >= HVS_LANDMARK_CONFIDENCE_THRESHOLD) {
    return { quality: 'GOOD', reason: 'Standing full-body coverage and confidence are high.' }
  }
  if (fullCoverage >= 0.5 && frameCoverage >= 0.6) return { quality: 'USABLE', reason: 'Tracking covered most of the take.' }
  return { quality: 'LOW_CONFIDENCE', reason: 'Confidence or full-body coverage is low.' }
}

export function commanderFailure(code: HvsCaptureFailure): string {
  if (code === 'NO_PERSON_DETECTED') return 'No person was detected.'
  if (code === 'LOW_LIGHT') return 'The picture is too dark to track.'
  if (code === 'TRACKING_LOST') return 'Tracking was lost.'
  if (code === 'MULTIPLE_PEOPLE_DETECTED') return 'More than one person is in frame. Capture stays on one foreground performer and does not pick an identity.'
  if (code === 'CAMERA_DISCONNECTED') return 'The camera disconnected.'
  if (code === 'PARTIAL_BODY') return 'Only part of the body was visible.'
  return 'The landmark model is not installed. Frames were kept. No points were invented.'
}

export function rejectMultiplePeople(frames: HvsLandmarkFrame[]): { frames: HvsLandmarkFrame[]; failure: HvsCaptureFailure | null } {
  if (!frames.some(frame => frame.personCount > 1)) return { frames, failure: null }
  return {
    failure: 'MULTIPLE_PEOPLE_DETECTED',
    frames: frames.map(frame => ({
      ...frame,
      bodyLandmarks: [],
      faceLandmarks: [],
      handLandmarks: [],
      headPose: null,
      gazeSource: 'NOT_MEASURED',
      handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
      confidence: 0,
    })),
  }
}

export function extractLandmarks(input: { frameCount: number; mode: HvsCaptureMode; runtime?: HvsLandmarkRuntimeAudit }): {
  frames: HvsLandmarkFrame[]
  status: typeof PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED | 'NOT_RUN'
  failure: 'MODEL_NOT_READY' | null
  gazeSource: 'NOT_MEASURED'
  handStatus: 'HAND_TRACKING_NOT_AVAILABLE'
  trackers: Array<'body' | 'face' | 'head' | 'hands' | 'gaze'>
  confidence: HvsMotionConfidence
} {
  const runtime = input.runtime ?? auditLandmarkRuntime()
  if (runtime.inferenceReady) {
    return {
      frames: [],
      status: 'NOT_RUN',
      failure: null,
      gazeSource: 'NOT_MEASURED',
      handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
      trackers: trackersFor(input.mode),
      confidence: motionConfidence([]),
    }
  }
  return {
    frames: [],
    status: PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED,
    failure: 'MODEL_NOT_READY',
    gazeSource: 'NOT_MEASURED',
    handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
    trackers: trackersFor(input.mode),
    confidence: motionConfidence([]),
  }
}
