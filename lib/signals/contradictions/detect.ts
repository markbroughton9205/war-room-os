import type { ClassificationInput } from '../classification/types'
import { jaccardSimilarity, tokenizeHeadline } from './similarity'

const OPPOSING_PAIRS: Array<[RegExp, RegExp]> = [
  [/\brise|surge|gain|grow|up\b/i, /\bfall|drop|decline|sink|down\b/i],
  [/\bexpand|increase|boost\b/i, /\bcut|reduce|shrink|layoff\b/i],
  [/\bsafe|stable|recover\b/i, /\bcrisis|collapse|panic|crash\b/i],
  [/\bapprove|pass|deal reached\b/i, /\bblock|reject|fail|collapse\b/i],
]

const CONTRADICTION_WINDOW_MS = 72 * 60 * 60 * 1000

function publishedAtMs(metadata: Record<string, unknown>): number | null {
  const value = metadata.articlePublishedAt ?? metadata.publishedAt
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function hasOpposingNarrative(a: string, b: string): boolean {
  return OPPOSING_PAIRS.some(([positive, negative]) => (
    (positive.test(a) && negative.test(b)) || (negative.test(a) && positive.test(b))
  ))
}

function withinTimeWindow(a: ClassificationInput, b: ClassificationInput): boolean {
  const aMs = publishedAtMs(a.metadata)
  const bMs = publishedAtMs(b.metadata)
  if (aMs === null || bMs === null) return true
  return Math.abs(aMs - bMs) <= CONTRADICTION_WINDOW_MS
}

export function detectContradictionGroups(
  items: ClassificationInput[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  const tokensById = new Map(items.map(item => [item.id, tokenizeHeadline(item.title)]))

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i]!
      const right = items[j]!
      const similarity = jaccardSimilarity(tokensById.get(left.id) ?? [], tokensById.get(right.id) ?? [])
      if (similarity < 0.35) continue
      if (!withinTimeWindow(left, right)) continue
      if (!hasOpposingNarrative(`${left.title} ${left.summary}`, `${right.title} ${right.summary}`)) continue

      const groupId = `contradiction-${[left.id, right.id].sort().join('--')}`
      const peers = groups.get(groupId) ?? []
      if (!peers.includes(left.id)) peers.push(left.id)
      if (!peers.includes(right.id)) peers.push(right.id)
      groups.set(groupId, peers)
    }
  }

  return groups
}
