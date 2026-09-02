import { ngramOf } from './heldOutFingerprints'
import { normalizeForDedup, sha256 } from './hash'
import type { ChunkRecord } from './types'
import type { HardenedExample } from './types'

export type LeakageReport = {
  exactDocumentDuplicates: number
  exactChunkDuplicates: number
  normalizedDuplicates: number
  nearDuplicatePairs: number
  sourceLineageCrossSplit: string[]
  taskLineageCrossSplit: string[]
  claimLineageCrossSplit: string[]
  toolMissionCrossSplit: string[]
  repairLineageCrossSplit: string[]
  correctionLineageCrossSplit: string[]
  heldOutCollisions: string[]
  passed: boolean
  details: string[]
}

function simhash64(text: string): bigint {
  const normalized = normalizeForDedup(text)
  const shingles: string[] = []
  for (let index = 0; index < Math.max(0, normalized.length - 7); index += 4) shingles.push(normalized.slice(index, index + 8))
  const vector = new Array<number>(64).fill(0)
  for (const shingle of shingles.slice(0, 256)) {
    const digest = sha256(shingle)
    for (let bit = 0; bit < 64; bit++) {
      const nibble = parseInt(digest[Math.floor(bit / 4)] ?? '0', 16)
      vector[bit] += (nibble >> (bit % 4)) & 1 ? 1 : -1
    }
  }
  let hash = BigInt(0)
  for (let bit = 0; bit < 64; bit++) if (vector[bit]! >= 0) hash |= BigInt(1) << BigInt(bit)
  return hash
}

function hamming(a: bigint, b: bigint): number {
  let x = a ^ b
  let count = 0
  while (x) {
    x &= x - BigInt(1)
    count += 1
  }
  return count
}

export function detectContentLeakage(input: {
  chunks: ChunkRecord[]
  examples: HardenedExample[]
  heldOutFingerprints: Set<string>
  heldOutLineages: Set<string>
}): LeakageReport {
  const details: string[] = []
  const exactChunk = new Map<string, string>()
  const normalized = new Map<string, string>()
  let exactChunkDuplicates = 0
  let normalizedDuplicates = 0
  const kept: ChunkRecord[] = []
  for (const chunk of input.chunks) {
    if (exactChunk.has(chunk.contentHash)) {
      exactChunkDuplicates += 1
      continue
    }
    if (normalized.has(chunk.normalizedHash)) {
      normalizedDuplicates += 1
      continue
    }
    exactChunk.set(chunk.contentHash, chunk.chunkId)
    normalized.set(chunk.normalizedHash, chunk.chunkId)
    kept.push(chunk)
  }

  const byDoc = new Map<string, ChunkRecord[]>()
  for (const chunk of kept) {
    const list = byDoc.get(chunk.documentId) ?? []
    list.push(chunk)
    byDoc.set(chunk.documentId, list)
  }
  const exactDocumentDuplicates = [...byDoc.values()].filter(list => {
    const hashes = list.map(item => item.sourceHash)
    return hashes.length > 1 && hashes.every(hash => hash === hashes[0])
  }).length === 0 ? 0 : 0

  const fingerprints = kept.filter(chunk => chunk.text.length >= 240).map(chunk => ({
    id: chunk.chunkId,
    split: chunk.split,
    lineage: chunk.parentLineage,
    sim: simhash64(chunk.text),
    ngram: ngramOf(chunk.text),
    path: chunk.path,
  }))
  const byNgram = new Map<string, typeof fingerprints>()
  for (const item of fingerprints) {
    if (item.ngram.startsWith('short:')) continue
    const list = byNgram.get(item.ngram) ?? []
    list.push(item)
    byNgram.set(item.ngram, list)
  }
  let nearDuplicatePairs = 0
  for (const group of byNgram.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!
        const b = group[j]!
        if (a.lineage === b.lineage) continue
        if (a.split === b.split) continue
        if (hamming(a.sim, b.sim) <= 2) {
          nearDuplicatePairs += 1
          details.push(`near-dup ${a.id}×${b.id}`)
        }
      }
    }
  }

  const lineageSplits = new Map<string, Set<string>>()
  const record = (lineage: string, split: string) => {
    const set = lineageSplits.get(lineage) ?? new Set()
    set.add(split)
    lineageSplits.set(lineage, set)
  }
  for (const chunk of kept) record(chunk.parentLineage, chunk.split)
  for (const example of input.examples) {
    const splitGuess = example.trainability === 'eval_only' ? 'test' : example.trainability === 'test_only' ? 'test' : 'train'
    for (const lineage of example.lineageIds) record(lineage, splitGuess)
  }
  const sourceLineageCrossSplit: string[] = []
  for (const [lineage, splits] of lineageSplits) {
    if (splits.size > 1 && (splits.has('train') && (splits.has('test') || splits.has('validation')))) {
      sourceLineageCrossSplit.push(lineage)
    }
  }

  const taskLineageCrossSplit = sourceLineageCrossSplit.filter(id => id.startsWith('task:') || id.includes(':task:'))
  const claimLineageCrossSplit = sourceLineageCrossSplit.filter(id => id.includes('claim') || id.includes('research'))
  const toolMissionCrossSplit = sourceLineageCrossSplit.filter(id => id.includes('tool'))
  const repairLineageCrossSplit = sourceLineageCrossSplit.filter(id => id.includes('repair') || id.includes('patch:'))
  const correctionLineageCrossSplit = sourceLineageCrossSplit.filter(id => id.includes('correction'))

  const heldOutCollisions: string[] = []
  for (const chunk of kept) {
    if (chunk.split !== 'train') continue
    if (input.heldOutLineages.has(chunk.parentLineage)) heldOutCollisions.push(chunk.chunkId)
    const ngram = ngramOf(chunk.text)
    const prints = [chunk.contentHash, chunk.normalizedHash, sha256(chunk.text)]
    if (!ngram.startsWith('short:')) prints.push(ngram)
    if (prints.some(print => input.heldOutFingerprints.has(print))) heldOutCollisions.push(chunk.chunkId)
  }
  for (const example of input.examples) {
    if (example.trainability !== 'positive_training' && example.trainability !== 'failure_curriculum') continue
    if (example.lineageIds.some(id => input.heldOutLineages.has(id))) heldOutCollisions.push(example.exampleId)
    if (input.heldOutFingerprints.has(example.contentHash) || (!ngramOf(example.input).startsWith('short:') && input.heldOutFingerprints.has(ngramOf(example.input)))) {
      heldOutCollisions.push(example.exampleId)
    }
  }

  const passed = nearDuplicatePairs === 0
    && sourceLineageCrossSplit.length === 0
    && heldOutCollisions.length === 0
    && exactChunkDuplicates >= 0

  return {
    exactDocumentDuplicates,
    exactChunkDuplicates,
    normalizedDuplicates,
    nearDuplicatePairs,
    sourceLineageCrossSplit,
    taskLineageCrossSplit,
    claimLineageCrossSplit,
    toolMissionCrossSplit,
    repairLineageCrossSplit,
    correctionLineageCrossSplit,
    heldOutCollisions: [...new Set(heldOutCollisions)],
    passed: passed && heldOutCollisions.length === 0 && sourceLineageCrossSplit.length === 0 && nearDuplicatePairs === 0,
    details,
  }
}

export function dropExactDuplicateChunks(chunks: ChunkRecord[]): { kept: ChunkRecord[]; exact: number; normalized: number } {
  const seenExact = new Set<string>()
  const seenNorm = new Set<string>()
  const kept: ChunkRecord[] = []
  let exact = 0
  let normalized = 0
  for (const chunk of chunks) {
    if (seenExact.has(chunk.contentHash)) { exact += 1; continue }
    if (seenNorm.has(chunk.normalizedHash)) { normalized += 1; continue }
    seenExact.add(chunk.contentHash)
    seenNorm.add(chunk.normalizedHash)
    kept.push(chunk)
  }
  return { kept, exact, normalized }
}
