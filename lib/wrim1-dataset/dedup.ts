import { normalizeForDedup, sha256 } from './hash'
import type { CorpusSourceInventoryRow } from './types'

export type DedupResult = {
  kept: CorpusSourceInventoryRow[]
  exactDuplicates: { keptSourceId: string; droppedSourceId: string; hash: string }[]
  nearDuplicates: { keptSourceId: string; droppedSourceId: string; normalizedHash: string }[]
}

function shingleFingerprint(text: string): string {
  const normalized = normalizeForDedup(text)
  const shingles: string[] = []
  for (let index = 0; index < normalized.length; index += 24) shingles.push(normalized.slice(index, index + 48))
  return sha256(shingles.slice(0, 32).join('|')).slice(0, 16)
}

export function deduplicateSources(rows: CorpusSourceInventoryRow[], contents: Map<string, string>): DedupResult {
  const exact = new Map<string, CorpusSourceInventoryRow>()
  const normalized = new Map<string, CorpusSourceInventoryRow>()
  const fingerprints = new Map<string, CorpusSourceInventoryRow>()
  const kept: CorpusSourceInventoryRow[] = []
  const exactDuplicates: DedupResult['exactDuplicates'] = []
  const nearDuplicates: DedupResult['nearDuplicates'] = []
  const ordered = [...rows].sort((a, b) => a.path.localeCompare(b.path))
  for (const row of ordered) {
    if (exact.has(row.contentHash)) {
      exactDuplicates.push({ keptSourceId: exact.get(row.contentHash)!.sourceId, droppedSourceId: row.sourceId, hash: row.contentHash })
      continue
    }
    if (normalized.has(row.normalizedHash)) {
      nearDuplicates.push({ keptSourceId: normalized.get(row.normalizedHash)!.sourceId, droppedSourceId: row.sourceId, normalizedHash: row.normalizedHash })
      continue
    }
    const text = contents.get(row.path) ?? ''
    const finger = shingleFingerprint(text)
    if (text.length > 400 && fingerprints.has(finger)) {
      nearDuplicates.push({ keptSourceId: fingerprints.get(finger)!.sourceId, droppedSourceId: row.sourceId, normalizedHash: row.normalizedHash })
      continue
    }
    exact.set(row.contentHash, row)
    normalized.set(row.normalizedHash, row)
    fingerprints.set(finger, row)
    kept.push(row)
  }
  return { kept, exactDuplicates, nearDuplicates }
}
