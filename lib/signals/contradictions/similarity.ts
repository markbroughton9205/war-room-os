const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'not', 'no', 'yes', 'it',
  'its', 'this', 'that', 'these', 'those', 'says', 'said', 'after', 'over', 'under', 'into', 'about',
])

export function tokenizeHeadline(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection += 1
  }
  const union = new Set([...setA, ...setB]).size
  return union ? intersection / union : 0
}

export function narrativeFingerprint(title: string): string {
  return tokenizeHeadline(title).slice(0, 8).sort().join('|')
}
