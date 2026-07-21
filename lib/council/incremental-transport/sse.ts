import {
  COUNCIL_STREAM_VERSION,
  type CouncilStreamEnvelope,
  type CouncilStreamParserEvent,
  type CouncilStreamSanitizedError,
} from './types'

const SECRET_LIKE_PATTERN = /(sk-[a-z0-9_-]{12,}|xai-[a-z0-9_-]{12,}|eyJ[a-z0-9._-]{20,}|service[_-]?role|supabase[_-]?service|refresh_token|access_token|authorization|bearer\s+[a-z0-9._-]{8,})/i
const FILESYSTEM_OR_STACK_PATTERN = /([a-z]:\\(?:users|dev|repo|workspace|tmp|app)[\\/]|\/(?:users|home|var|tmp|app|workspace|mnt)\/|(?:\bat\s+.*\()?[^\s()]+\.(?:ts|tsx|js|jsx|mjs|cjs):\d+(?::\d+)?)/i
const INTERNAL_PROMPT_PATTERN = /(raw internal prompt|system prompt|you are in a live war room council|council_instruction|red_team_calibration_instruction)/i

export function sanitizeCouncilStreamError(error: unknown, code = 'transport_error'): CouncilStreamSanitizedError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Council stream failed.'
  const unsafe = SECRET_LIKE_PATTERN.test(raw) || FILESYSTEM_OR_STACK_PATTERN.test(raw) || INTERNAL_PROMPT_PATTERN.test(raw)
  const message = unsafe ? 'Council stream failed with a redacted diagnostic.' : raw.slice(0, 240)
  return {
    code,
    message,
    terminal: true,
    classification: code.includes('validation') ? 'validation' : code.includes('auth') ? 'auth' : 'transport',
  }
}

export function encodeCouncilStreamEnvelope(envelope: CouncilStreamEnvelope): string {
  return `event: ${envelope.envelopeType}\ndata: ${JSON.stringify(envelope)}\n\n`
}

export function encodeCouncilStreamComment(comment: string): string {
  return `: ${comment.replace(/\r?\n/g, ' ')}\n\n`
}

export function validateCouncilStreamEnvelopeShape(value: unknown): value is CouncilStreamEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<CouncilStreamEnvelope>
  if (envelope.version !== COUNCIL_STREAM_VERSION) return false
  if (!['opened', 'progress', 'final', 'error', 'closed'].includes(String(envelope.envelopeType))) return false
  if (typeof envelope.requestId !== 'string' || !envelope.requestId.trim()) return false
  if (!(typeof envelope.operationId === 'string' || envelope.operationId === null)) return false
  if (typeof envelope.sequence !== 'number' || !Number.isInteger(envelope.sequence) || envelope.sequence < 0) return false
  if (typeof envelope.emittedAt !== 'string' || !envelope.emittedAt) return false
  if (envelope.envelopeType === 'progress') {
    const progress = envelope as Partial<Extract<CouncilStreamEnvelope, { envelopeType: 'progress' }>>
    return Boolean(progress.progressEvent && progress.snapshot)
  }
  if (envelope.envelopeType === 'final') {
    return 'finalResponse' in envelope
  }
  if (envelope.envelopeType === 'error') {
    const err = (envelope as Partial<Extract<CouncilStreamEnvelope, { envelopeType: 'error' }>>).error
    return Boolean(err && typeof err.code === 'string' && typeof err.message === 'string')
  }
  if (envelope.envelopeType === 'closed') {
    return typeof (envelope as Partial<Extract<CouncilStreamEnvelope, { envelopeType: 'closed' }>>).terminalState === 'string'
  }
  return envelope.envelopeType === 'opened'
}

function parseSseFrame(frame: string): CouncilStreamParserEvent | null {
  const lines = frame.split(/\r?\n/)
  const dataLines: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const colonIndex = line.indexOf(':')
    const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line
    const value = colonIndex >= 0 ? line.slice(colonIndex + 1).replace(/^ /, '') : ''
    if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length) return null
  const rawData = dataLines.join('\n')
  try {
    const parsed = JSON.parse(rawData) as unknown
    if (!validateCouncilStreamEnvelopeShape(parsed)) {
      return {
        ok: false,
        error: {
          code: 'malformed_stream_envelope',
          message: 'Council stream envelope shape was invalid.',
          terminal: true,
          classification: 'transport',
        },
        rawFrame: frame,
      }
    }
    return { ok: true, envelope: parsed }
  } catch {
    return {
      ok: false,
      error: {
        code: 'malformed_stream_json',
        message: 'Council stream frame contained invalid JSON.',
        terminal: true,
        classification: 'transport',
      },
      rawFrame: frame,
    }
  }
}

export function createCouncilSseParser(onEvent: (event: CouncilStreamParserEvent) => void): {
  push(chunk: string): void
  flush(): void
  reset(): void
} {
  let buffer = ''
  function drain(): void {
    let boundary = buffer.search(/\r?\n\r?\n/)
    while (boundary >= 0) {
      const separatorLength = buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + separatorLength)
      const parsed = parseSseFrame(frame)
      if (parsed) onEvent(parsed)
      boundary = buffer.search(/\r?\n\r?\n/)
    }
  }
  return {
    push(chunk) {
      buffer += chunk
      drain()
    },
    flush() {
      if (!buffer.trim()) {
        buffer = ''
        return
      }
      const parsed = parseSseFrame(buffer)
      buffer = ''
      if (parsed) onEvent(parsed)
    },
    reset() {
      buffer = ''
    },
  }
}
