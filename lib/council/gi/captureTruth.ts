import {
  CAPTURE_TRUTH_STATES,
  FORBIDDEN_CAPTURE_LABELS,
  type CaptureTruth,
  type CommanderTurnV1,
} from './types'

const ALIASES: Record<string, CaptureTruth> = {
  capturing: 'CAPTURING',
  captured: 'CAPTURED',
  available: 'AVAILABLE',
  unavailable: 'UNAVAILABLE',
  failed: 'FAILED',
  partial: 'PARTIAL',
  not_requested: 'NOT_REQUESTED',
  permission_denied: 'PERMISSION_DENIED',
  device_unavailable: 'DEVICE_UNAVAILABLE',
  muted: 'MUTED',
  idle: 'IDLE',
}

export function isCaptureTruth(value: unknown): value is CaptureTruth {
  return typeof value === 'string' && (CAPTURE_TRUTH_STATES as readonly string[]).includes(value)
}

export function normalizeCaptureTruth(value: unknown, fallback: CaptureTruth = 'NOT_REQUESTED'): CaptureTruth {
  if (isCaptureTruth(value)) return value
  if (typeof value !== 'string') return fallback
  const key = value.trim()
  if (isCaptureTruth(key)) return key
  const aliased = ALIASES[key.toLowerCase()]
  if (aliased) return aliased
  return fallback
}

export function isForbiddenCaptureLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return (FORBIDDEN_CAPTURE_LABELS as readonly string[]).includes(value.trim().toUpperCase())
}

/**
 * UI may show LISTENING iff live capture is proven.
 * Permission denied, idle chrome, or missing session id must not display LISTENING.
 */
export function canShowListening(input: {
  capture_truth?: CaptureTruth | string | null
  voice_session_id?: string | null
} | CommanderTurnV1): boolean {
  const capture = 'capture_truth' in input
    ? normalizeCaptureTruth((input as { capture_truth?: unknown }).capture_truth)
    : 'NOT_REQUESTED'
  const voiceId =
    'voice' in input && input.voice
      ? input.voice.voice_session_id
      : 'voice_session_id' in input
        ? input.voice_session_id
        : undefined
  return capture === 'CAPTURING' && typeof voiceId === 'string' && voiceId.trim().length > 0
}

export function captureTruthForPublicUi(input: {
  capture_truth?: CaptureTruth | string | null
  voice_session_id?: string | null
} | CommanderTurnV1): CaptureTruth {
  const capture = 'capture_truth' in input
    ? normalizeCaptureTruth((input as { capture_truth?: unknown }).capture_truth)
    : 'NOT_REQUESTED'
  if (isForbiddenCaptureLabel(capture)) return 'NOT_REQUESTED'
  return capture
}
