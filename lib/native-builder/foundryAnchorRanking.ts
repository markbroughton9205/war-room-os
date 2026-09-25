/**
 * Semantic ranking of unique edit anchors. Uniqueness is required for safety.
 * It is not evidence that a region is the requested target.
 */
import { extractProtectedBindings } from './foundryProtectedBindings'

export type AnchorRelevance = 'HIGH' | 'MEDIUM' | 'LOW'

export type AnchorScore = {
  score: number
  relevance: AnchorRelevance
  matchedGoalTerms: string[]
  bindings: string[]
  reason: string
  symbol: string | null
  goalMatch: string
}

const TYPE_HEADER = /^\s*(export\s+)?(type|interface|enum)\s/
const TYPE_PROPERTY = /^\s+[A-Za-z_]\w*\??:\s/
const JSXISH = /<[A-Za-z]|className=|data-testid=/
const TESTID = /data-testid=["']([^"']+)["']/g

export function collectGoalTerms(goal: string): string[] {
  const titled = goal.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/g) ?? []
  const caps = goal.match(/[A-Z]{2,}(?:\s+[A-Z]{2,}){0,3}/g) ?? []
  const snake = goal.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []
  const selected = goal.match(/\bselected\.[A-Za-z_]\w*/g) ?? []
  const camel = goal.match(/\b[a-z][A-Za-z0-9]{7,}\b/g) ?? []
  const testids = [...goal.matchAll(/data-testid=["']([^"']+)["']/g)].map(match => match[1])
  const quoted = [...goal.matchAll(/["']([^"']{8,80})["']/g)].map(match => match[1])
  const hyphen = goal.match(/\b[a-z0-9]+(?:-[a-z0-9]+){1,}\b/g) ?? []
  return [...new Set([
    ...snake,
    ...titled,
    ...caps,
    ...selected,
    ...camel,
    ...testids,
    ...quoted,
    ...hyphen,
  ].map(item => item.trim()).filter(item => item.length >= 6))]
}

export function scoreAnchorText(text: string, goal: string): AnchorScore {
  const bindings = extractProtectedBindings(text)
  const terms = collectGoalTerms(goal)
  const lower = text.toLowerCase()
  const matchedGoalTerms: string[] = []
  let score = 0
  for (const term of terms) {
    if (term.length >= 6 && lower.includes(term.toLowerCase())) {
      score += Math.min(36, 8 + term.length)
      matchedGoalTerms.push(term)
    }
  }
  const requiredFromGoal = [...goal.matchAll(/\bselected\.[A-Za-z_]\w*/g)].map(match => match[0])
  const bindingHits = requiredFromGoal.filter(item => text.includes(item))
  score += bindingHits.length * 40
  if (requiredFromGoal.length && bindingHits.length === requiredFromGoal.length) score += 20
  if (requiredFromGoal.length && bindingHits.length === 0) score -= 25
  const testids = [...text.matchAll(TESTID)].map(match => match[1])
  for (const id of testids) {
    if (goal.toLowerCase().includes(id.toLowerCase()) || terms.some(term => id.toLowerCase().includes(term.toLowerCase().replace(/\s+/g, '-')))) {
      score += 45
      if (!matchedGoalTerms.includes(id)) matchedGoalTerms.push(id)
    } else if (/review|status|detail/i.test(id) && /review|status|detail/i.test(goal)) {
      score += 20
    }
  }
  const symbol = text.match(/\b(export\s+)?(function|type|interface|const)\s+([A-Z][A-Za-z0-9]+)/)?.[3]
    ?? text.match(/<([A-Z][A-Za-z0-9.]*)\b/)?.[1]
    ?? null
  if (symbol && goal.includes(symbol)) score += 15
  if ((TYPE_HEADER.test(text) || TYPE_PROPERTY.test(text.split('\n')[0] ?? '')) && !JSXISH.test(text)) score -= 45
  if (JSXISH.test(text) && /review|status|detail|label|chip/i.test(goal)) score += 10
  if (bindings.length && JSXISH.test(text) && /review|status|detail|chip|label|render/i.test(goal)) score += 30
  const relevance: AnchorRelevance = score >= 40 ? 'HIGH' : score >= 12 ? 'MEDIUM' : 'LOW'
  const goalMatch = matchedGoalTerms[0] ?? (bindingHits[0] ?? 'none')
  const reason = relevance === 'HIGH'
    ? `goal/bindings/testid overlap (${matchedGoalTerms.slice(0, 4).join(', ') || bindingHits.join(', ')})`
    : relevance === 'MEDIUM'
      ? 'partial goal overlap'
      : (TYPE_HEADER.test(text) || TYPE_PROPERTY.test(text.split('\n')[0] ?? '')) && !JSXISH.test(text)
        ? 'header/type region without requested UI semantics'
        : 'no requested goal terms or required bindings'
  return { score, relevance, matchedGoalTerms, bindings, reason, symbol, goalMatch }
}

export function compareAnchorScores(a: AnchorScore & { startLine?: number }, b: AnchorScore & { startLine?: number }): number {
  if (b.score !== a.score) return b.score - a.score
  if (b.bindings.length !== a.bindings.length) return b.bindings.length - a.bindings.length
  return 0
}

export function formatAnchorCandidates(rows: Array<{
  anchorId: string
  startLine: number
  endLine: number
  score: AnchorScore
}>): string {
  if (!rows.length) return ''
  return [
    'ANCHOR_CANDIDATES:',
    ...rows.slice(0, 6).map(row => [
      row.anchorId,
      `lines ${row.startLine}-${row.endLine}`,
      `goalMatch = ${row.score.goalMatch}`,
      `bindings =${row.score.bindings.length ? `\n${row.score.bindings.map(item => `  ${item}`).join('\n')}` : ' none'}`,
      `relevance = ${row.score.relevance}`,
      `reason = ${row.score.reason}`,
    ].join('\n')),
    'Prefer HIGH-relevance unique anchors. Unique match is not proof of the correct target.',
  ].join('\n')
}
