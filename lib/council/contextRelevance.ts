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

/**
 * Bare greeting / test-ping shapes ("hello", "hi council", "quick check in", "status check") —
 * the decree carries no topic of its own beyond a presence check, so it must not inherit
 * unrelated prior-thread context (e.g. a stale Panama/business discussion) just because the
 * short-decree fallback below would otherwise keep everything. Each pattern is anchored to the
 * whole decree so a ping embedded in a longer, substantive message does not match.
 *
 * The optional greeting addressee is deliberately restricted to a small explicit word list
 * (council/team/family/everyone/everybody/all) rather than "any single trailing word" — an
 * unrestricted `\S+` would misclassify substantive short decrees like "hello Panama" or "hey
 * relocation" as bare pings, which is exactly the failure mode this function exists to prevent.
 */
const GREETING_ADDRESSEE = /council|team|family|everyone|everybody|all/.source
const LIGHTWEIGHT_PING_PATTERNS: RegExp[] = [
  new RegExp(
    `^(?:hi+|hello|hey+|yo+|sup|howdy|what'?s\\s+up|good\\s+(?:morning|afternoon|evening))` +
      `(?:[,!\\s]+(?:${GREETING_ADDRESSEE}))?[!?.\\s]*$`,
    'i',
  ),
  /^(?:quick\s+)?(?:check(?:ing)?[\s-]?in|status\s+check|just\s+checking\s+in)[!?.\s]*$/i,
  /^(?:you\s+there|still\s+there|ping|test)[!?.\s]*$/i,
]

/**
 * True when `decreeText` is nothing but a bare greeting/test-ping with no request content of its
 * own. Explicit continuation language always overrides this (a Commander can say "hi, continuing
 * from before" and mean it).
 */
export function isLightweightPingDecree(decreeText: string): boolean {
  const decree = decreeText?.trim() ?? ''
  if (!decree) return false
  if (CONTINUATION_SIGNALS.test(decree)) return false
  return LIGHTWEIGHT_PING_PATTERNS.some(p => p.test(decree))
}

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

  // A bare greeting/test-ping must not inherit unrelated prior context merely because it is
  // short — this check must run before the short-decree fallback below, which exists for
  // genuine short follow-ups ("what about school requirements?") and would otherwise treat a
  // ping identically to a real continuation.
  if (isLightweightPingDecree(decree)) return false

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
