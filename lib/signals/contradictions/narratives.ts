import type { ClassificationInput } from '../classification/types'
import { jaccardSimilarity, narrativeFingerprint, tokenizeHeadline } from './similarity'

const NARRATIVE_SIMILARITY_THRESHOLD = 0.62

export type NarrativeGroup = {
  id: string
  representativeId: string
  memberIds: string[]
}

export function collapseDuplicateNarratives(items: ClassificationInput[]): {
  groups: NarrativeGroup[]
  representativeById: Map<string, string>
  duplicateCountById: Map<string, number>
} {
  const groups: NarrativeGroup[] = []
  const representativeById = new Map<string, string>()
  const duplicateCountById = new Map<string, number>()
  const assigned = new Set<string>()

  for (const item of items) {
    if (assigned.has(item.id)) continue

    const members = [item.id]
    const tokens = tokenizeHeadline(item.title)
    const fingerprint = narrativeFingerprint(item.title)

    for (const other of items) {
      if (other.id === item.id || assigned.has(other.id)) continue
      const otherFingerprint = narrativeFingerprint(other.title)
      const similarity = jaccardSimilarity(tokens, tokenizeHeadline(other.title))
      if (fingerprint === otherFingerprint || similarity >= NARRATIVE_SIMILARITY_THRESHOLD) {
        members.push(other.id)
      }
    }

    const groupId = `narrative-${fingerprint || item.id}`
    const representativeId = item.id
    groups.push({ id: groupId, representativeId, memberIds: members })
    members.forEach(id => {
      assigned.add(id)
      representativeById.set(id, representativeId)
      duplicateCountById.set(id, Math.max(0, members.length - 1))
    })
  }

  return { groups, representativeById, duplicateCountById }
}
