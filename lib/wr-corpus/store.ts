/**
 * Canonical WR-CORPUS SQLite index. Metadata/index only — immutable bytes live in artifacts/.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { ensureWrCorpusDirs, resolveWrCorpusPaths, type WrCorpusPaths } from './paths'
import { tightenFileMode } from '@/lib/sovereign-runtime/local-ownership/paths'
import type { RightsRecord, TrainingEligibility } from './rights'
import { SYSTEM_HISTORICAL_OWNER } from './identity'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS corpus_versions (
  canonical_id TEXT PRIMARY KEY,
  historical_id TEXT NOT NULL,
  historical_version TEXT,
  physical_layout TEXT NOT NULL,
  artifact_relpath TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  migrated_at TEXT NOT NULL,
  classification_json TEXT NOT NULL,
  rights_summary_json TEXT NOT NULL,
  training_eligibility TEXT NOT NULL,
  historical_model_lineage_json TEXT NOT NULL,
  immutable INTEGER NOT NULL,
  provenance_json TEXT NOT NULL,
  source_types_json TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS corpus_records (
  record_id TEXT PRIMARY KEY,
  corpus_version TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  source_type TEXT,
  split TEXT,
  content_hash TEXT NOT NULL,
  rights_json TEXT NOT NULL,
  training_eligibility TEXT NOT NULL,
  review_state TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  historical_path TEXT,
  canonical_path TEXT,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  tombstone_policy TEXT,
  source_candidate_id TEXT
);
CREATE INDEX IF NOT EXISTS corpus_records_owner_idx ON corpus_records (owner_user_id, corpus_version);
CREATE INDEX IF NOT EXISTS corpus_records_hash_idx ON corpus_records (content_hash);
CREATE TABLE IF NOT EXISTS embeddings (
  record_id TEXT PRIMARY KEY,
  dims INTEGER NOT NULL,
  vector_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tombstones (
  tombstone_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  policy TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  historical_source_preserved INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS migration_events (
  event_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS promotion_events (
  event_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

export type CorpusVersionRow = {
  canonical_id: string
  historical_id: string
  historical_version: string | null
  physical_layout: string
  artifact_relpath: string
  content_hash: string
  record_count: number
  created_at: string
  migrated_at: string
  classification: Record<string, unknown>
  rights_summary: Record<string, unknown>
  training_eligibility: TrainingEligibility
  historical_model_lineage: Record<string, unknown>
  immutable: boolean
  provenance: Record<string, unknown>
  source_types: string[]
  quality_status: string
  active: boolean
  bytes: number
}

export type CorpusRecordRow = {
  record_id: string
  corpus_version: string
  owner_user_id: string
  title: string | null
  text: string
  source_type: string | null
  split: string | null
  content_hash: string
  rights: RightsRecord
  training_eligibility: TrainingEligibility
  review_state: string
  provenance: Record<string, unknown>
  historical_path: string | null
  canonical_path: string | null
  created_at: string
  active: boolean
  tombstone_policy: string | null
  source_candidate_id: string | null
}

export class WrCorpusStore {
  readonly paths: WrCorpusPaths
  readonly dbPath: string
  private readonly db: DatabaseSync
  private closed = false

  constructor(dataDirOverride?: string | null) {
    this.paths = resolveWrCorpusPaths(dataDirOverride)
    ensureWrCorpusDirs(this.paths)
    this.dbPath = this.paths.dbPath
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    tightenFileMode(this.dbPath)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  begin(): void {
    this.db.exec('BEGIN')
  }

  commit(): void {
    this.db.exec('COMMIT')
  }

  rollback(): void {
    try {
      this.db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
  }

  getVersion(canonicalId: string): CorpusVersionRow | null {
    const row = this.db.prepare('SELECT * FROM corpus_versions WHERE canonical_id = ?').get(canonicalId) as
      | Record<string, unknown>
      | undefined
    return row ? hydrateVersion(row) : null
  }

  listVersions(): CorpusVersionRow[] {
    const rows = this.db.prepare('SELECT * FROM corpus_versions ORDER BY canonical_id').all() as Record<string, unknown>[]
    return rows.map(hydrateVersion)
  }

  upsertVersion(row: CorpusVersionRow): void {
    this.db
      .prepare(
        `INSERT INTO corpus_versions (
          canonical_id, historical_id, historical_version, physical_layout, artifact_relpath, content_hash,
          record_count, created_at, migrated_at, classification_json, rights_summary_json, training_eligibility,
          historical_model_lineage_json, immutable, provenance_json, source_types_json, quality_status, active, bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_id) DO UPDATE SET
          content_hash=excluded.content_hash,
          record_count=excluded.record_count,
          migrated_at=excluded.migrated_at,
          bytes=excluded.bytes,
          provenance_json=excluded.provenance_json
        `,
      )
      .run(
        row.canonical_id,
        row.historical_id,
        row.historical_version,
        row.physical_layout,
        row.artifact_relpath,
        row.content_hash,
        row.record_count,
        row.created_at,
        row.migrated_at,
        JSON.stringify(row.classification),
        JSON.stringify(row.rights_summary),
        row.training_eligibility,
        JSON.stringify(row.historical_model_lineage),
        row.immutable ? 1 : 0,
        JSON.stringify(row.provenance),
        JSON.stringify(row.source_types),
        row.quality_status,
        row.active ? 1 : 0,
        row.bytes,
      )
  }

  getRecord(recordId: string): CorpusRecordRow | null {
    const row = this.db.prepare('SELECT * FROM corpus_records WHERE record_id = ?').get(recordId) as
      | Record<string, unknown>
      | undefined
    return row ? hydrateRecord(row) : null
  }

  listRecordTexts(corpusVersion: string, activeOnly = true): Array<{
    record_id: string
    text: string
    source_type: string | null
    title: string | null
  }> {
    const rows = this.db
      .prepare(
        `SELECT record_id, text, source_type, title FROM corpus_records
         WHERE corpus_version = ? ${activeOnly ? 'AND active = 1' : ''}`,
      )
      .all(corpusVersion) as Array<{
      record_id: string
      text: string
      source_type: string | null
      title: string | null
    }>
    return rows.map(row => ({
      record_id: String(row.record_id),
      text: String(row.text ?? ''),
      source_type: row.source_type ? String(row.source_type) : null,
      title: row.title ? String(row.title) : null,
    }))
  }

  countRecords(corpusVersion?: string, activeOnly = true): number {
    if (corpusVersion) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM corpus_records WHERE corpus_version = ? ${activeOnly ? 'AND active = 1' : ''}`,
        )
        .get(corpusVersion) as { n: number }
      return Number(row.n)
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM corpus_records ${activeOnly ? 'WHERE active = 1' : ''}`)
      .get() as { n: number }
    return Number(row.n)
  }

  insertRecord(row: CorpusRecordRow, embedding: number[]): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO corpus_records (
          record_id, corpus_version, owner_user_id, title, text, source_type, split, content_hash,
          rights_json, training_eligibility, review_state, provenance_json, historical_path, canonical_path,
          created_at, active, tombstone_policy, source_candidate_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.record_id,
        row.corpus_version,
        row.owner_user_id,
        row.title,
        row.text,
        row.source_type,
        row.split,
        row.content_hash,
        JSON.stringify(row.rights),
        row.training_eligibility,
        row.review_state,
        JSON.stringify(row.provenance),
        row.historical_path,
        row.canonical_path,
        row.created_at,
        row.active ? 1 : 0,
        row.tombstone_policy,
        row.source_candidate_id,
      )
    this.db
      .prepare('INSERT OR REPLACE INTO embeddings(record_id, dims, vector_json) VALUES (?, ?, ?)')
      .run(row.record_id, embedding.length, JSON.stringify(embedding))
  }

  lexicalSearch(query: string, opts: { ownerUserId: string; limit?: number; corpusVersion?: string }): CorpusRecordRow[] {
    const limit = opts.limit ?? 8
    const stop = new Set(['who', 'what', 'when', 'where', 'why', 'how', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'about'])
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map(t => t.replace(/'/g, ''))
      .filter(t => t.length > 3 && !stop.has(t))
    const terms = tokens.length ? [...new Set(tokens)].slice(0, 6) : [query.replace(/[%_]/g, '')]
    const clauses = terms.map(() => '(r.title LIKE ? OR r.text LIKE ? OR r.record_id LIKE ?)').join(' OR ')
    const likes = terms.flatMap(term => {
      const like = `%${term.replace(/[%_]/g, '')}%`
      return [like, like, like]
    })
    const rows = this.db
      .prepare(
        `SELECT r.* FROM corpus_records r
         WHERE r.active = 1
           AND (r.owner_user_id = ? OR r.owner_user_id = ?)
           AND (? IS NULL OR r.corpus_version = ?)
           AND (${clauses})
         LIMIT 80`,
      )
      .all(
        opts.ownerUserId,
        SYSTEM_HISTORICAL_OWNER,
        opts.corpusVersion ?? null,
        opts.corpusVersion ?? null,
        ...likes,
      ) as Record<string, unknown>[]
    const hydrated = rows.map(hydrateRecord)
    const scored = hydrated
      .map(row => {
        const title = (row.title ?? '').toLowerCase()
        const hay = `${title}\n${row.text}`.toLowerCase()
        const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0) + (title.includes(term) ? 2 : 0), 0)
        return { row, score }
      })
      .sort((a, b) => b.score - a.score || a.row.corpus_version.localeCompare(b.row.corpus_version))
    return scored.slice(0, limit).map(s => s.row)
  }

  allActiveForSemantic(ownerUserId: string, corpusVersion?: string): Array<CorpusRecordRow & { embedding: number[] }> {
    const rows = this.db
      .prepare(
        `SELECT r.*, e.vector_json FROM corpus_records r
         JOIN embeddings e ON e.record_id = r.record_id
         WHERE r.active = 1 AND (r.owner_user_id = ? OR r.owner_user_id = ?)
           AND (? IS NULL OR r.corpus_version = ?)`,
      )
      .all(ownerUserId, SYSTEM_HISTORICAL_OWNER, corpusVersion ?? null, corpusVersion ?? null) as Record<string, unknown>[]
    return rows.map(row => ({
      ...hydrateRecord(row),
      embedding: JSON.parse(String(row.vector_json || '[]')) as number[],
    }))
  }

  tombstone(input: {
    recordId: string
    ownerUserId: string
    policy: 'DELETE_AND_ALLOW_RELEARN' | 'DELETE_AND_BLOCK_RELEARN'
    nowIso?: string
  }): CorpusRecordRow {
    const existing = this.getRecord(input.recordId)
    if (!existing) throw new Error('RECORD_NOT_FOUND')
    if (existing.owner_user_id !== input.ownerUserId && existing.owner_user_id !== SYSTEM_HISTORICAL_OWNER) {
      throw new Error('OWNER_MISMATCH')
    }
    if (existing.owner_user_id === SYSTEM_HISTORICAL_OWNER && input.ownerUserId !== SYSTEM_HISTORICAL_OWNER) {
      /* Commander may tombstone historical records in the ACTIVE layer only. */
    }
    const now = input.nowIso ?? new Date().toISOString()
    this.db
      .prepare('UPDATE corpus_records SET active = 0, tombstone_policy = ? WHERE record_id = ?')
      .run(input.policy, input.recordId)
    this.db.prepare('DELETE FROM embeddings WHERE record_id = ?').run(input.recordId)
    this.db
      .prepare(
        'INSERT INTO tombstones(tombstone_id, record_id, content_hash, policy, deleted_at, owner_user_id, historical_source_preserved) VALUES (?, ?, ?, ?, ?, ?, 1)',
      )
      .run(`tomb:${input.recordId}:${now}`, input.recordId, existing.content_hash, input.policy, now, input.ownerUserId)
    return { ...existing, active: false, tombstone_policy: input.policy }
  }

  findTombstoneByHash(contentHash: string): { policy: string; record_id: string } | null {
    const row = this.db
      .prepare('SELECT policy, record_id FROM tombstones WHERE content_hash = ? ORDER BY deleted_at DESC LIMIT 1')
      .get(contentHash) as { policy: string; record_id: string } | undefined
    return row ?? null
  }

  listTombstones(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM tombstones ORDER BY deleted_at DESC').all() as Record<string, unknown>[]
  }

  addMigrationEvent(kind: string, payload: Record<string, unknown>): void {
    const id = `mig:${kind}:${Date.now()}`
    this.db
      .prepare('INSERT INTO migration_events(event_id, created_at, kind, payload_json) VALUES (?, ?, ?, ?)')
      .run(id, new Date().toISOString(), kind, JSON.stringify(payload))
  }

  listMigrationEvents(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM migration_events ORDER BY created_at').all() as Record<string, unknown>[]
  }

  addPromotion(candidateId: string, recordId: string, ownerUserId: string): void {
    this.db
      .prepare(
        'INSERT INTO promotion_events(event_id, candidate_id, record_id, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(`promo:${candidateId}:${recordId}`, candidateId, recordId, ownerUserId, new Date().toISOString())
  }

  findPromotion(candidateId: string): { record_id: string } | null {
    const row = this.db
      .prepare('SELECT record_id FROM promotion_events WHERE candidate_id = ?')
      .get(candidateId) as { record_id: string } | undefined
    return row ?? null
  }

  artifactBytes(): number {
    return sumBytes(this.paths.artifacts)
  }
}

function hydrateVersion(row: Record<string, unknown>): CorpusVersionRow {
  return {
    canonical_id: String(row.canonical_id),
    historical_id: String(row.historical_id),
    historical_version: row.historical_version ? String(row.historical_version) : null,
    physical_layout: String(row.physical_layout),
    artifact_relpath: String(row.artifact_relpath),
    content_hash: String(row.content_hash),
    record_count: Number(row.record_count),
    created_at: String(row.created_at),
    migrated_at: String(row.migrated_at),
    classification: JSON.parse(String(row.classification_json || '{}')) as Record<string, unknown>,
    rights_summary: JSON.parse(String(row.rights_summary_json || '{}')) as Record<string, unknown>,
    training_eligibility: String(row.training_eligibility) as TrainingEligibility,
    historical_model_lineage: JSON.parse(String(row.historical_model_lineage_json || '{}')) as Record<string, unknown>,
    immutable: Number(row.immutable) === 1,
    provenance: JSON.parse(String(row.provenance_json || '{}')) as Record<string, unknown>,
    source_types: JSON.parse(String(row.source_types_json || '[]')) as string[],
    quality_status: String(row.quality_status),
    active: Number(row.active) === 1,
    bytes: Number(row.bytes ?? 0),
  }
}

function hydrateRecord(row: Record<string, unknown>): CorpusRecordRow {
  return {
    record_id: String(row.record_id),
    corpus_version: String(row.corpus_version),
    owner_user_id: String(row.owner_user_id),
    title: row.title ? String(row.title) : null,
    text: String(row.text),
    source_type: row.source_type ? String(row.source_type) : null,
    split: row.split ? String(row.split) : null,
    content_hash: String(row.content_hash),
    rights: JSON.parse(String(row.rights_json || '{}')) as RightsRecord,
    training_eligibility: String(row.training_eligibility) as TrainingEligibility,
    review_state: String(row.review_state),
    provenance: JSON.parse(String(row.provenance_json || '{}')) as Record<string, unknown>,
    historical_path: row.historical_path ? String(row.historical_path) : null,
    canonical_path: row.canonical_path ? String(row.canonical_path) : null,
    created_at: String(row.created_at),
    active: Number(row.active) === 1,
    tombstone_policy: row.tombstone_policy ? String(row.tombstone_policy) : null,
    source_candidate_id: row.source_candidate_id ? String(row.source_candidate_id) : null,
  }
}

function sumBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) walk(full)
      else total += fs.statSync(full).size
    }
  }
  walk(dir)
  return total
}

export function embedText(text: string, dims = 64): number[] {
  const vec = new Array(dims).fill(0)
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2)
  for (const token of tokens) {
    let h = 2166136261
    for (let i = 0; i < token.length; i += 1) h = Math.imul(h ^ token.charCodeAt(i), 16777619)
    vec[Math.abs(h) % dims] += 1
  }
  let sum = 0
  for (const v of vec) sum += v * v
  const norm = Math.sqrt(sum) || 1
  return vec.map(v => v / norm)
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}
