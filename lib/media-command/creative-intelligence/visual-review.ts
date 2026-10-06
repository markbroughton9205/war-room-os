/**
 * Optional bounded visual review of current preview/render frames.
 * Does not change FFmpeg core rules. Does not send Ra'el / MetaHuman biometric refs.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { resolveFfmpegTools, runProcess } from '../ffmpeg'
import {
  HVS_WAVE1_EXTERNAL_UPLOAD_AUTHORIZED,
  HVS_WAVE9_EXTERNAL_UPLOAD_AUTHORIZED,
} from '../policy'
import {
  HVS_CREATIVE_MAX_FRAMES,
  HVS_CREATIVE_PREFERRED_FRAMES,
  type HvsIdentifiedVisualFrame,
  type HvsRenderIdentity,
  type HvsVisualReviewAdapter,
  type HvsVisualReviewRecord,
  type HvsVisualReviewStatus,
} from './types'

const BIOMETRIC_MARKERS = [
  /ra'?el/i,
  /metahuman/i,
  /likeness/i,
  /face[-_ ]?ref/i,
  /body[-_ ]?train/i,
  /biometric/i,
  /\bdna\b/i,
  /fitting[-_ ]?ref/i,
]

export function containsBiometricMaterial(texts: Array<string | null | undefined>): boolean {
  return texts.some(text => Boolean(text) && BIOMETRIC_MARKERS.some(rx => rx.test(text!)))
}

export function visualExfilPermitted(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.HVS_CREATIVE_VISION_AUTHORIZED !== '1') return false
  if (!HVS_WAVE1_EXTERNAL_UPLOAD_AUTHORIZED) return false
  if (!HVS_WAVE9_EXTERNAL_UPLOAD_AUTHORIZED) return false
  return true
}

export function renderIdentityKey(identity: HvsRenderIdentity): string {
  return [identity.projectId ?? '', identity.hash ?? '', identity.jobId ?? '', identity.versionId ?? '', identity.path ?? ''].join('|')
}

export function visualReviewIsCurrent(
  review: HvsVisualReviewRecord | null | undefined,
  current: HvsRenderIdentity | null | undefined,
): boolean {
  if (!review || !current) return false
  if (review.status !== 'ACTIVE') return false
  const a = renderIdentityKey(review.renderIdentity)
  const b = renderIdentityKey(current)
  return a.length > 0 && a === b
}

export function staleVisualReview(
  previous: HvsVisualReviewRecord | null | undefined,
  current: HvsRenderIdentity,
): HvsVisualReviewRecord {
  return {
    status: 'STALE',
    renderIdentity: current,
    frames: [],
    findings: [],
    inspected: false,
    skipReason: 'Current render identity changed. Previous visual review is not current.',
  }
}

function sampleTimestamps(durationSec: number, count: number): Array<{ t: number; role: HvsIdentifiedVisualFrame['role'] }> {
  const n = Math.max(2, Math.min(count, HVS_CREATIVE_MAX_FRAMES))
  const roles: HvsIdentifiedVisualFrame['role'][] = ['opening', 'early-middle', 'midpoint', 'late-middle', 'ending']
  const times: number[] = []
  for (let i = 0; i < n; i++) {
    const ratio = n === 1 ? 0 : i / (n - 1)
    times.push(Math.max(0, Math.min(durationSec - 0.05, durationSec * ratio)))
  }
  return times.map((t, i) => ({
    t,
    role: roles[Math.round((i / Math.max(1, n - 1)) * (roles.length - 1))] ?? 'midpoint',
  }))
}

async function probeDurationSec(ffprobe: string, source: string): Promise<number | null> {
  const result = await runProcess(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    source,
  ], 15_000)
  if (!result.ok) return null
  const value = Number.parseFloat(result.stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function extractCurrentRenderFrames(input: {
  renderIdentity: HvsRenderIdentity
  maxFrames?: number
  biometricTexts?: Array<string | null | undefined>
}): Promise<{
  status: HvsVisualReviewStatus
  frames: HvsIdentifiedVisualFrame[]
  skipReason: string | null
}> {
  if (containsBiometricMaterial(input.biometricTexts ?? [])) {
    return { status: 'NEEDS_AUTHORIZATION', frames: [], skipReason: 'Ra\'el / MetaHuman / biometric material is excluded from this generic vision path.' }
  }
  const source = input.renderIdentity.path
  if (!source || !existsSync(source)) {
    return { status: 'NOT_RUN', frames: [], skipReason: 'No current render/preview path with known identity.' }
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !tools.ffprobe) {
    return { status: 'NOT_RUN', frames: [], skipReason: 'FFmpeg tools unavailable for bounded frame extraction.' }
  }
  const duration = await probeDurationSec(tools.ffprobe, source)
  if (!duration) {
    return { status: 'NOT_RUN', frames: [], skipReason: 'Could not probe current render duration.' }
  }
  const wanted = Math.min(input.maxFrames ?? HVS_CREATIVE_PREFERRED_FRAMES, HVS_CREATIVE_MAX_FRAMES)
  const samples = sampleTimestamps(duration, wanted)
  const dir = path.join(tmpdir(), 'hvs-creative-frames', String(Date.now()))
  mkdirSync(dir, { recursive: true })
  const frames: HvsIdentifiedVisualFrame[] = []
  for (const [index, sample] of samples.entries()) {
    const out = path.join(dir, `frame_${String(index).padStart(3, '0')}.jpg`)
    const shot = await runProcess(tools.ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', sample.t.toFixed(3),
      '-i', source,
      '-frames:v', '1',
      '-q:v', '4',
      out,
    ], 20_000)
    if (!shot.ok || !existsSync(out)) continue
    const bytes = readFileSync(out)
    frames.push({
      frameId: `frame-${index}-${sample.t.toFixed(2)}`,
      timestampSec: sample.t,
      index,
      role: sample.role,
      sourcePath: out,
      sourceHash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      renderIdentity: input.renderIdentity,
      provenance: 'current-render',
    })
  }
  if (!frames.length) {
    return { status: 'NOT_RUN', frames: [], skipReason: 'Frame extraction produced no stills.' }
  }
  if (!visualExfilPermitted()) {
    return {
      status: 'NEEDS_AUTHORIZATION',
      frames,
      skipReason: 'Current HVS provider policy does not permit sending production frames to an external vision provider.',
    }
  }
  return { status: 'ACTIVE', frames, skipReason: null }
}

export function createHvsVisualReviewAdapter(input: {
  renderIdentity: HvsRenderIdentity
  biometricTexts?: Array<string | null | undefined>
  inspect?: boolean
}): HvsVisualReviewAdapter {
  return {
    didInspect: input.inspect === true && visualExfilPermitted() && !containsBiometricMaterial(input.biometricTexts ?? []),
    async sampleFrames({ maxFrames }) {
      const extracted = await extractCurrentRenderFrames({
        renderIdentity: input.renderIdentity,
        maxFrames: Math.min(maxFrames, HVS_CREATIVE_MAX_FRAMES),
        biometricTexts: input.biometricTexts,
      })
      return extracted.frames.slice(0, HVS_CREATIVE_MAX_FRAMES).map((frame, index) => ({
        index,
        role: frame.role,
        renderIdentity: frame.renderIdentity,
        provenance: frame.provenance,
      }))
    },
  }
}

export function emptyVisualReview(status: HvsVisualReviewStatus, identity: HvsRenderIdentity, reason: string): HvsVisualReviewRecord {
  return {
    status,
    renderIdentity: identity,
    frames: [],
    findings: [],
    inspected: false,
    skipReason: reason,
  }
}
