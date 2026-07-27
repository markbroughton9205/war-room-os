/**
 * Decree-relevance gate for prior conversational context fed back into a Council prompt.
 * Without this, Stable Group's "last two family replies" carry forward verbatim regardless of
 * whether the Commander's current decree changed topic — a prior reply about an unrelated old
 * thread (e.g. a dev/platform discussion) can then leak into a family's new response as if it
 * were still on-topic. This is a real, bounded keyword-overlap check, not a full semantic
 * classifier — it errs toward keeping context (false negatives) rather than dropping real
 * continuations (false positives), since silently discarding a genuinely relevant follow-up
 * would itself be a truthfulness regression.
 */

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'into', 'about', 'there', 'their', 'should', 'would',
  'could', 'needs', 'need', 'must', 'have', 'has', 'what', 'when', 'where', 'which', 'while',
  'your', 'you', 'they', 'them', 'here', 'been', 'being', 'were', 'will', 'shall', 'each',
  'more', 'most', 'some', 'than', 'then', 'also', 'just', 'like', 'over', 'such', 'only',
])

/** Explicit "keep going on the same thing" signals — when present, prior context is always kept. */
const CONTINUATION_SIGNALS =
  /\b(continue|keep going|following up|follow[- ]?up|more on that|as (we|i|you) (said|discussed|mentioned)|building on|same (topic|thread|issue|point)|earlier point|what you (just )?said|that (last|previous) (point|reply|answer)|go on|go deeper|expand on)\b/i

function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  return new Set(words)
}

/**
 * True when `candidateText` (a piece of prior conversational context) shares enough grounding
 * with `decreeText` (the current Commander decree) to justify re-injecting it into a new prompt.
 * Permissive by design: short decrees, empty inputs, and explicit continuation language always
 * pass; only a clear, demonstrable topic mismatch on a substantive decree is filtered.
 */
export function isPriorContextDecreeRelevant(decreeText: string, candidateText: string): boolean {
  const decree = decreeText?.trim() ?? ''
  const candidate = candidateText?.trim() ?? ''
  if (!decree || !candidate) return true
  if (CONTINUATION_SIGNALS.test(decree)) return true

  const decreeWords = significantWords(decree)
  if (decreeWords.size <= 3) return true

  const candidateWords = significantWords(candidate)
  if (candidateWords.size === 0) return true

  for (const word of decreeWords) {
    if (candidateWords.has(word)) return true
  }
  return false
}

export type RelevanceFilterable = { content: string }

/** Filters a list of prior replies against the current decree, preserving order. */
export function filterDecreeRelevantPriorReplies<T extends RelevanceFilterable>(
  decreeText: string,
  replies: T[],
): T[] {
  return replies.filter(reply => isPriorContextDecreeRelevant(decreeText, reply.content))
}
