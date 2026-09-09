import { RRF_K } from './types'

export type RankedId = {
  id: string
  rank: number
}

export type FusedId = {
  id: string
  fusionScore: number
  ranks: Record<string, number | null>
}

export function reciprocalRankFusion(
  lists: Record<string, RankedId[]>,
  k = RRF_K,
): FusedId[] {
  const scores = new Map<string, FusedId>()
  for (const [listName, ranked] of Object.entries(lists)) {
    for (const item of ranked) {
      if (!item.id || item.rank < 1) continue
      const current = scores.get(item.id) ?? { id: item.id, fusionScore: 0, ranks: {} }
      current.fusionScore += 1 / (k + item.rank)
      current.ranks[listName] = item.rank
      scores.set(item.id, current)
    }
  }
  return [...scores.values()].sort((a, b) => {
    if (b.fusionScore !== a.fusionScore) return b.fusionScore - a.fusionScore
    return a.id.localeCompare(b.id)
  })
}
