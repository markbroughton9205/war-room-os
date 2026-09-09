import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type { EvidenceDiscoveryProvider } from '@/lib/intelligence/intelligencePacket'
import {
  WAR_ROOM_STORAGE_ORIGIN,
  type CrawlApprovalActor,
  type CrawlDocumentRecord,
  type CrawlEventRecord,
  type CrawlEventState,
  type CrawlStatus,
  type IngestCandidateActor,
  type IngestCandidateEventRecord,
  type IngestCandidateEventType,
  type IngestCandidateRecord,
  type IngestCandidateStatus,
  type RobotsStatus,
} from './types'
import {
  buildLegacyStrictMatch,
  lexicalPlanFromBuilt,
  planLexicalQuery,
  type LocalLexicalPlan,
} from './lexicalPlan'

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

CREATE TABLE IF NOT EXISTS ingest_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  canonical_candidate_url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  publisher TEXT,
  domain TEXT,
  discovered_via TEXT,
  also_discovered_via_json TEXT NOT NULL DEFAULT '[]',
  discovered_at TEXT NOT NULL,
  query_context TEXT,
  status TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  ingest_status TEXT,
  document_id INTEGER,
  council_recommendation TEXT,
  council_recommended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES crawl_documents(id)
);

CREATE INDEX IF NOT EXISTS ingest_candidates_canonical_idx ON ingest_candidates(canonical_candidate_url);
CREATE INDEX IF NOT EXISTS ingest_candidates_status_idx ON ingest_candidates(status);

CREATE TABLE IF NOT EXISTS ingest_candidate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES ingest_candidates(id)
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

type CandidateRow = {
  id: number
  url: string
  canonical_candidate_url: string
  title: string | null
  snippet: string | null
  publisher: string | null
  domain: string | null
  discovered_via: string | null
  also_discovered_via_json: string
  discovered_at: string
  query_context: string | null
  status: string
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  ingest_status: string | null
  document_id: number | null
  council_recommendation: string | null
  council_recommended_at: string | null
  created_at: string
  updated_at: string
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

function mapCandidate(row: CandidateRow): IngestCandidateRecord {
  return {
    id: Number(row.id),
    url: row.url,
    canonicalCandidateUrl: row.canonical_candidate_url,
    title: row.title,
    snippet: row.snippet,
    publisher: row.publisher,
    domain: row.domain,
    discoveredVia: (row.discovered_via as EvidenceDiscoveryProvider | null) ?? null,
    alsoDiscoveredVia: parseAlso(row.also_discovered_via_json),
    discoveredAt: row.discovered_at,
    queryContext: row.query_context,
    status: row.status as IngestCandidateStatus,
    approvedBy: (row.approved_by as CrawlApprovalActor | null) ?? null,
    approvedAt: row.approved_at,
    rejectedBy: (row.rejected_by as CrawlApprovalActor | null) ?? null,
    rejectedAt: row.rejected_at,
    ingestStatus: row.ingest_status,
    documentId: row.document_id == null ? null : Number(row.document_id),
    councilRecommendation: row.council_recommendation,
    councilRecommendedAt: row.council_recommended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  listDocuments(): CrawlDocumentRecord[] {
    const rows = this.db.prepare('SELECT * FROM crawl_documents ORDER BY id').all() as DocumentRow[]
    return rows.map(mapDocument)
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

  searchFtsMatch(match: string, limit = 8): Array<{ documentId: number; snippet: string; rank: number }> {
    const expression = match.trim()
    if (!expression) return []
    try {
      const rows = this.db.prepare(`
        SELECT document_id AS documentId,
               snippet(crawl_fts, 2, '[', ']', '...', 12) AS snippet,
               rank AS rank
        FROM crawl_fts
        WHERE crawl_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(expression, Math.max(1, Math.min(20, limit))) as Array<{ documentId: string; snippet: string; rank: number }>
      const seen = new Set<number>()
      const unique: Array<{ documentId: number; snippet: string; rank: number }> = []
      for (const row of rows) {
        const documentId = Number(row.documentId)
        if (!Number.isFinite(documentId) || seen.has(documentId)) continue
        seen.add(documentId)
        unique.push({
          documentId,
          snippet: String(row.snippet ?? ''),
          rank: typeof row.rank === 'number' ? row.rank : 0,
        })
      }
      return unique
    } catch {
      return []
    }
  }

  searchFtsLegacyStrict(query: string, limit = 8): Array<{ documentId: number; snippet: string; rank: number }> {
    const match = buildLegacyStrictMatch(query)
    return match ? this.searchFtsMatch(match, limit) : []
  }

  searchFtsWithPlan(query: string, limit = 8): {
    rows: Array<{ documentId: number; snippet: string; rank: number }>
    plan: LocalLexicalPlan
  } {
    const built = planLexicalQuery(query)
    if (!built.strictMatch) {
      return { rows: [], plan: lexicalPlanFromBuilt(built, { planUsed: 'NONE' }) }
    }
    const strictStarted = Date.now()
    const strictRows = this.searchFtsMatch(built.strictMatch, limit)
    const strictFtsMs = Date.now() - strictStarted
    if (strictRows.length >= 1) {
      return {
        rows: strictRows,
        plan: lexicalPlanFromBuilt(built, {
          planUsed: 'STRICT',
          relaxationApplied: false,
          strictCandidateCount: strictRows.length,
          relaxedCandidateCount: 0,
          strictFtsMs,
          relaxedFtsMs: 0,
        }),
      }
    }
    if (!built.canRelax || !built.relaxedMatch) {
      return {
        rows: [],
        plan: lexicalPlanFromBuilt(built, {
          planUsed: 'STRICT',
          relaxationApplied: false,
          strictCandidateCount: 0,
          relaxedCandidateCount: 0,
          strictFtsMs,
          relaxedFtsMs: 0,
        }),
      }
    }
    const relaxedStarted = Date.now()
    const relaxedRows = this.searchFtsMatch(built.relaxedMatch, limit)
    const relaxedFtsMs = Date.now() - relaxedStarted
    return {
      rows: relaxedRows,
      plan: lexicalPlanFromBuilt(built, {
        planUsed: 'RELAXED',
        relaxationApplied: true,
        strictCandidateCount: 0,
        relaxedCandidateCount: relaxedRows.length,
        strictFtsMs,
        relaxedFtsMs,
      }),
    }
  }

  searchFts(query: string, limit = 8): Array<{ documentId: number; snippet: string; rank: number }> {
    return this.searchFtsWithPlan(query, limit).rows
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

  getCandidateById(id: number): IngestCandidateRecord | null {
    const row = this.db.prepare('SELECT * FROM ingest_candidates WHERE id = ?').get(id) as CandidateRow | undefined
    return row ? mapCandidate(row) : null
  }

  getCandidateByCanonicalUrl(canonicalUrl: string): IngestCandidateRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM ingest_candidates
      WHERE canonical_candidate_url = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(canonicalUrl) as CandidateRow | undefined
    return row ? mapCandidate(row) : null
  }

  listCandidates(status?: IngestCandidateStatus | null): IngestCandidateRecord[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM ingest_candidates WHERE status = ? ORDER BY id').all(status) as CandidateRow[]
      : this.db.prepare('SELECT * FROM ingest_candidates ORDER BY id').all() as CandidateRow[]
    return rows.map(mapCandidate)
  }

  insertCandidate(input: Omit<IngestCandidateRecord, 'id'>): IngestCandidateRecord {
    const result = this.db.prepare(`
      INSERT INTO ingest_candidates (
        url, canonical_candidate_url, title, snippet, publisher, domain, discovered_via,
        also_discovered_via_json, discovered_at, query_context, status, approved_by, approved_at,
        rejected_by, rejected_at, ingest_status, document_id, council_recommendation,
        council_recommended_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.url, input.canonicalCandidateUrl, input.title, input.snippet, input.publisher, input.domain,
      input.discoveredVia, JSON.stringify(input.alsoDiscoveredVia), input.discoveredAt, input.queryContext,
      input.status, input.approvedBy, input.approvedAt, input.rejectedBy, input.rejectedAt, input.ingestStatus,
      input.documentId, input.councilRecommendation, input.councilRecommendedAt, input.createdAt, input.updatedAt,
    )
    return this.getCandidateById(Number(result.lastInsertRowid))!
  }

  updateCandidate(id: number, patch: Partial<Omit<IngestCandidateRecord, 'id' | 'createdAt'>>): IngestCandidateRecord {
    const current = this.getCandidateById(id)
    if (!current) throw new Error(`Unknown ingest candidate ${id}`)
    const next: IngestCandidateRecord = { ...current, ...patch, id, createdAt: current.createdAt }
    this.db.prepare(`
      UPDATE ingest_candidates SET
        url = ?, canonical_candidate_url = ?, title = ?, snippet = ?, publisher = ?, domain = ?,
        discovered_via = ?, also_discovered_via_json = ?, discovered_at = ?, query_context = ?,
        status = ?, approved_by = ?, approved_at = ?, rejected_by = ?, rejected_at = ?,
        ingest_status = ?, document_id = ?, council_recommendation = ?, council_recommended_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      next.url, next.canonicalCandidateUrl, next.title, next.snippet, next.publisher, next.domain,
      next.discoveredVia, JSON.stringify(next.alsoDiscoveredVia), next.discoveredAt, next.queryContext,
      next.status, next.approvedBy, next.approvedAt, next.rejectedBy, next.rejectedAt, next.ingestStatus,
      next.documentId, next.councilRecommendation, next.councilRecommendedAt, next.updatedAt, id,
    )
    return this.getCandidateById(id)!
  }

  recordCandidateEvent(input: {
    candidateId: number
    eventType: IngestCandidateEventType
    actor?: IngestCandidateActor | null
    detail?: string | null
    createdAt?: string
  }): IngestCandidateEventRecord {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const result = this.db.prepare(`
      INSERT INTO ingest_candidate_events (candidate_id, event_type, actor, detail, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.candidateId, input.eventType, input.actor ?? null, input.detail ?? null, createdAt)
    return {
      id: Number(result.lastInsertRowid),
      candidateId: input.candidateId,
      eventType: input.eventType,
      actor: input.actor ?? null,
      detail: input.detail ?? null,
      createdAt,
    }
  }

  listCandidateEvents(candidateId: number): IngestCandidateEventRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM ingest_candidate_events WHERE candidate_id = ? ORDER BY id
    `).all(candidateId) as Array<{
      id: number
      candidate_id: number
      event_type: string
      actor: string | null
      detail: string | null
      created_at: string
    }>
    return rows.map(row => ({
      id: Number(row.id),
      candidateId: Number(row.candidate_id),
      eventType: row.event_type as IngestCandidateEventType,
      actor: (row.actor as IngestCandidateActor | null) ?? null,
      detail: row.detail,
      createdAt: row.created_at,
    }))
  }
}
