/**
 * Thrown by callClaude() specifically when the Anthropic response parsed successfully
 * but yielded no usable text. Kept distinct from generic Error so callers can retry this
 * exact failure mode without matching on message text.
 */
export class ClaudeEmptyContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeEmptyContentError'
  }
}

type ClaudeContentBlock = { type?: unknown; text?: unknown }

/**
 * Extracts usable text from an Anthropic `messages` response's `content` array.
 * Concatenates every block where `type === 'text'` (in order) and ignores
 * non-text blocks (e.g. `tool_use`, `thinking`) instead of assuming `content[0]` is text.
 */
export function extractClaudeResponseText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const textParts: string[] = []
  for (const block of content as ClaudeContentBlock[]) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
    }
  }
  return textParts.join('')
}

/** Shape-only diagnostics for an Anthropic `content` array — counts, never text. Safe to log. */
export type ClaudeResponseDiagnostics = {
  totalBlockCount: number
  textBlockCount: number
}

export function extractClaudeResponseDiagnostics(content: unknown): ClaudeResponseDiagnostics {
  if (!Array.isArray(content)) return { totalBlockCount: 0, textBlockCount: 0 }
  let textBlockCount = 0
  for (const block of content as ClaudeContentBlock[]) {
    if (block && typeof block === 'object' && block.type === 'text') textBlockCount += 1
  }
  return { totalBlockCount: content.length, textBlockCount }
}

/** Content-free attempt outcome — safe to log; never carries provider text. */
export type ClaudeRetryAttemptOutcome = 'success' | 'empty_content' | 'other_error'

export type ClaudeRetryAttemptInfo = {
  attempt: 1 | 2
  outcome: ClaudeRetryAttemptOutcome
}

/**
 * Retries `invoke` exactly once, and only when it fails with ClaudeEmptyContentError.
 * Any other error (timeout/abort, HTTP/auth failure, malformed request, etc.) propagates
 * immediately with no retry. Used for both the `claude` and `red_team` council families,
 * since both call callClaude() under the hood.
 *
 * `onAttempt` (optional) is a content-free observer for telemetry — it only ever receives
 * the attempt number and a coarse outcome category, never provider text or prompts. Callers
 * decide what (if anything) to do with it; this helper stays pure and provider-agnostic.
 */
export async function callClaudeFamilyWithEmptyContentRetry(
  invoke: () => Promise<string>,
  onAttempt?: (info: ClaudeRetryAttemptInfo) => void,
): Promise<string> {
  try {
    const result = await invoke()
    onAttempt?.({ attempt: 1, outcome: 'success' })
    return result
  } catch (err) {
    if (!(err instanceof ClaudeEmptyContentError)) {
      onAttempt?.({ attempt: 1, outcome: 'other_error' })
      throw err
    }
    onAttempt?.({ attempt: 1, outcome: 'empty_content' })
  }
  try {
    const result = await invoke()
    onAttempt?.({ attempt: 2, outcome: 'success' })
    return result
  } catch (err) {
    onAttempt?.({ attempt: 2, outcome: err instanceof ClaudeEmptyContentError ? 'empty_content' : 'other_error' })
    throw err
  }
}
