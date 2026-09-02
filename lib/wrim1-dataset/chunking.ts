import { normalizeForDedup, sha256 } from './hash'
import type { ChunkRecord, CorpusSourceInventoryRow, ExampleFormat, QualityTier } from './types'

export const CHUNK_CHARS = 1400

export function sourceLineageForPath(path: string): string {
  if (path.includes('raw_intake/alice')) return 'lineage:heldout:language:alice'
  const parts = path.split('/')
  if (parts[0] === 'docs') return 'lineage:docs'
  if (parts[0] === 'supabase') return 'lineage:supabase'
  if (parts[0] === 'scripts') return 'lineage:scripts'
  if (parts[0] === 'lib' || parts[0] === 'app' || parts[0] === 'components') return `lineage:${parts.slice(0, 2).join('/')}`
  if (path.startsWith('model-lab/raw_intake/')) return `lineage:raw_intake:${parts.at(-1) ?? path}`
  return `lineage:${parts.slice(0, Math.min(2, parts.length)).join('/')}`
}

function splitWindows(text: string): { start: number; end: number; slice: string }[] {
  if (text.length <= CHUNK_CHARS) return [{ start: 0, end: text.length, slice: text }]
  const windows: { start: number; end: number; slice: string }[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS)
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n', end)
      if (breakAt > start + Math.floor(CHUNK_CHARS * 0.5)) end = breakAt + 1
    }
    windows.push({ start, end, slice: text.slice(start, end) })
    start = end
  }
  return windows
}

export function chunkDocument(input: {
  documentId: string
  source: CorpusSourceInventoryRow
  text: string
  parentLineage: string
  split: ChunkRecord['split']
  qualityTier: QualityTier
  capabilityTags: string[]
  format: ExampleFormat
}): ChunkRecord[] {
  return splitWindows(input.text).map((window, index) => {
    const contentHash = sha256(window.slice)
    return {
      chunkId: `w81chk_${contentHash.slice(0, 20)}_${index}`,
      documentId: input.documentId,
      sourceId: input.source.sourceId,
      sourceHash: input.source.contentHash,
      parentLineage: input.parentLineage,
      path: input.source.path,
      offsetStart: window.start,
      offsetEnd: window.end,
      text: window.slice,
      contentHash,
      normalizedHash: sha256(normalizeForDedup(window.slice)),
      capabilityTags: input.capabilityTags,
      format: input.format,
      qualityTier: input.qualityTier,
      split: input.split,
      byteLength: Buffer.byteLength(window.slice, 'utf8'),
      tokenizerTokens: null,
    }
  })
}
