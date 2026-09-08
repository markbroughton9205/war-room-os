const STOP = new Set([
  'that', 'this', 'with', 'from', 'into', 'about', 'there', 'their', 'should', 'would',
  'could', 'have', 'has', 'what', 'when', 'where', 'which', 'while', 'your', 'you',
  'they', 'them', 'been', 'being', 'were', 'will', 'also', 'just', 'like', 'over',
  'such', 'only', 'council', 'family', 'war', 'room', 'the', 'and', 'for', 'not',
  'does', 'did', 'are', 'was', 'our', 'prior', 'previously', 'compared', 'already',
])

export function tokenizeForRelevance(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !STOP.has(word))
}

export function relevanceScore(query: string, document: string, extras: string[] = []): number {
  const queryTokens = new Set(tokenizeForRelevance(query))
  if (!queryTokens.size) return 0
  const docTokens = new Set([
    ...tokenizeForRelevance(document),
    ...extras.flatMap(tokenizeForRelevance),
  ])
  let hits = 0
  for (const token of queryTokens) {
    if (docTokens.has(token)) hits += 1
  }
  return hits / queryTokens.size
}
