/**
 * Command framing that carries no topical content of its own -- stripped from the front of the
 * Commander's message before word extraction so the generated title leads with the actual subject
 * ("Freight Brokerage Platforms") instead of the verb wrapper ("Research The Competitive...").
 */
const LEADING_COMMAND_PREFIX =
  /^(council,?\s+)?(please\s+)?(can|could|would)\s+you\s+|^(please\s+)?(council,?\s+)?(give|tell|show)\s+me\s+(a\s+|an\s+|the\s+)?|^(please\s+)?(research|investigate|check|verify|confirm|analyze|analyse|summarize|summarise|explain|restart|repair|fix|deploy|enable|disable|look\s+into|find\s+out|help\s+me\s+understand)\s+(the\s+|a\s+|an\s+)?/i

/** Low-content words dropped from the remaining text before titling -- filler, not topic. */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'is', 'are', 'and', 'or', 'me', 'us', 'we',
  'please', 'verify', 'check', 'confirm', 'give', 'tell', 'help', 'understand', 'explain', 'that',
  'this', 'your', 'our', 'take', 'time', 'use',
])

/**
 * Neutral session titles from the first Commander turn. Never infers decisions or opportunities --
 * this is a heuristic keyword-extraction pass over the Commander's own words, not an LLM summary.
 */
export function generateNeutralSessionTitle(commanderText: string): string {
  const t = commanderText.replace(/\s+/g, ' ').trim()
  if (!t) return 'New Council Session'
  const lower = t.toLowerCase()
  if (/\bworld\b/.test(lower) && /\b(going on|happening|news|brief|events?)\b/.test(lower)) {
    return 'World Events Brief'
  }
  if (/\blive earth\b|\bearth\b.*\b(globe|terra)\b/.test(lower)) {
    return 'Live Earth Discussion'
  }
  if (/\bpanama\b/.test(lower) && /\b(relocat|move|plan|visa)\b/.test(lower)) {
    return 'Panama Relocation Discussion'
  }
  const withoutPrefix = t.replace(LEADING_COMMAND_PREFIX, '')
  const source = withoutPrefix.trim() || t
  const words = source
    .replace(/[^\w\s']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !TITLE_STOPWORDS.has(w.toLowerCase()))
    .slice(0, 6)
  if (!words.length) return 'Council Discussion'
  const titled = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  return titled.length > 48 ? `${titled.slice(0, 45)}…` : titled
}

export function shouldAutoTitle(currentTitle: string | null | undefined, titleLocked: boolean | undefined): boolean {
  if (titleLocked) return false
  const t = (currentTitle ?? '').trim()
  return !t || t === 'Live Council' || t === 'Untitled thread' || t === 'New Council Session' || t === 'LEGACY COUNCIL SESSION'
}
