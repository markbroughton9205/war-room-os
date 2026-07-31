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

/**
 * Retries `invoke` exactly once, and only when it fails with ClaudeEmptyContentError.
 * Any other error (timeout/abort, HTTP/auth failure, malformed request, etc.) propagates
 * immediately with no retry. Used for both the `claude` and `red_team` council families,
 * since both call callClaude() under the hood.
 */
export async function callClaudeFamilyWithEmptyContentRetry(invoke: () => Promise<string>): Promise<string> {
  try {
    return await invoke()
  } catch (err) {
    if (!(err instanceof ClaudeEmptyContentError)) throw err
  }
  return invoke()
}
