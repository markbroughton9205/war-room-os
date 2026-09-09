import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DocumentChunk, StoredEmbedding } from './types'
import { resolveHybridPaths } from './modelStore'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id TEXT PRIMARY KEY,
  document_id INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_ordinal INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  chunking_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, chunking_version, chunk_ordinal)
);

CREATE INDEX IF NOT EXISTS document_chunks_doc_idx ON document_chunks(document_id, content_hash);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  embedding_revision TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  chunking_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(chunk_id) REFERENCES document_chunks(chunk_id)
);

CREATE INDEX IF NOT EXISTS chunk_embeddings_model_idx
  ON chunk_embeddings(embedding_model, embedding_revision, chunking_version);
`

type ChunkRow = {
  chunk_id: string
  document_id: number
  canonical_url: string
  publisher: string
  content_hash: string
  chunk_ordinal: number
  char_start: number
  char_end: number
  text: string
  chunking_version: string
}

type EmbeddingRow = {
  chunk_id: string
  embedding_model: string
  embedding_revision: string
  dimensions: number
  chunking_version: string
  content_hash: string
  embedding: Buffer | Uint8Array
  created_at: string
}

function mapChunk(row: ChunkRow): DocumentChunk {
  return {
    chunkId: row.chunk_id,
    documentId: Number(row.document_id),
    canonicalUrl: row.canonical_url,
    publisher: row.publisher,
    contentHash: row.content_hash,
    chunkOrdinal: Number(row.chunk_ordinal),
    charStart: Number(row.char_start),
    charEnd: Number(row.char_end),
    text: row.text,
    chunkingVersion: row.chunking_version,
  }
}

function blobToVector(blob: Buffer | Uint8Array): Float32Array {
  const copy = blob instanceof Buffer ? new Uint8Array(blob) : new Uint8Array(blob)
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4))
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += a[i]! * b[i]!
  return sum
}

export class SqliteVectorStore {
  readonly dbPath: string
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    this.dbPath = dbPath
    mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
  }

  static openForCorpus(corpusRoot?: string): SqliteVectorStore {
    return new SqliteVectorStore(resolveHybridPaths({ corpusRoot }).vectorDbPath)
  }

  close(): void {
    this.db.close()
  }

  upsertChunks(chunks: DocumentChunk[], createdAt = new Date().toISOString()): void {
    const stmt = this.db.prepare(`
      INSERT INTO document_chunks (
        chunk_id, document_id, canonical_url, publisher, content_hash, chunk_ordinal,
        char_start, char_end, text, chunking_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        canonical_url = excluded.canonical_url,
        publisher = excluded.publisher,
        content_hash = excluded.content_hash,
        text = excluded.text
    `)
    for (const chunk of chunks) {
      stmt.run(
        chunk.chunkId, chunk.documentId, chunk.canonicalUrl, chunk.publisher, chunk.contentHash,
        chunk.chunkOrdinal, chunk.charStart, chunk.charEnd, chunk.text, chunk.chunkingVersion, createdAt,
      )
    }
  }

  getChunk(chunkId: string): DocumentChunk | null {
    const row = this.db.prepare('SELECT * FROM document_chunks WHERE chunk_id = ?').get(chunkId) as ChunkRow | undefined
    return row ? mapChunk(row) : null
  }

  listChunksForDocument(documentId: number, chunkingVersion?: string): DocumentChunk[] {
    const rows = chunkingVersion
      ? this.db.prepare('SELECT * FROM document_chunks WHERE document_id = ? AND chunking_version = ? ORDER BY chunk_ordinal').all(documentId, chunkingVersion) as ChunkRow[]
      : this.db.prepare('SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_ordinal').all(documentId) as ChunkRow[]
    return rows.map(mapChunk)
  }

  getEmbedding(chunkId: string): StoredEmbedding | null {
    const row = this.db.prepare('SELECT * FROM chunk_embeddings WHERE chunk_id = ?').get(chunkId) as EmbeddingRow | undefined
    return row ? mapEmbedding(row) : null
  }

  upsertEmbedding(row: StoredEmbedding): void {
    this.db.prepare(`
      INSERT INTO chunk_embeddings (
        chunk_id, embedding_model, embedding_revision, dimensions, chunking_version,
        content_hash, embedding, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        embedding_model = excluded.embedding_model,
        embedding_revision = excluded.embedding_revision,
        dimensions = excluded.dimensions,
        chunking_version = excluded.chunking_version,
        content_hash = excluded.content_hash,
        embedding = excluded.embedding,
        created_at = excluded.created_at
    `).run(
      row.chunkId, row.embeddingModel, row.embeddingRevision, row.dimensions, row.chunkingVersion,
      row.contentHash, Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength), row.createdAt,
    )
  }

  listFreshEmbeddings(input: {
    embeddingModel: string
    embeddingRevision: string
    chunkingVersion: string
    documentHashes: Map<number, string>
  }): Array<StoredEmbedding & { documentId: number; publisher: string; canonicalUrl: string }> {
    const rows = this.db.prepare(`
      SELECT e.*, c.document_id, c.publisher, c.canonical_url
      FROM chunk_embeddings e
      JOIN document_chunks c ON c.chunk_id = e.chunk_id
      WHERE e.embedding_model = ? AND e.embedding_revision = ? AND e.chunking_version = ?
    `).all(input.embeddingModel, input.embeddingRevision, input.chunkingVersion) as Array<EmbeddingRow & {
      document_id: number
      publisher: string
      canonical_url: string
    }>
    return rows.flatMap(row => {
      const documentId = Number(row.document_id)
      const currentHash = input.documentHashes.get(documentId)
      if (!currentHash || currentHash !== row.content_hash) return []
      return [{
        ...mapEmbedding(row),
        documentId,
        publisher: row.publisher,
        canonicalUrl: row.canonical_url,
      }]
    })
  }

  listStaleEmbeddings(documentHashes: Map<number, string>): StoredEmbedding[] {
    const rows = this.db.prepare(`
      SELECT e.*, c.document_id
      FROM chunk_embeddings e
      JOIN document_chunks c ON c.chunk_id = e.chunk_id
    `).all() as Array<EmbeddingRow & { document_id: number }>
    return rows.flatMap(row => {
      const currentHash = documentHashes.get(Number(row.document_id))
      if (currentHash && currentHash === row.content_hash) return []
      return [mapEmbedding(row)]
    })
  }

  countEmbeddings(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM chunk_embeddings').get() as { n: number | bigint }
    return Number(row.n)
  }
}

function mapEmbedding(row: EmbeddingRow): StoredEmbedding {
  return {
    chunkId: row.chunk_id,
    embeddingModel: row.embedding_model,
    embeddingRevision: row.embedding_revision,
    dimensions: Number(row.dimensions),
    chunkingVersion: row.chunking_version,
    contentHash: row.content_hash,
    vector: blobToVector(row.embedding),
    createdAt: row.created_at,
  }
}

export type VectorHit = {
  chunkId: string
  documentId: number
  canonicalUrl: string
  publisher: string
  score: number
  contentHash: string
}

export function searchVectors(args: {
  query: Float32Array
  embeddings: Array<StoredEmbedding & { documentId: number; publisher: string; canonicalUrl: string }>
  limit: number
}): VectorHit[] {
  return args.embeddings
    .map(row => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      canonicalUrl: row.canonicalUrl,
      publisher: row.publisher,
      contentHash: row.contentHash,
      score: cosineSimilarity(args.query, row.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, args.limit))
}
