/**
 * Embedding records are derived cache/index data. NOT .hvsproj truth.
 * Local persistent index only. No Supabase. No remote vector DB.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { safeFsId } from './jobs'
import { stripSecrets } from './secrets'
import type { MediaTime } from './time'
import { WAVE9_EMBEDDING_RECOMMENDATION } from './wave9-runtime-audit'

export const EMBEDDING_INDEX_SCHEMA = 1 as const

export type EmbeddingSourceType = 'frame' | 'shot' | 'transcript-segment' | 'object-crop'

export type EmbeddingRecord = {
  assetId: string
  projectId: string
  timestamp: MediaTime | null
  range: { start: MediaTime; end: MediaTime } | null
  modelId: string
  modelVersion: string | null
  dimension: number
  sourceType: EmbeddingSourceType
  indexKey: string
  hash: string
  vectorFile: string
}

export type EmbeddingIndex = {
  schemaVersion: typeof EMBEDDING_INDEX_SCHEMA
  projectId: string
  modelId: string | null
  createdAt: string
  records: EmbeddingRecord[]
}

export function embeddingIndexDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().analysis, safeFsId(projectId, 'project'), '_embeddings')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function embeddingIndexPath(projectId: string): string {
  return path.join(embeddingIndexDir(projectId), 'index.json')
}

export function embeddingVectorPath(projectId: string, indexKey: string): string {
  return path.join(embeddingIndexDir(projectId), `${safeFsId(indexKey, 'emb')}.f32`)
}

export function emptyEmbeddingIndex(projectId: string): EmbeddingIndex {
  return { schemaVersion: EMBEDDING_INDEX_SCHEMA, projectId, modelId: null, createdAt: new Date().toISOString(), records: [] }
}

export function validateEmbeddingIndex(index: EmbeddingIndex): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (index.schemaVersion !== EMBEDDING_INDEX_SCHEMA) errors.push('Unknown embedding index schema.')
  for (const rec of index.records ?? []) {
    if (!rec.assetId || !rec.modelId || !rec.indexKey) errors.push('Embedding record missing identity fields.')
    if (!Number.isFinite(rec.dimension) || rec.dimension <= 0) errors.push('Invalid embedding dimension.')
    if (!rec.hash || !rec.vectorFile) errors.push('Embedding record missing hash/vectorFile.')
  }
  return { ok: errors.length === 0, errors }
}

export function writeEmbeddingIndex(index: EmbeddingIndex): string {
  const clean = stripSecrets(index)
  const check = validateEmbeddingIndex(clean)
  if (!check.ok) throw new Error(check.errors.join('; '))
  const file = embeddingIndexPath(index.projectId)
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return file
}

export async function readEmbeddingIndex(projectId: string): Promise<EmbeddingIndex | null> {
  const file = embeddingIndexPath(projectId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as EmbeddingIndex
  } catch {
    return null
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const den = Math.sqrt(na) * Math.sqrt(nb)
  return den > 0 ? dot / den : 0
}

export function hashVector(vec: Float32Array): string {
  return createHash('sha256').update(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)).digest('hex')
}

export type HybridSearchSource = 'lexical' | 'transcript' | 'object-observation' | 'embedding'

export type HybridSearchHit = {
  assetId: string
  text: string
  timestamp: MediaTime | null
  score: number
  source: HybridSearchSource
  evidence: string
}

export function embeddingsUsableNow(): false {
  void WAVE9_EMBEDDING_RECOMMENDATION
  return false
}

export function deleteEmbeddingIndex(projectId: string): boolean {
  const file = embeddingIndexPath(projectId)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}

export function serializeHugeVectorsIntoHvsprojForbidden(): true {
  return true
}
