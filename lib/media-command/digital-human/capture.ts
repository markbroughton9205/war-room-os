import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { fromSeconds, type MediaTime } from '../time'
import type { AssetRecord, HvsProject } from '../types'
import { auditCaptureDevices, selectCaptureDevice } from './devices'
import { commanderFailure, computeBodyCoverage, gradeTake, assessStandingReadiness } from './landmark-adapter'
import { neutralCalibration } from './retarget'
import { inferMoveNet } from './movenet'
import {
  dhId,
  type HvsCaptureMode,
  type HvsDigitalHumanStore,
  type HvsPerformanceCaptureSession,
  type HvsPerformanceMotion,
  type HvsPerformanceTake,
} from './types'

export const HVS_ACCEPTANCE_TAKE_FRAMES = 330
export const HVS_READINESS_WINDOW_FRAMES = 48

export type DeviceGrab = {
  ok: boolean
  device?: string
  path?: string
  frames?: number
  frameBytes?: number[]
  width?: number
  height?: number
  pixelFormat?: string
  firstFrameMs?: number | null
  interFrameMs?: number[]
  closed?: boolean
  opened?: boolean
  streamed?: boolean
  error?: string
}

function toolPath(): string {
  return path.join(process.cwd(), 'lib/media-command/digital-human/v4l2_tool.py')
}

export function openCaptureDevice(input: { device: string; width?: number; height?: number }): DeviceGrab {
  const result = spawnSync('python3', [
    toolPath(),
    '--open',
    '--device', input.device,
    '--width', String(input.width ?? 640),
    '--height', String(input.height ?? 480),
  ], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) {
    return { ok: false, opened: false, streamed: false, closed: true, error: result.stderr || commanderFailure('CAMERA_DISCONNECTED') }
  }
  try {
    return JSON.parse(result.stdout) as DeviceGrab
  } catch {
    return { ok: false, opened: false, streamed: false, closed: true, error: 'Camera open returned unreadable data.' }
  }
}

export function grabExplicitFrames(input: { device: string; outPath: string; frames?: number; width?: number; height?: number }): DeviceGrab {
  mkdirSync(path.dirname(input.outPath), { recursive: true })
  const result = spawnSync('python3', [
    toolPath(),
    '--capture',
    '--device', input.device,
    '--out', input.outPath,
    '--frames', String(input.frames ?? 8),
    '--width', String(input.width ?? 640),
    '--height', String(input.height ?? 480),
  ], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) {
    return { ok: false, error: result.stderr || 'Capture did not start.' }
  }
  try {
    return JSON.parse(result.stdout) as DeviceGrab
  } catch {
    return { ok: false, error: 'Capture returned unreadable data.' }
  }
}

function assetForCapture(project: HvsProject, filePath: string, duration: MediaTime, width: number, height: number): AssetRecord {
  const bytes = readFileSync(filePath)
  const now = new Date().toISOString()
  return {
    id: dhId('asset'),
    kind: 'video',
    name: path.basename(filePath),
    originalPath: filePath,
    proxyPath: null,
    thumbPath: null,
    waveformPath: null,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'video/mjpeg',
    duration,
    width,
    height,
    frameRate: { n: 30, d: 1 },
    variableFrameRate: false,
    sampleRate: null,
    channels: null,
    codec: 'mjpeg',
    container: 'mjpg',
    pixelFormat: 'MJPG',
    rotation: null,
    audioStreams: [],
    immutableOriginal: true,
    generated: false,
    provenance: null,
    createdAt: now,
    role: 'ORIGINAL',
    derivedFromAssetId: null,
  }
}

export function startPerformanceCapture(
  store: HvsDigitalHumanStore,
  input: { characterId?: string | null; mode?: HvsCaptureMode; actor: 'commander' | 'director' },
): HvsPerformanceCaptureSession {
  if (input.actor !== 'commander') {
    throw new Error('Only the Commander may start performance capture.')
  }
  const audit = auditCaptureDevices()
  store.devices = audit.devices
  const device = selectCaptureDevice(audit.devices)
  if (!device || device.type !== 'VIDEO_CAPTURE') {
    throw new Error(commanderFailure('CAMERA_DISCONNECTED'))
  }
  const opened = openCaptureDevice({ device: device.node })
  if (!opened.ok || opened.streamed) {
    throw new Error(opened.error || commanderFailure('CAMERA_DISCONNECTED'))
  }
  const session: HvsPerformanceCaptureSession = {
    id: dhId('cap'),
    characterId: input.characterId ?? null,
    mode: input.mode ?? 'BODY_REFERENCE',
    sourceDeviceId: device.id,
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'ACTIVE',
    rawCaptureRef: null,
    derivedMotionRef: null,
    consentState: 'COMMANDER_SELF_AUTHORIZED',
    deviceReleased: false,
    explicitStart: true,
  }
  if (device) device.status = 'CAPTURING'
  store.captureSessions.push(session)
  return session
}

export function recordPerformanceTake(
  project: HvsProject,
  store: HvsDigitalHumanStore,
  session: HvsPerformanceCaptureSession,
  frames = HVS_ACCEPTANCE_TAKE_FRAMES,
): { take: HvsPerformanceTake; motion: HvsPerformanceMotion; grab: DeviceGrab } {
  const device = store.devices.find(item => item.id === session.sourceDeviceId) ?? selectCaptureDevice(store.devices)
  if (!device || device.type !== 'VIDEO_CAPTURE') {
    throw new Error(commanderFailure('CAMERA_DISCONNECTED'))
  }
  const outPath = path.join(mediaCommandDataHierarchy().analysis, 'captures', project.id, `${session.id}.mjpg`)
  const grab = grabExplicitFrames({ device: device.node, outPath, frames })
  if (!grab.ok || !grab.path) {
    session.status = 'STOPPED'
    session.deviceReleased = true
    session.endTime = new Date().toISOString()
    device.status = 'CLOSED'
    const detail = grab.error?.split('\n').map(line => line.trim()).find(line => line && !/traceback|file "|error:/i.test(line)) || commanderFailure('CAMERA_DISCONNECTED')
    throw new Error(detail)
  }
  const intervals = grab.interFrameMs ?? []
  const midpoint = intervals.length ? [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : 0
  const captureFps = midpoint > 0 ? Math.round((1000 / midpoint) * 10) / 10 : 30
  const extracted = inferMoveNet({ mjpgPath: grab.path, fps: captureFps, mode: session.mode })
  const coverage = computeBodyCoverage(extracted.frames)
  const readiness = assessStandingReadiness(extracted.frames)
  const grade = gradeTake(extracted.confidence, extracted.failure)
  const duration = fromSeconds(Math.max(0.2, (grab.frames ?? frames) / Math.max(1, captureFps)))
  if (extracted.frames.some(frame => frame.bodyLandmarks.some(point => point.canonicalName === 'LEFT_SHOULDER'))) {
    store.calibrations.push(neutralCalibration(extracted.frames.slice(0, 15), session.characterId))
  }
  const motion: HvsPerformanceMotion = {
    id: dhId('motion'),
    duration,
    frameRate: { n: Math.round(captureFps), d: 1 },
    bodyFrames: extracted.frames.map(frame => ({
      time: frame.time,
      joints: frame.bodyLandmarks.filter(point => point.canonicalName).map(point => ({
        jointName: String(point.canonicalName),
        position: { x: point.x, y: point.y, z: 0 },
        confidence: point.confidence,
      })),
    })),
    faceFrames: [],
    headFrames: extracted.frames.flatMap(frame => frame.headPose ? [{
      time: frame.time,
      yaw: frame.headPose.yaw,
      pitch: frame.headPose.pitch,
      roll: frame.headPose.roll,
    }] : []),
    gazeFrames: [],
    gestureEvents: [],
    extractionStatus: extracted.status === 'EXTRACTED' ? 'EXTRACTED' : extracted.failure === 'MODEL_NOT_READY' ? 'PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED' : 'NOT_RUN',
    landmarkFrames: extracted.frames,
    confidence: extracted.confidence,
    failure: extracted.failure,
    gazeSource: extracted.gazeSource,
    evidence: {
      frameCount: grab.frames ?? 0,
      frameBytes: grab.frameBytes ?? [],
      firstFrameMs: grab.firstFrameMs ?? null,
      interFrameMs: intervals,
      captureFps,
      inferenceFps: extracted.inferenceFps,
      inferenceLatencyMs: extracted.latencyMs.mean,
      meanInferenceMs: extracted.latencyMs.mean,
      medianInferenceMs: extracted.latencyMs.median,
      p95InferenceMs: extracted.latencyMs.p95,
      droppedFrames: Math.max(0, frames - (grab.frames ?? 0)),
      processRssBytes: extracted.rssBytes ?? process.memoryUsage().rss,
      cpuUserSeconds: extracted.cpuUserSeconds,
      inferenceRan: extracted.status === 'EXTRACTED',
      delegate: 'CPU',
      modelBytes: extracted.modelBytes,
      modelSha256: extracted.modelSha256,
      landmarkBytes: Buffer.byteLength(JSON.stringify(extracted.frames)),
      previewBytes: 0,
      frameTrackingCoverage: coverage.frameTrackingCoverage,
      fullBodyCoverage: coverage.fullBodyCoverage,
      jointCoverage: coverage.jointCoverage,
      standingReadiness: readiness.level,
    },
  }
  const invented = motion.extractionStatus !== 'EXTRACTED'
    && (motion.bodyFrames.length > 0 || motion.faceFrames.length > 0 || (motion.landmarkFrames ?? []).some(frame => frame.bodyLandmarks.length > 0 || frame.faceLandmarks.length > 0))
  if (invented) throw new Error('Landmarks must not be invented.')
  const asset = assetForCapture(project, grab.path, duration, grab.width ?? 640, grab.height ?? 480)
  project.assets.push(asset)
  const motionPath = path.join(path.dirname(grab.path), `${motion.id}.json`)
  mkdirSync(path.dirname(motionPath), { recursive: true })
  if (motion.evidence) {
    motion.evidence.rawBytes = statSync(grab.path).size
    motion.evidence.landmarkPath = motionPath
  }
  writeFileSync(motionPath, JSON.stringify(motion), 'utf8')
  if (motion.evidence) motion.evidence.motionBytes = statSync(motionPath).size
  writeFileSync(motionPath, JSON.stringify(motion), 'utf8')
  const take: HvsPerformanceTake = {
    id: dhId('take'),
    captureSessionId: session.id,
    characterId: session.characterId,
    label: `TAKE ${store.takes.filter(item => item.characterId === session.characterId).length + 1}`,
    duration,
    motionRef: motion.id,
    audioRef: null,
    rawAssetId: asset.id,
    rating: null,
    selected: true,
    quality: grade.quality,
    qualityReason: grade.reason,
    trackingCoverage: coverage.frameTrackingCoverage,
    frameTrackingCoverage: coverage.frameTrackingCoverage,
    fullBodyCoverage: coverage.fullBodyCoverage,
    standingReadiness: readiness.level,
  }
  for (const prior of store.takes) {
    if (prior.characterId === take.characterId) prior.selected = false
  }
  session.rawCaptureRef = asset.id
  session.derivedMotionRef = motion.id
  session.status = 'STOPPED'
  session.endTime = new Date().toISOString()
  session.deviceReleased = true
  device.status = 'CLOSED'
  if (device.latencyMs == null && grab.firstFrameMs != null) device.latencyMs = grab.firstFrameMs
  const stored = JSON.parse(JSON.stringify(motion)) as HvsPerformanceMotion
  stored.landmarkFrames = []
  stored.bodyFrames = []
  stored.headFrames = []
  store.motions.push(stored)
  store.takes.push(take)
  return { take, motion, grab }
}

export function stopPerformanceCapture(store: HvsDigitalHumanStore, sessionId: string): HvsPerformanceCaptureSession {
  const session = store.captureSessions.find(item => item.id === sessionId)
  if (!session) throw new Error('Capture session not found.')
  session.status = 'STOPPED'
  session.endTime = new Date().toISOString()
  session.deviceReleased = true
  const device = store.devices.find(item => item.id === session.sourceDeviceId)
  if (device) device.status = 'CLOSED'
  return session
}

export function reloadMotion(motion: HvsPerformanceMotion, filePath: string): HvsPerformanceMotion {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as HvsPerformanceMotion
  if (statSync(filePath).size <= 0) throw new Error('Motion file is empty.')
  return parsed.id === motion.id ? parsed : motion
}
