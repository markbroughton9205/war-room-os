/**
 * Truncates `text` to at most `maxLength` characters, preferring the last word boundary
 * (whitespace) before the limit so words are not split mid-token. Falls back to a hard cut at
 * `maxLength` when no whitespace exists reasonably close to the limit, so the result never comes
 * back implausibly short just because the text has one long unbroken run of characters. Appends
 * an ellipsis only when truncation actually occurs; trailing whitespace is trimmed first so the
 * ellipsis never has a space before it.
 */
export function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const slice = text.slice(0, maxLength)
  const lastSpace = slice.lastIndexOf(' ')
  const boundary = lastSpace > maxLength * 0.6 ? lastSpace : maxLength
  return `${slice.slice(0, boundary).trimEnd()}…`
}
