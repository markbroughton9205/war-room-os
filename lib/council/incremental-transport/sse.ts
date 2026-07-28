import {
  COUNCIL_STREAM_VERSION,
  type CouncilStreamEnvelope,
  type CouncilStreamEnvelopeType,
  type CouncilStreamFrameDiagnostic,
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
    const final = envelope as Partial<Extract<CouncilStreamEnvelope, { envelopeType: 'final' }>>
    return 'finalResponse' in envelope
      && ['completed', 'partial', 'failed'].includes(String(final.status))
      && typeof final.readableContributionCount === 'number'
      && typeof final.runtimeEventCount === 'number'
      && typeof final.completedAt === 'string'
      && Boolean(final.completedAt)
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

const KNOWN_STREAM_EVENT_NAMES: ReadonlySet<CouncilStreamEnvelopeType> = new Set(['opened', 'progress', 'final', 'error', 'closed'])

function malformedEvent(
  code: string,
  message: string,
  frame: string,
  eventName: string | null,
  id: string | null,
  retry: number | null,
): CouncilStreamParserEvent {
  return {
    ok: false,
    error: {
      code,
      message,
      terminal: true,
      classification: 'transport',
    },
    rawFrame: frame,
    eventName,
    id,
    retry,
  }
}

function parseSseFrame(frame: string): CouncilStreamParserEvent | null {
  const lines = frame.split(/\r?\n/)
  const dataLines: string[] = []
  let eventName: string | null = null
  let id: string | null = null
  let retry: number | null = null
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const colonIndex = line.indexOf(':')
    const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line
    const value = colonIndex >= 0 ? line.slice(colonIndex + 1).replace(/^ /, '') : ''
    if (field === 'event') eventName = value || null
    if (field === 'id') id = value || null
    if (field === 'retry') {
      const parsedRetry = Number(value)
      retry = Number.isFinite(parsedRetry) ? parsedRetry : null
    }
    if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length) return null
  const rawData = dataLines.join('\n')
  try {
    const parsed = JSON.parse(rawData) as unknown
    if (!validateCouncilStreamEnvelopeShape(parsed)) {
      return malformedEvent('malformed_stream_envelope', 'Council stream envelope shape was invalid.', frame, eventName, id, retry)
    }
    if (eventName && KNOWN_STREAM_EVENT_NAMES.has(eventName as CouncilStreamEnvelopeType) && eventName !== parsed.envelopeType) {
      return malformedEvent('stream_event_name_mismatch', 'Council stream event name did not match envelope type.', frame, eventName, id, retry)
    }
    return { ok: true, envelope: parsed, eventName, id, retry }
  } catch {
    return malformedEvent('malformed_stream_json', 'Council stream frame contained invalid JSON.', frame, eventName, id, retry)
  }
}

function frameDiagnostic(frame: string, parsed: CouncilStreamParserEvent | null, frameIndex: number): CouncilStreamFrameDiagnostic {
  const lines = frame.split(/\r?\n/)
  const dataLineCount = lines.filter(line => line.startsWith('data:') || line === 'data').length
  const dataCharLength = lines
    .filter(line => line.startsWith('data:') || line === 'data')
    .map(line => line.includes(':') ? line.slice(line.indexOf(':') + 1).replace(/^ /, '') : '')
    .join('\n')
    .length
  const commentOnly = lines.every(line => !line || line.startsWith(':'))
  return {
    frameIndex,
    eventName: parsed?.eventName ?? null,
    id: parsed?.id ?? null,
    retry: parsed?.retry ?? null,
    dataLineCount,
    dataCharLength,
    envelopeType: parsed?.ok ? parsed.envelope.envelopeType : null,
    parseStatus: commentOnly
      ? 'ignored_comment'
      : parsed?.ok
        ? 'parsed'
        : parsed?.error.code === 'malformed_stream_json'
          ? 'malformed_json'
          : parsed?.error.code === 'stream_event_name_mismatch'
            ? 'event_name_mismatch'
            : 'malformed_envelope',
  }
}

export function createCouncilSseParser(
  onEvent: (event: CouncilStreamParserEvent) => void,
  options?: { onFrame?: (diagnostic: CouncilStreamFrameDiagnostic) => void },
): {
  push(chunk: string): void
  flush(): void
  reset(): void
} {
  let buffer = ''
  let frameIndex = 0
  function drain(): void {
    let boundary = buffer.search(/\r?\n\r?\n/)
    while (boundary >= 0) {
      const separatorLength = buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + separatorLength)
      const parsed = parseSseFrame(frame)
      frameIndex += 1
      options?.onFrame?.(frameDiagnostic(frame, parsed, frameIndex))
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
      frameIndex += 1
      options?.onFrame?.(frameDiagnostic(buffer, parsed, frameIndex))
      buffer = ''
      if (parsed) onEvent(parsed)
    },
    reset() {
      buffer = ''
      frameIndex = 0
    },
  }
}
