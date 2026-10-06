/**
 * MoveNet SinglePose Lightning behind the existing landmark adapter.
 * Face, iris, and hand models are not loaded.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { sceneTime } from '../director/clock'
import {
  HVS_LANDMARK_CONFIDENCE_THRESHOLD,
  deriveCoarseHeadPose,
  filterLandmarkFrames,
  gazeSourceFor,
  motionConfidence,
  normalizeLandmarkPoint,
  withDerivedJoints,
  computeBodyCoverage,
  assessStandingReadiness,
} from './landmark-adapter'
import { MOVENET_LIGHTNING, movenetModelPath, verifyMoveNetFile } from './movenet-catalog'
import type { HvsCaptureFailure, HvsCaptureMode, HvsLandmarkFrame, HvsMotionConfidence, HvsPerformanceMotion } from './types'

export function loadPerformanceFrames(motion: HvsPerformanceMotion | undefined): HvsLandmarkFrame[] {
  if (!motion) return []
  if (motion.landmarkFrames?.length) return motion.landmarkFrames
  const file = motion.evidence?.landmarkPath
  if (!file || !existsSync(file)) return []
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as HvsPerformanceMotion
  return parsed.landmarkFrames ?? []
}

export type MoveNetInference = {
  frames: HvsLandmarkFrame[]
  status: 'EXTRACTED' | 'NOT_RUN'
  failure: HvsCaptureFailure | null
  gazeSource: 'HEAD_DIRECTION_ONLY' | 'NOT_MEASURED'
  handStatus: 'HAND_TRACKING_NOT_AVAILABLE'
  confidence: HvsMotionConfidence
  preprocess: {
    modelInput: number
    resize: string
    layout: string
    normalization: string
    sourceWidth: number
    sourceHeight: number
  } | null
  latencyMs: { mean: number | null; median: number | null; p95: number | null }
  inferenceFps: number | null
  cpuUserSeconds: number | null
  rssBytes: number | null
  delegate: 'CPU'
  modelSha256: string
  modelBytes: number
}

type RawPoint = { name: string; x: number; y: number; score: number; insideFrame: boolean }
type RawFrame = { index: number; meanLuma: number; inferenceMs: number; points: RawPoint[] }

function toolPath(): string {
  return path.join(process.cwd(), 'lib/media-command/digital-human/movenet_tflite.py')
}

export function inferMoveNet(input: { mjpgPath?: string; jpegPath?: string; fps?: number; mode?: HvsCaptureMode }): MoveNetInference {
  const verified = verifyMoveNetFile()
  const empty = (failure: HvsCaptureFailure | null): MoveNetInference => ({
    frames: [],
    status: 'NOT_RUN',
    failure,
    gazeSource: 'NOT_MEASURED',
    handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
    confidence: motionConfidence([]),
    preprocess: null,
    latencyMs: { mean: null, median: null, p95: null },
    inferenceFps: null,
    cpuUserSeconds: null,
    rssBytes: null,
    delegate: 'CPU',
    modelSha256: verified.sha256,
    modelBytes: verified.bytes,
  })
  if (!verified.ok) return empty(verified.reason === 'MOVENET_SOURCE_MISMATCH' ? 'MODEL_NOT_READY' : 'MODEL_NOT_READY')
  if (input.mode && input.mode !== 'BODY_REFERENCE' && input.mode !== 'HEAD_REFERENCE' && input.mode !== 'GESTURE_REFERENCE' && input.mode !== 'DIRECTOR_BLOCKING' && input.mode !== 'EYELINE_REFERENCE') {
    // Face and dialogue modes still run the body model only. They do not load a face model.
  }
  const args = [toolPath(), '--model', movenetModelPath()]
  if (input.mjpgPath) args.push('--mjpg', input.mjpgPath)
  else if (input.jpegPath) args.push('--jpeg', input.jpegPath)
  else return empty(null)
  const run = spawnSync('python3', args, { encoding: 'utf8', timeout: 120000 })
  if (run.status !== 0 || !run.stdout) return empty('MODEL_NOT_READY')
  const parsed = JSON.parse(run.stdout) as {
    modelInput: number
    normalization: string
    resize: string
    layout: string
    delegate: string
    frames: RawFrame[]
    latencyMs: { mean: number | null; median: number | null; p95: number | null }
    cpuUserSeconds: number
    rssBytes: number
    preprocess: { sourceWidth: number; sourceHeight: number } | null
  }
  const fps = input.fps && input.fps > 0 ? input.fps : 30
  const mapped = parsed.frames.map(frame => {
    const accepted = frame.points.filter(point => point.insideFrame && point.score >= HVS_LANDMARK_CONFIDENCE_THRESHOLD)
    const torso = accepted.some(point => /shoulder|hip/.test(point.name))
    const person = torso && accepted.length >= 4
    const bodyLandmarks = person
      ? withDerivedJoints(accepted.map(point => normalizeLandmarkPoint({
        name: point.name,
        x: point.x,
        y: point.y,
        confidence: point.score,
      })))
      : []
    const headPose = person ? deriveCoarseHeadPose(bodyLandmarks) : null
    const row: HvsLandmarkFrame = {
      time: sceneTime(frame.index / fps),
      frameIndex: frame.index,
      bodyLandmarks,
      faceLandmarks: [],
      handLandmarks: [],
      headPose,
      gazeSource: headPose ? 'HEAD_DIRECTION_ONLY' : 'NOT_MEASURED',
      handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
      confidence: bodyLandmarks.length ? Math.min(...bodyLandmarks.map(point => point.confidence)) : 0,
      source: MOVENET_LIGHTNING.id,
      modelId: MOVENET_LIGHTNING.id,
      personCount: person ? 1 : 0,
    }
    row.gazeSource = gazeSourceFor(row)
    return row
  })
  const frames = filterLandmarkFrames(mapped)
  const seen = frames.some(frame => frame.bodyLandmarks.length > 0)
  const dark = parsed.frames.length > 0 && parsed.frames.filter(frame => frame.meanLuma < 18).length > parsed.frames.length / 2
  const peak = Math.max(0, ...parsed.frames.flatMap(frame => frame.points.map(point => point.score)))
  const coverage = computeBodyCoverage(frames)
  let failure: HvsCaptureFailure | null = null
  if (!seen) failure = dark ? 'LOW_LIGHT' : peak >= 0.2 ? 'TRACKING_LOST' : 'NO_PERSON_DETECTED'
  else if (coverage.fullBodyCoverage < 0.5 || coverage.bothHipsCoverage < 0.4) failure = 'PARTIAL_BODY'
  const mean = parsed.latencyMs.mean
  return {
    frames,
    status: 'EXTRACTED',
    failure,
    gazeSource: frames.some(frame => frame.gazeSource === 'HEAD_DIRECTION_ONLY') ? 'HEAD_DIRECTION_ONLY' : 'NOT_MEASURED',
    handStatus: 'HAND_TRACKING_NOT_AVAILABLE',
    confidence: motionConfidence(frames),
    preprocess: {
      modelInput: parsed.modelInput,
      resize: parsed.resize,
      layout: parsed.layout,
      normalization: parsed.normalization,
      sourceWidth: parsed.preprocess?.sourceWidth ?? 0,
      sourceHeight: parsed.preprocess?.sourceHeight ?? 0,
    },
    latencyMs: parsed.latencyMs,
    inferenceFps: mean && mean > 0 ? Math.round((1000 / mean) * 10) / 10 : null,
    cpuUserSeconds: parsed.cpuUserSeconds,
    rssBytes: parsed.rssBytes,
    delegate: 'CPU',
    modelSha256: verified.sha256,
    modelBytes: verified.bytes,
  }
}

export function restoreLetterboxPoint(input: {
  xNorm: number
  yNorm: number
  sourceWidth: number
  sourceHeight: number
  modelInput: number
}): { x: number; y: number; insideFrame: boolean } {
  const scale = Math.min(input.modelInput / input.sourceWidth, input.modelInput / input.sourceHeight)
  const resizedW = Math.max(1, Math.round(input.sourceWidth * scale))
  const resizedH = Math.max(1, Math.round(input.sourceHeight * scale))
  const padX = Math.floor((input.modelInput - resizedW) / 2)
  const padY = Math.floor((input.modelInput - resizedH) / 2)
  const srcX = (input.xNorm * input.modelInput - padX) / scale
  const srcY = (input.yNorm * input.modelInput - padY) / scale
  const insideFrame = srcX >= 0 && srcX <= input.sourceWidth && srcY >= 0 && srcY <= input.sourceHeight
  return {
    x: Math.min(1, Math.max(0, srcX / Math.max(1, input.sourceWidth))),
    y: Math.min(1, Math.max(0, srcY / Math.max(1, input.sourceHeight))),
    insideFrame,
  }
}

export const FULL_BODY_CHECK_JOINTS = [
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

export const FULL_BODY_READINESS_PORTION = 0.5

export function assessFullBodyReadiness(frames: HvsLandmarkFrame[], options?: { meanLuma?: number | null }) {
  const ready = assessStandingReadiness(frames, options)
  return {
    ...ready,
    coverage: ready.persistRatio,
    portion: FULL_BODY_READINESS_PORTION,
  }
}

export const MoveNetTfliteLandmarkAdapter = {
  id: 'MoveNetTfliteLandmarkAdapter',
  modelId: MOVENET_LIGHTNING.id,
  extract: inferMoveNet,
  restore: restoreLetterboxPoint,
} as const

export const HvsLandmarkAdapter = {
  backend: MoveNetTfliteLandmarkAdapter,
}
