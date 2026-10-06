/**
 * Local Commander face-reference stills for MetaHuman Creator.
 * JPEG files only. No embeddings, templates, identity scores, cloud upload, or training.
 * Camera stays off until the Commander presses Start camera.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { RAEL_CHARACTER_ID, type HvsConsentState } from './types'
import { assertIdentityAuthority } from './authority'
import { HVS_UE01_PROJECT_ID } from '../unreal/package'
import { markFaceReferenceState } from '../unreal/metahuman-binding'

export const HVS_FACE_REFERENCE_SCHEMA = 1 as const
export const HVS_FACE_REFERENCE_REQUIRED = [
  'FRONT_NEUTRAL',
  'LEFT_THREE_QUARTER',
  'RIGHT_THREE_QUARTER',
  'LEFT_PROFILE',
  'RIGHT_PROFILE',
] as const
export const HVS_FACE_REFERENCE_OPTIONAL = ['FRONT_SMILE'] as const
export type HvsFaceReferenceType = typeof HVS_FACE_REFERENCE_REQUIRED[number] | typeof HVS_FACE_REFERENCE_OPTIONAL[number]
export const HVS_FACE_CONSENT: HvsConsentState = 'COMMANDER_SELF_AUTHORIZED'

export type HvsFaceQuality = {
  width: number
  height: number
  bytes: number
  meanLuma: number
  centerLuma: number
  sharpness: number
  tooDark: boolean
  tooBright: boolean
  possibleBlur: boolean
  possibleOcclusion: boolean
  framing: 'OK' | 'TIGHT' | 'OFF_CENTER'
  verdict: 'ACCEPT' | 'WARN' | 'REJECT'
  reasons: string[]
}

export type HvsFaceStill = {
  type: HvsFaceReferenceType
  file: string
  capturedAt: string
  quality: HvsFaceQuality
  accepted: boolean
  optional: boolean
}

export type HvsFaceReferenceSet = {
  schema: typeof HVS_FACE_REFERENCE_SCHEMA
  projectId: string
  characterId: typeof RAEL_CHARACTER_ID
  identityId: typeof RAEL_CHARACTER_ID
  consent: HvsConsentState
  consentScope: {
    captureOnly: true
    voice: false
    training: false
    cloud: false
    cloning: false
    embeddings: false
    identityRecognition: false
    animatorSolve: false
  }
  cameraDefaultOff: true
  required: typeof HVS_FACE_REFERENCE_REQUIRED
  optional: typeof HVS_FACE_REFERENCE_OPTIONAL
  stills: Partial<Record<HvsFaceReferenceType, HvsFaceStill>>
  status: 'REFERENCE CAPTURE REQUIRED' | 'REFERENCE CAPTURED' | 'INCOMPLETE'
  localOnly: true
}

function setDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'face-reference', projectId, RAEL_CHARACTER_ID)
  mkdirSync(dir, { recursive: true })
  return dir
}

function legacySetPath(projectId: string): string {
  return path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'face-reference', projectId, 'set.json')
}

export function faceReferenceSetPath(projectId: string): string {
  return path.join(setDir(projectId), 'set.json')
}

export function emptyFaceReferenceSet(projectId = HVS_UE01_PROJECT_ID): HvsFaceReferenceSet {
  return {
    schema: HVS_FACE_REFERENCE_SCHEMA,
    projectId,
    characterId: RAEL_CHARACTER_ID,
    identityId: RAEL_CHARACTER_ID,
    consent: HVS_FACE_CONSENT,
    consentScope: {
      captureOnly: true,
      voice: false,
      training: false,
      cloud: false,
      cloning: false,
      embeddings: false,
      identityRecognition: false,
      animatorSolve: false,
    },
    cameraDefaultOff: true,
    required: HVS_FACE_REFERENCE_REQUIRED,
    optional: HVS_FACE_REFERENCE_OPTIONAL,
    stills: {},
    status: 'REFERENCE CAPTURE REQUIRED',
    localOnly: true,
  }
}

function refreshStatus(set: HvsFaceReferenceSet): HvsFaceReferenceSet {
  const accepted = HVS_FACE_REFERENCE_REQUIRED.filter(type => set.stills[type]?.accepted)
  set.status = accepted.length === HVS_FACE_REFERENCE_REQUIRED.length ? 'REFERENCE CAPTURED' : 'REFERENCE CAPTURE REQUIRED'
  return set
}

export function readFaceReferenceSet(projectId: string): HvsFaceReferenceSet {
  const file = faceReferenceSetPath(projectId)
  const legacy = legacySetPath(projectId)
  if (!existsSync(file) && existsSync(legacy)) {
    const parsed = JSON.parse(readFileSync(legacy, 'utf8')) as HvsFaceReferenceSet
    const migrated = refreshStatus({ ...emptyFaceReferenceSet(projectId), ...parsed, stills: parsed.stills ?? {} })
    writeFaceReferenceSet(migrated)
    return readFaceReferenceSet(projectId)
  }
  if (!existsSync(file)) {
    const empty = emptyFaceReferenceSet(projectId)
    writeFileSync(file, `${JSON.stringify(empty, null, 2)}\n`)
    return empty
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as HvsFaceReferenceSet
  return refreshStatus({ ...emptyFaceReferenceSet(projectId), ...parsed, stills: parsed.stills ?? {} })
}

export function writeFaceReferenceSet(set: HvsFaceReferenceSet): string {
  const next = refreshStatus(set)
  const file = faceReferenceSetPath(next.projectId)
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  markFaceReferenceState(next.projectId, next.status === 'REFERENCE CAPTURED' ? 'REFERENCE_CAPTURED' : 'REFERENCE_CAPTURE_REQUIRED')
  return file
}

export function jpegDimensions(buf: Buffer | Uint8Array | null | undefined): { width: number; height: number } | null {
  if (!buf || typeof buf.length !== 'number' || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  let i = 2
  while (i < bytes.length - 8) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = bytes[i + 1]
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
    }
    const len = bytes.readUInt16BE(i + 2)
    if (len < 2) break
    i += 2 + len
  }
  return null
}

function ffmpegLuma(file: string): number | null {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-'], {
    encoding: 'buffer',
    maxBuffer: 1024 * 64,
  })
  if (result.status !== 0 || !result.stdout || result.stdout.length < 16) return null
  const bytes = result.stdout as Buffer
  let sum = 0
  for (const value of bytes) sum += value
  return sum / bytes.length
}

export function assessFaceStill(input: {
  bytes?: Buffer | Uint8Array | null
  jpeg?: Buffer | Uint8Array | null
  meanLuma: number
  centerLuma: number
  sharpness: number
  possibleOcclusion?: boolean
}): HvsFaceQuality {
  const bytes = input.bytes ?? input.jpeg ?? null
  const byteLength = bytes?.length ?? 0
  const dims = jpegDimensions(bytes)
  const width = dims?.width ?? 0
  const height = dims?.height ?? 0
  const reasons: string[] = []
  const tooDark = input.meanLuma < 18
  const tooBright = input.meanLuma > 230
  const possibleBlur = input.sharpness < 6
  const framing: HvsFaceQuality['framing'] = width < 320 || height < 240 ? 'TIGHT' : input.centerLuma < input.meanLuma * 0.45 ? 'OFF_CENTER' : 'OK'
  if (!bytes || byteLength < 4) reasons.push('CAPTURE_FAILED: no JPEG bytes.')
  if (!dims) reasons.push('Not a JPEG still.')
  if (width < 320 || height < 240) reasons.push('Frame is too small.')
  if (byteLength < 4000) reasons.push('File is too small to be a usable still.')
  if (tooDark) reasons.push('Frame is too dark.')
  if (tooBright) reasons.push('Frame is overexposed.')
  if (framing === 'OFF_CENTER') reasons.push('Face may be off-center. Keep the head in the middle of the frame.')
  if (possibleBlur) reasons.push('Possible blur. Hold still and check focus.')
  if (input.possibleOcclusion) reasons.push('Possible occlusion. Remove glasses glare / hands / hair covering the face.')
  let verdict: HvsFaceQuality['verdict'] = 'ACCEPT'
  if (!bytes || !dims || byteLength < 4000 || width < 240 || height < 180 || input.meanLuma < 8 || input.meanLuma > 248) {
    verdict = 'REJECT'
  } else if (tooDark || tooBright || possibleBlur || framing !== 'OK' || input.possibleOcclusion) {
    verdict = 'WARN'
  }
  return {
    width,
    height,
    bytes: byteLength,
    meanLuma: input.meanLuma,
    centerLuma: input.centerLuma,
    sharpness: input.sharpness,
    tooDark,
    tooBright,
    possibleBlur,
    possibleOcclusion: Boolean(input.possibleOcclusion),
    framing,
    verdict,
    reasons,
  }
}

export function saveCapturedStill(input: {
  projectId: string
  type: HvsFaceReferenceType
  jpeg: Buffer
  meanLuma: number
  centerLuma: number
  sharpness: number
  possibleOcclusion?: boolean
  accept: boolean
}): { set: HvsFaceReferenceSet; still: HvsFaceStill; quality: HvsFaceQuality } {
  assertIdentityAuthority('commander', 'FACE_REFERENCE_ENROLLMENT')
  if (!input.jpeg || typeof input.jpeg.length !== 'number' || input.jpeg.length < 4) {
    throw new Error('CAPTURE_FAILED: no JPEG bytes.')
  }
  const quality = assessFaceStill({
    bytes: input.jpeg,
    jpeg: input.jpeg,
    meanLuma: input.meanLuma,
    centerLuma: input.centerLuma,
    sharpness: input.sharpness,
    possibleOcclusion: input.possibleOcclusion,
  })
  if (input.accept && quality.verdict === 'REJECT') {
    throw new Error(quality.reasons[0] ?? 'Still was rejected. Retake it.')
  }
  const dir = setDir(input.projectId)
  const file = path.join(dir, `${input.type}.jpg`)
  writeFileSync(file, input.jpeg)
  const sampled = ffmpegLuma(file)
  if (sampled != null) quality.meanLuma = sampled
  const still: HvsFaceStill = {
    type: input.type,
    file,
    capturedAt: new Date().toISOString(),
    quality,
    accepted: input.accept && quality.verdict !== 'REJECT',
    optional: (HVS_FACE_REFERENCE_OPTIONAL as readonly string[]).includes(input.type),
  }
  const set = readFaceReferenceSet(input.projectId)
  set.stills[input.type] = still
  writeFaceReferenceSet(set)
  return { set: readFaceReferenceSet(input.projectId), still, quality }
}

export function retakeStill(projectId: string, type: HvsFaceReferenceType): HvsFaceReferenceSet {
  const set = readFaceReferenceSet(projectId)
  const existing = set.stills[type]
  if (existing?.file && existsSync(existing.file)) unlinkSync(existing.file)
  delete set.stills[type]
  writeFaceReferenceSet(set)
  return readFaceReferenceSet(projectId)
}

export function faceStillBytes(projectId: string, type: HvsFaceReferenceType): Buffer | null {
  const set = readFaceReferenceSet(projectId)
  const file = set.stills[type]?.file
  if (!file || !existsSync(file)) return null
  return readFileSync(file)
}

export function isRequiredType(type: string): type is HvsFaceReferenceType {
  return (HVS_FACE_REFERENCE_REQUIRED as readonly string[]).includes(type)
    || (HVS_FACE_REFERENCE_OPTIONAL as readonly string[]).includes(type)
}
