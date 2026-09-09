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
  type RecrawlOutcome,
  type RecrawlRunRecord,
  type RobotsStatus,
  type SourceAvailability,
  type DocumentLifecycleMeta,
  type DocumentVersionRecord,
  type MaintenanceLockRecord,
  type MaintenanceLockStatus,
  type MaintenanceRunRecord,
  type MaintenanceRunStatus,
  MAINTENANCE_LOCK_NAME,
  DEFAULT_MAINTENANCE_LEASE_MS,
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

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  previous_hash TEXT,
  new_hash TEXT,
  change_status TEXT NOT NULL,
  http_status INTEGER,
  robots_status TEXT,
  observed_canonical_url TEXT,
  canonical_changed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES crawl_documents(id)
);

CREATE INDEX IF NOT EXISTS document_versions_doc_idx ON document_versions(document_id, created_at);

CREATE TABLE IF NOT EXISTS recrawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  requested INTEGER NOT NULL,
  processed INTEGER NOT NULL,
  changed INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  not_found INTEGER NOT NULL DEFAULT 0,
  gone INTEGER NOT NULL DEFAULT 0,
  actor TEXT
);

CREATE TABLE IF NOT EXISTS maintenance_locks (
  lock_name TEXT PRIMARY KEY,
  run_id INTEGER,
  owner_pid INTEGER,
  acquired_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  actor TEXT,
  recrawl_enabled INTEGER NOT NULL DEFAULT 0,
  reembed_enabled INTEGER NOT NULL DEFAULT 0,
  requested INTEGER NOT NULL DEFAULT 0,
  recrawled INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  not_found INTEGER NOT NULL DEFAULT 0,
  gone INTEGER NOT NULL DEFAULT 0,
  reembedded INTEGER NOT NULL DEFAULT 0,
  reembed_failures INTEGER NOT NULL DEFAULT 0,
  skipped_current INTEGER NOT NULL DEFAULT 0,
  stale_vector_documents INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  recovered_expired_lock INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT
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

  listEvents(documentId?: number | null): CrawlEventRecord[] {
    const rows = documentId == null
      ? this.db.prepare('SELECT * FROM crawl_events ORDER BY id').all()
      : this.db.prepare('SELECT * FROM crawl_events WHERE document_id = ? ORDER BY id').all(documentId)
    return (rows as Array<{
      id: number
      document_id: number | null
      state: string
      url: string
      canonical_url: string | null
      http_status: number | null
      bytes_received: number | null
      content_type: string | null
      content_hash: string | null
      robots_status: string | null
      error_category: string | null
      duration_ms: number
      created_at: string
    }>).map(row => ({
      id: Number(row.id),
      documentId: row.document_id == null ? null : Number(row.document_id),
      state: row.state as CrawlEventState,
      url: row.url,
      canonicalUrl: row.canonical_url,
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      bytesReceived: row.bytes_received == null ? null : Number(row.bytes_received),
      contentType: row.content_type,
      contentHash: row.content_hash,
      robotsStatus: (row.robots_status as RobotsStatus | null) ?? null,
      errorCategory: row.error_category,
      durationMs: Number(row.duration_ms),
      createdAt: row.created_at,
    }))
  }

  getLifecycleMeta(documentId: number): DocumentLifecycleMeta {
    const row = this.db.prepare('SELECT metadata_json FROM crawl_documents WHERE id = ?').get(documentId) as { metadata_json: string } | undefined
    return parseLifecycleMeta(row?.metadata_json)
  }

  patchLifecycleMeta(documentId: number, patch: Partial<DocumentLifecycleMeta>): DocumentLifecycleMeta {
    const current = this.getLifecycleMeta(documentId)
    const next: DocumentLifecycleMeta = { ...current, ...patch }
    this.db.prepare('UPDATE crawl_documents SET metadata_json = ? WHERE id = ?').run(JSON.stringify(next), documentId)
    return next
  }

  insertDocumentVersion(input: Omit<DocumentVersionRecord, 'id'>): DocumentVersionRecord {
    const result = this.db.prepare(`
      INSERT INTO document_versions (
        document_id, canonical_url, previous_hash, new_hash, change_status, http_status,
        robots_status, observed_canonical_url, canonical_changed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.documentId,
      input.canonicalUrl,
      input.previousHash,
      input.newHash,
      input.changeStatus,
      input.httpStatus,
      input.robotsStatus,
      input.observedCanonicalUrl,
      input.canonicalChanged ? 1 : 0,
      input.createdAt,
    )
    return { ...input, id: Number(result.lastInsertRowid) }
  }

  listDocumentVersions(documentId: number): DocumentVersionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM document_versions WHERE document_id = ? ORDER BY id
    `).all(documentId) as Array<{
      id: number
      document_id: number
      canonical_url: string
      previous_hash: string | null
      new_hash: string | null
      change_status: string
      http_status: number | null
      robots_status: string | null
      observed_canonical_url: string | null
      canonical_changed: number
      created_at: string
    }>
    return rows.map(row => ({
      id: Number(row.id),
      documentId: Number(row.document_id),
      canonicalUrl: row.canonical_url,
      previousHash: row.previous_hash,
      newHash: row.new_hash,
      changeStatus: row.change_status as RecrawlOutcome,
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      robotsStatus: (row.robots_status as RobotsStatus | null) ?? null,
      observedCanonicalUrl: row.observed_canonical_url,
      canonicalChanged: Number(row.canonical_changed) === 1,
      createdAt: row.created_at,
    }))
  }

  insertRecrawlRun(input: Omit<RecrawlRunRecord, 'id'>): RecrawlRunRecord {
    const result = this.db.prepare(`
      INSERT INTO recrawl_runs (
        started_at, finished_at, requested, processed, changed, unchanged, blocked,
        failed, not_found, gone, actor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.startedAt,
      input.finishedAt,
      input.requested,
      input.processed,
      input.changed,
      input.unchanged,
      input.blocked,
      input.failed,
      input.notFound,
      input.gone,
      input.actor,
    )
    return { ...input, id: Number(result.lastInsertRowid) }
  }

  latestRecrawlRun(): RecrawlRunRecord | null {
    const row = this.db.prepare('SELECT * FROM recrawl_runs ORDER BY id DESC LIMIT 1').get() as {
      id: number
      started_at: string
      finished_at: string
      requested: number
      processed: number
      changed: number
      unchanged: number
      blocked: number
      failed: number
      not_found: number
      gone: number
      actor: string | null
    } | undefined
    if (!row) return null
    return {
      id: Number(row.id),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      requested: Number(row.requested),
      processed: Number(row.processed),
      changed: Number(row.changed),
      unchanged: Number(row.unchanged),
      blocked: Number(row.blocked),
      failed: Number(row.failed),
      notFound: Number(row.not_found),
      gone: Number(row.gone),
      actor: row.actor,
    }
  }

  insertMaintenanceRun(input: Omit<MaintenanceRunRecord, 'id'>): MaintenanceRunRecord {
    const result = this.db.prepare(`
      INSERT INTO maintenance_runs (
        started_at, finished_at, status, actor, recrawl_enabled, reembed_enabled, requested,
        recrawled, changed, unchanged, blocked, failed, not_found, gone, reembedded,
        reembed_failures, skipped_current, stale_vector_documents, error, recovered_expired_lock,
        lease_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.startedAt,
      input.finishedAt,
      input.status,
      input.actor,
      input.recrawlEnabled ? 1 : 0,
      input.reembedEnabled ? 1 : 0,
      input.requested,
      input.recrawled,
      input.changed,
      input.unchanged,
      input.blocked,
      input.failed,
      input.notFound,
      input.gone,
      input.reembedded,
      input.reembedFailures,
      input.skippedCurrent,
      input.staleVectorDocuments,
      input.error,
      input.recoveredExpiredLock ? 1 : 0,
      input.leaseExpiresAt,
    )
    return { ...input, id: Number(result.lastInsertRowid) }
  }

  updateMaintenanceRun(id: number, patch: Partial<Omit<MaintenanceRunRecord, 'id'>>): MaintenanceRunRecord | null {
    const current = this.getMaintenanceRun(id)
    if (!current) return null
    const next: MaintenanceRunRecord = { ...current, ...patch, id }
    this.db.prepare(`
      UPDATE maintenance_runs SET
        started_at = ?, finished_at = ?, status = ?, actor = ?, recrawl_enabled = ?,
        reembed_enabled = ?, requested = ?, recrawled = ?, changed = ?, unchanged = ?,
        blocked = ?, failed = ?, not_found = ?, gone = ?, reembedded = ?, reembed_failures = ?,
        skipped_current = ?, stale_vector_documents = ?, error = ?, recovered_expired_lock = ?,
        lease_expires_at = ?
      WHERE id = ?
    `).run(
      next.startedAt,
      next.finishedAt,
      next.status,
      next.actor,
      next.recrawlEnabled ? 1 : 0,
      next.reembedEnabled ? 1 : 0,
      next.requested,
      next.recrawled,
      next.changed,
      next.unchanged,
      next.blocked,
      next.failed,
      next.notFound,
      next.gone,
      next.reembedded,
      next.reembedFailures,
      next.skippedCurrent,
      next.staleVectorDocuments,
      next.error,
      next.recoveredExpiredLock ? 1 : 0,
      next.leaseExpiresAt,
      id,
    )
    return next
  }

  getMaintenanceRun(id: number): MaintenanceRunRecord | null {
    const row = this.db.prepare('SELECT * FROM maintenance_runs WHERE id = ?').get(id) as MaintenanceRunRow | undefined
    return row ? mapMaintenanceRun(row) : null
  }

  latestMaintenanceRun(): MaintenanceRunRecord | null {
    const row = this.db.prepare('SELECT * FROM maintenance_runs ORDER BY id DESC LIMIT 1').get() as MaintenanceRunRow | undefined
    return row ? mapMaintenanceRun(row) : null
  }

  latestSuccessfulMaintenanceRun(): MaintenanceRunRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM maintenance_runs WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 1
    `).get() as MaintenanceRunRow | undefined
    return row ? mapMaintenanceRun(row) : null
  }

  getMaintenanceLock(lockName = MAINTENANCE_LOCK_NAME): MaintenanceLockRecord | null {
    const row = this.db.prepare('SELECT * FROM maintenance_locks WHERE lock_name = ?').get(lockName) as MaintenanceLockRow | undefined
    return row ? mapMaintenanceLock(row) : null
  }

  inspectMaintenanceLock(lockName = MAINTENANCE_LOCK_NAME, now = new Date().toISOString()): {
    status: MaintenanceLockStatus
    lock: MaintenanceLockRecord | null
    expiresAt: string | null
  } {
    const lock = this.getMaintenanceLock(lockName)
    if (!lock) return { status: 'FREE', lock: null, expiresAt: null }
    const expiresMs = Date.parse(lock.leaseExpiresAt)
    const nowMs = Date.parse(now)
    if (!Number.isFinite(expiresMs) || !Number.isFinite(nowMs) || nowMs >= expiresMs) {
      return { status: 'EXPIRED', lock, expiresAt: lock.leaseExpiresAt }
    }
    return { status: 'HELD', lock, expiresAt: lock.leaseExpiresAt }
  }

  tryAcquireMaintenanceLock(input?: {
    lockName?: string
    now?: string
    leaseMs?: number
    runId?: number | null
    ownerPid?: number | null
  }): { acquired: boolean; recovered: boolean; status: MaintenanceLockStatus; lock: MaintenanceLockRecord | null } {
    const lockName = input?.lockName ?? MAINTENANCE_LOCK_NAME
    const now = input?.now ?? new Date().toISOString()
    const leaseMs = input?.leaseMs ?? DEFAULT_MAINTENANCE_LEASE_MS
    const leaseExpiresAt = new Date(Date.parse(now) + Math.max(1, leaseMs)).toISOString()
    const ownerPid = input?.ownerPid ?? process.pid
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.getMaintenanceLock(lockName)
      if (existing) {
        const expiresMs = Date.parse(existing.leaseExpiresAt)
        const nowMs = Date.parse(now)
        const expired = !Number.isFinite(expiresMs) || !Number.isFinite(nowMs) || nowMs >= expiresMs
        if (!expired) {
          this.db.exec('COMMIT')
          return { acquired: false, recovered: false, status: 'HELD', lock: existing }
        }
        this.db.prepare(`
          UPDATE maintenance_locks SET run_id = ?, owner_pid = ?, acquired_at = ?, lease_expires_at = ?
          WHERE lock_name = ?
        `).run(input?.runId ?? null, ownerPid, now, leaseExpiresAt, lockName)
        this.db.exec('COMMIT')
        return {
          acquired: true,
          recovered: true,
          status: 'EXPIRED',
          lock: this.getMaintenanceLock(lockName),
        }
      }
      this.db.prepare(`
        INSERT INTO maintenance_locks (lock_name, run_id, owner_pid, acquired_at, lease_expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(lockName, input?.runId ?? null, ownerPid, now, leaseExpiresAt)
      this.db.exec('COMMIT')
      return { acquired: true, recovered: false, status: 'FREE', lock: this.getMaintenanceLock(lockName) }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw error
    }
  }

  attachMaintenanceLockRun(lockName: string, runId: number, now: string, leaseMs: number): void {
    const leaseExpiresAt = new Date(Date.parse(now) + Math.max(1, leaseMs)).toISOString()
    this.db.prepare(`
      UPDATE maintenance_locks SET run_id = ?, lease_expires_at = ? WHERE lock_name = ?
    `).run(runId, leaseExpiresAt, lockName)
  }

  renewMaintenanceLock(lockName: string, now: string, leaseMs: number): void {
    const leaseExpiresAt = new Date(Date.parse(now) + Math.max(1, leaseMs)).toISOString()
    this.db.prepare('UPDATE maintenance_locks SET lease_expires_at = ? WHERE lock_name = ?').run(leaseExpiresAt, lockName)
  }

  releaseMaintenanceLock(lockName = MAINTENANCE_LOCK_NAME): void {
    this.db.prepare('DELETE FROM maintenance_locks WHERE lock_name = ?').run(lockName)
  }
}

const DEFAULT_LIFECYCLE_META: DocumentLifecycleMeta = {
  freshnessIntervalHours: null,
  lastRecrawlAt: null,
  lastRecrawlOutcome: null,
  previousContentHash: null,
  lastChangeAt: null,
  sourceAvailability: 'AVAILABLE',
  lastObservedCanonicalUrl: null,
  canonicalChanged: false,
  lastErrorCategory: null,
}

function parseLifecycleMeta(raw: string | null | undefined): DocumentLifecycleMeta {
  if (!raw) return { ...DEFAULT_LIFECYCLE_META }
  try {
    const parsed = JSON.parse(raw) as Partial<DocumentLifecycleMeta>
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_LIFECYCLE_META }
    const availability: SourceAvailability[] = ['AVAILABLE', 'NOT_FOUND', 'GONE', 'UNKNOWN']
    return {
      freshnessIntervalHours: typeof parsed.freshnessIntervalHours === 'number' && parsed.freshnessIntervalHours >= 1
        ? parsed.freshnessIntervalHours
        : null,
      lastRecrawlAt: typeof parsed.lastRecrawlAt === 'string' ? parsed.lastRecrawlAt : null,
      lastRecrawlOutcome: parsed.lastRecrawlOutcome ?? null,
      previousContentHash: typeof parsed.previousContentHash === 'string' ? parsed.previousContentHash : null,
      lastChangeAt: typeof parsed.lastChangeAt === 'string' ? parsed.lastChangeAt : null,
      sourceAvailability: availability.includes(parsed.sourceAvailability as SourceAvailability)
        ? parsed.sourceAvailability as SourceAvailability
        : 'AVAILABLE',
      lastObservedCanonicalUrl: typeof parsed.lastObservedCanonicalUrl === 'string' ? parsed.lastObservedCanonicalUrl : null,
      canonicalChanged: Boolean(parsed.canonicalChanged),
      lastErrorCategory: typeof parsed.lastErrorCategory === 'string' ? parsed.lastErrorCategory : null,
    }
  } catch {
    return { ...DEFAULT_LIFECYCLE_META }
  }
}

type MaintenanceLockRow = {
  lock_name: string
  run_id: number | null
  owner_pid: number | null
  acquired_at: string
  lease_expires_at: string
}

type MaintenanceRunRow = {
  id: number
  started_at: string
  finished_at: string | null
  status: string
  actor: string | null
  recrawl_enabled: number
  reembed_enabled: number
  requested: number
  recrawled: number
  changed: number
  unchanged: number
  blocked: number
  failed: number
  not_found: number
  gone: number
  reembedded: number
  reembed_failures: number
  skipped_current: number
  stale_vector_documents: number
  error: string | null
  recovered_expired_lock: number
  lease_expires_at: string | null
}

function mapMaintenanceLock(row: MaintenanceLockRow): MaintenanceLockRecord {
  return {
    lockName: row.lock_name,
    runId: row.run_id == null ? null : Number(row.run_id),
    ownerPid: row.owner_pid == null ? null : Number(row.owner_pid),
    acquiredAt: row.acquired_at,
    leaseExpiresAt: row.lease_expires_at,
  }
}

function mapMaintenanceRun(row: MaintenanceRunRow): MaintenanceRunRecord {
  return {
    id: Number(row.id),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as MaintenanceRunStatus,
    actor: row.actor,
    recrawlEnabled: Number(row.recrawl_enabled) === 1,
    reembedEnabled: Number(row.reembed_enabled) === 1,
    requested: Number(row.requested),
    recrawled: Number(row.recrawled),
    changed: Number(row.changed),
    unchanged: Number(row.unchanged),
    blocked: Number(row.blocked),
    failed: Number(row.failed),
    notFound: Number(row.not_found),
    gone: Number(row.gone),
    reembedded: Number(row.reembedded),
    reembedFailures: Number(row.reembed_failures),
    skippedCurrent: Number(row.skipped_current),
    staleVectorDocuments: Number(row.stale_vector_documents),
    error: row.error,
    recoveredExpiredLock: Number(row.recovered_expired_lock) === 1,
    leaseExpiresAt: row.lease_expires_at,
  }
}
