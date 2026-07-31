function normalizeForDedupe(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function withTerminalPunctuation(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * Trims, de-duplicates (by normalized text), and keeps the top 3 non-empty findings in their
 * original (already-ranked) order.
 */
export function selectSynthesisFindings(findings: readonly string[]): string[] {
  const seen = new Set<string>()
  const selected: string[] = []
  for (const raw of findings) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = normalizeForDedupe(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(trimmed)
    if (selected.length >= 3) break
  }
  return selected
}

/**
 * Builds the compact "latest synthesis" line shown in the live activity feed from up to the top 3
 * ranked findings — instead of discarding every finding except the first. A single finding is
 * returned unchanged; multiple findings are joined into one natural sentence flow, each ended with
 * terminal punctuation. When there are no usable findings this round, the previous synthesis is
 * preserved rather than replaced with nothing.
 */
export function buildLatestSynthesis(
  findings: readonly string[],
  previous: string | null,
): string | null {
  const selected = selectSynthesisFindings(findings)
  if (!selected.length) return previous
  if (selected.length === 1) return selected[0]!
  return selected.map(withTerminalPunctuation).join(' ')
}
