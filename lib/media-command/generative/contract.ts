/**
 * Typed `hvs.generate.video` request validation. Pure: no fs, no process.
 * Whitelist-only. Any command/shell/script/path field fails closed with INVALID_GENERATION_REQUEST.
 */
import {
  HVS_APPROVED_MODEL_IDS,
  HVS_GENERATION_ALLOWED_KEYS,
  HVS_GENERATION_FORBIDDEN_KEYS,
  WAN22_LIMITS,
  type HvsGenerateVideoRequest,
  type HvsGenerationError,
} from './types'

export type HvsRequestValidation =
  | { ok: true; request: HvsGenerateVideoRequest }
  | { ok: false; error: HvsGenerationError }

const SAFE_ID = /^[a-zA-Z0-9._-]{1,128}$/

function invalid(message: string): HvsRequestValidation {
  return { ok: false, error: { code: 'INVALID_GENERATION_REQUEST', message } }
}

export function isSafeHvsId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !value.includes('..')
}

/** Asset ids are opaque AssetRecord ids. Anything path-like is rejected before lookup. */
export function looksLikeFilesystemPath(value: string): boolean {
  return /[\\/]/.test(value) || value.startsWith('~') || value.includes('..') || /^[a-zA-Z]:/.test(value) || /^file:/i.test(value)
}

export function validateGenerateVideoRequest(raw: unknown): HvsRequestValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Request must be an object.')
  const body = raw as Record<string, unknown>
  const forbidden = Object.keys(body).filter(key => (HVS_GENERATION_FORBIDDEN_KEYS as readonly string[]).includes(key))
  if (forbidden.length) return invalid(`Forbidden field(s): ${forbidden.join(', ')}. hvs.generate.video has no command, script, or path channel.`)
  const unknown = Object.keys(body).filter(key => !(HVS_GENERATION_ALLOWED_KEYS as readonly string[]).includes(key))
  if (unknown.length) return invalid(`Unknown field(s): ${unknown.join(', ')}.`)

  if (!isSafeHvsId(body.projectId)) return invalid('projectId is required and must be a safe id.')
  if (typeof body.prompt !== 'string') return invalid('prompt is required.')
  const prompt = body.prompt.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim()
  if (prompt.length < WAN22_LIMITS.promptMinChars) return invalid(`prompt must be at least ${WAN22_LIMITS.promptMinChars} characters.`)
  if (prompt.length > WAN22_LIMITS.promptMaxChars) return invalid(`prompt must be at most ${WAN22_LIMITS.promptMaxChars} characters.`)

  const duration = body.durationSeconds
  if (typeof duration !== 'number' || !Number.isFinite(duration)) return invalid('durationSeconds must be a number.')
  if (duration < WAN22_LIMITS.minDurationSeconds || duration > WAN22_LIMITS.maxDurationSeconds) {
    return invalid(`durationSeconds must be between ${WAN22_LIMITS.minDurationSeconds} and ${WAN22_LIMITS.maxDurationSeconds}.`)
  }

  let width: number | undefined
  let height: number | undefined
  if (body.width !== undefined || body.height !== undefined) {
    if (!Number.isInteger(body.width) || !Number.isInteger(body.height)) return invalid('width and height must be provided together as integers.')
    width = body.width as number
    height = body.height as number
    const supported = WAN22_LIMITS.supportedSizes.some(size => size.width === width && size.height === height)
    if (!supported) {
      return invalid(`Unsupported size ${width}x${height}. Wan2.2 TI2V-5B supports ${WAN22_LIMITS.supportedSizes.map(s => `${s.width}x${s.height}`).join(' or ')}.`)
    }
  }

  if (body.fps !== undefined && body.fps !== WAN22_LIMITS.fps) return invalid(`fps must be ${WAN22_LIMITS.fps} (official TI2V-5B sample_fps).`)

  if (body.seed !== undefined) {
    if (!Number.isInteger(body.seed) || (body.seed as number) < 0 || (body.seed as number) > WAN22_LIMITS.seedMax) {
      return invalid(`seed must be an integer between 0 and ${WAN22_LIMITS.seedMax}.`)
    }
  }

  let sourceImageAssetId: string | undefined
  if (body.sourceImageAssetId !== undefined && body.sourceImageAssetId !== null && body.sourceImageAssetId !== '') {
    if (typeof body.sourceImageAssetId !== 'string') return invalid('sourceImageAssetId must be an AssetRecord id.')
    if (looksLikeFilesystemPath(body.sourceImageAssetId)) return invalid('sourceImageAssetId must be an AssetRecord id, not a filesystem path.')
    if (!isSafeHvsId(body.sourceImageAssetId)) return invalid('sourceImageAssetId is not a valid AssetRecord id.')
    sourceImageAssetId = body.sourceImageAssetId
  }

  let modelPreference: HvsGenerateVideoRequest['modelPreference']
  if (body.modelPreference !== undefined) {
    if (!(HVS_APPROVED_MODEL_IDS as readonly unknown[]).includes(body.modelPreference)) {
      return invalid(`modelPreference must be one of: ${HVS_APPROVED_MODEL_IDS.join(', ')}.`)
    }
    modelPreference = body.modelPreference as HvsGenerateVideoRequest['modelPreference']
  }

  const request: HvsGenerateVideoRequest = {
    projectId: body.projectId,
    prompt,
    durationSeconds: duration,
    ...(width !== undefined && height !== undefined ? { width, height } : {}),
    ...(body.fps !== undefined ? { fps: WAN22_LIMITS.fps } : {}),
    ...(body.seed !== undefined ? { seed: body.seed as number } : {}),
    ...(sourceImageAssetId ? { sourceImageAssetId } : {}),
    ...(modelPreference ? { modelPreference } : {}),
  }
  return { ok: true, request }
}
