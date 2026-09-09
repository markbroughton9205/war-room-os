import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'
import {
  WAR_ROOM_STORAGE_ORIGIN,
  type CrawlDocumentRecord,
  type CrawlEventRecord,
  type CrawlEventState,
  type CrawlStatus,
  type RobotsStatus,
} from './types'

export const DEFAULT_CORPUS_RELATIVE = ['.war-room', 'sovereign-search'] as const

export type CorpusPaths = {
  rootDir: string
  dbPath: string
  documentsDir: string
}

export function resolveCorpusPaths(rootDir?: string): CorpusPaths {
  const override = rootDir?.trim() || process.env.WAR_ROOM_SOVEREIGN_SEARCH_DIR?.trim()
  const resolved = override
    ? (path.isAbsolute(override) ? override : path.resolve(resolveBaseRepoRoot(), override))
    : path.join(resolveBaseRepoRoot(), ...DEFAULT_CORPUS_RELATIVE)
  return {
    rootDir: resolved,
    dbPath: path.join(resolved, 'corpus.sqlite'),
    documentsDir: path.join(resolved, 'documents'),
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS crawl_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  publisher TEXT NOT NULL,
  title TEXT,
  description TEXT,
  language TEXT,
  published_at TEXT,
  author TEXT,
  first_seen_at TEXT NOT NULL,
  last_crawled_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_text TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  robots_status TEXT NOT NULL,
  crawl_status TEXT NOT NULL,
  source_origin TEXT NOT NULL,
  discovered_via TEXT,
  also_discovered_via_json TEXT NOT NULL DEFAULT '[]',
  bytes_received INTEGER NOT NULL DEFAULT 0,
  document_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS crawl_documents_hash_idx ON crawl_documents(content_hash);
CREATE INDEX IF NOT EXISTS crawl_documents_domain_idx ON crawl_documents(domain);

CREATE TABLE IF NOT EXISTS crawl_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER,
  state TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  http_status INTEGER,
  bytes_received INTEGER,
  content_type TEXT,
  content_hash TEXT,
  robots_status TEXT,
  error_category TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES crawl_documents(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS crawl_fts USING fts5(
  title,
  description,
  content_text,
  document_id UNINDEXED
);
`

type DocumentRow = {
  id: number
  original_url: string
  final_url: string
  canonical_url: string
  domain: string
  publisher: string
  title: string | null
  description: string | null
  language: string | null
  published_at: string | null
  author: string | null
  first_seen_at: string
  last_crawled_at: string
  content_hash: string
  content_text: string
  http_status: number
  content_type: string
  robots_status: string
  crawl_status: string
  source_origin: string
  discovered_via: string | null
  also_discovered_via_json: string
  bytes_received: number
  document_path: string | null
}

function parseAlso(raw: string | null | undefined): EvidenceDiscoveryProvider[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is EvidenceDiscoveryProvider => typeof item === 'string')
  } catch {
    return []
  }
}

function mapDocument(row: DocumentRow): CrawlDocumentRecord {
  return {
    id: Number(row.id),
    originalUrl: row.original_url,
    finalUrl: row.final_url,
    canonicalUrl: row.canonical_url,
    domain: row.domain,
    publisher: row.publisher,
    title: row.title,
    description: row.description,
    language: row.language,
    publishedAt: row.published_at,
    author: row.author,
    firstSeenAt: row.first_seen_at,
    lastCrawledAt: row.last_crawled_at,
    contentHash: row.content_hash,
    contentText: row.content_text,
    httpStatus: Number(row.http_status),
    contentType: row.content_type,
    robotsStatus: row.robots_status as RobotsStatus,
    crawlStatus: row.crawl_status as CrawlStatus,
    sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
    discoveredVia: (row.discovered_via as EvidenceDiscoveryProvider | null) ?? null,
    alsoDiscoveredVia: parseAlso(row.also_discovered_via_json),
    bytesReceived: Number(row.bytes_received),
    documentPath: row.document_path,
  }
}

export class SovereignCorpus {
  readonly paths: CorpusPaths
  private readonly db: DatabaseSync

  constructor(rootDir?: string) {
    this.paths = resolveCorpusPaths(rootDir)
    mkdirSync(this.paths.documentsDir, { recursive: true })
    this.db = new DatabaseSync(this.paths.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back or not in a transaction */
      }
      throw error
    }
  }

  getByCanonicalUrl(canonicalUrl: string): CrawlDocumentRecord | null {
    const row = this.db.prepare('SELECT * FROM crawl_documents WHERE canonical_url = ?').get(canonicalUrl) as DocumentRow | undefined
    return row ? mapDocument(row) : null
  }

  getById(id: number): CrawlDocumentRecord | null {
    const row = this.db.prepare('SELECT * FROM crawl_documents WHERE id = ?').get(id) as DocumentRow | undefined
    return row ? mapDocument(row) : null
  }

  findByContentHash(contentHash: string, exceptCanonicalUrl?: string): CrawlDocumentRecord | null {
    const row = exceptCanonicalUrl
      ? this.db.prepare('SELECT * FROM crawl_documents WHERE content_hash = ? AND canonical_url != ? LIMIT 1').get(contentHash, exceptCanonicalUrl) as DocumentRow | undefined
      : this.db.prepare('SELECT * FROM crawl_documents WHERE content_hash = ? LIMIT 1').get(contentHash) as DocumentRow | undefined
    return row ? mapDocument(row) : null
  }

  countDocuments(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM crawl_documents').get() as { n: number | bigint }
    return Number(row.n)
  }

  upsertDocument(input: Omit<CrawlDocumentRecord, 'id' | 'firstSeenAt' | 'documentPath'> & { firstSeenAt?: string }): CrawlDocumentRecord {
    const now = input.lastCrawledAt
    const existing = this.getByCanonicalUrl(input.canonicalUrl)
    const firstSeenAt = existing?.firstSeenAt ?? input.firstSeenAt ?? now
    const also = JSON.stringify(input.alsoDiscoveredVia)
    if (existing) {
      this.db.prepare(`
        UPDATE crawl_documents SET
          original_url = ?, final_url = ?, domain = ?, publisher = ?, title = ?, description = ?,
          language = ?, published_at = ?, author = ?, last_crawled_at = ?, content_hash = ?, content_text = ?,
          http_status = ?, content_type = ?, robots_status = ?, crawl_status = ?, discovered_via = ?,
          also_discovered_via_json = ?, bytes_received = ?
        WHERE id = ?
      `).run(
        input.originalUrl, input.finalUrl, input.domain, input.publisher, input.title, input.description,
        input.language, input.publishedAt, input.author, now, input.contentHash, input.contentText,
        input.httpStatus, input.contentType, input.robotsStatus, input.crawlStatus, input.discoveredVia,
        also, input.bytesReceived, existing.id,
      )
      this.db.prepare('DELETE FROM crawl_fts WHERE document_id = ?').run(String(existing.id))
      this.indexFts(existing.id, input.title, input.description, input.contentText)
      const documentPath = this.writeDocumentFile(existing.id, { ...input, firstSeenAt, id: existing.id, documentPath: existing.documentPath })
      this.db.prepare('UPDATE crawl_documents SET document_path = ? WHERE id = ?').run(documentPath, existing.id)
      return this.getById(existing.id)!
    }

    const result = this.db.prepare(`
      INSERT INTO crawl_documents (
        original_url, final_url, canonical_url, domain, publisher, title, description, language,
        published_at, author, first_seen_at, last_crawled_at, content_hash, content_text, http_status,
        content_type, robots_status, crawl_status, source_origin, discovered_via, also_discovered_via_json,
        bytes_received
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.originalUrl, input.finalUrl, input.canonicalUrl, input.domain, input.publisher, input.title,
      input.description, input.language, input.publishedAt, input.author, firstSeenAt, now, input.contentHash,
      input.contentText, input.httpStatus, input.contentType, input.robotsStatus, input.crawlStatus,
      WAR_ROOM_STORAGE_ORIGIN, input.discoveredVia, also, input.bytesReceived,
    )
    const id = Number(result.lastInsertRowid)
    this.indexFts(id, input.title, input.description, input.contentText)
    const documentPath = this.writeDocumentFile(id, { ...input, firstSeenAt, id, documentPath: null })
    this.db.prepare('UPDATE crawl_documents SET document_path = ? WHERE id = ?').run(documentPath, id)
    return this.getById(id)!
  }

  recordEvent(input: {
    documentId?: number | null
    state: CrawlEventState
    url: string
    canonicalUrl?: string | null
    httpStatus?: number | null
    bytesReceived?: number | null
    contentType?: string | null
    contentHash?: string | null
    robotsStatus?: RobotsStatus | null
    errorCategory?: string | null
    durationMs: number
  }): CrawlEventRecord {
    const createdAt = new Date().toISOString()
    const result = this.db.prepare(`
      INSERT INTO crawl_events (
        document_id, state, url, canonical_url, http_status, bytes_received, content_type,
        content_hash, robots_status, error_category, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.documentId ?? null, input.state, input.url, input.canonicalUrl ?? null, input.httpStatus ?? null,
      input.bytesReceived ?? null, input.contentType ?? null, input.contentHash ?? null,
      input.robotsStatus ?? null, input.errorCategory ?? null, input.durationMs, createdAt,
    )
    return {
      id: Number(result.lastInsertRowid),
      documentId: input.documentId ?? null,
      state: input.state,
      url: input.url,
      canonicalUrl: input.canonicalUrl ?? null,
      httpStatus: input.httpStatus ?? null,
      bytesReceived: input.bytesReceived ?? null,
      contentType: input.contentType ?? null,
      contentHash: input.contentHash ?? null,
      robotsStatus: input.robotsStatus ?? null,
      errorCategory: input.errorCategory ?? null,
      durationMs: input.durationMs,
      createdAt,
    }
  }

  searchFts(query: string, limit = 8): Array<{ documentId: number; snippet: string; rank: number }> {
    const trimmed = query.trim().replace(/["']/g, ' ').replace(/\s+/g, ' ')
    if (!trimmed) return []
    const tokens = trimmed.split(' ').filter(token => token.length > 1).slice(0, 8)
    if (!tokens.length) return []
    const match = tokens.map(token => `"${token.replace(/"/g, '')}"`).join(' AND ')
    const rows = this.db.prepare(`
      SELECT document_id AS documentId,
             snippet(crawl_fts, 2, '[', ']', '...', 12) AS snippet,
             rank AS rank
      FROM crawl_fts
      WHERE crawl_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, Math.max(1, Math.min(20, limit))) as Array<{ documentId: string; snippet: string; rank: number }>
    return rows.map(row => ({
      documentId: Number(row.documentId),
      snippet: String(row.snippet ?? ''),
      rank: typeof row.rank === 'number' ? row.rank : 0,
    }))
  }

  private indexFts(id: number, title: string | null, description: string | null, contentText: string): void {
    this.db.prepare('INSERT INTO crawl_fts (title, description, content_text, document_id) VALUES (?, ?, ?, ?)').run(
      title ?? '',
      description ?? '',
      contentText,
      String(id),
    )
  }

  private writeDocumentFile(id: number, record: CrawlDocumentRecord): string {
    const filePath = path.join(this.paths.documentsDir, `${id}.json`)
    writeFileSync(filePath, JSON.stringify({
      id,
      originalUrl: record.originalUrl,
      finalUrl: record.finalUrl,
      canonicalUrl: record.canonicalUrl,
      domain: record.domain,
      publisher: record.publisher,
      title: record.title,
      description: record.description,
      language: record.language,
      publishedAt: record.publishedAt,
      author: record.author,
      firstSeenAt: record.firstSeenAt,
      lastCrawledAt: record.lastCrawledAt,
      contentHash: record.contentHash,
      httpStatus: record.httpStatus,
      contentType: record.contentType,
      robotsStatus: record.robotsStatus,
      crawlStatus: record.crawlStatus,
      sourceOrigin: WAR_ROOM_STORAGE_ORIGIN,
      discoveredVia: record.discoveredVia,
      alsoDiscoveredVia: record.alsoDiscoveredVia,
      contentText: record.contentText,
    }, null, 2), 'utf8')
    return filePath
  }
}
