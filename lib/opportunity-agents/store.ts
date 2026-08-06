/**
 * Session-only in-memory store for opportunity records.
 *
 * TRUTH NOTE: this store is process memory. Records do NOT survive a server
 * restart or redeploy. Every API surface that reads from it must carry the
 * persistence:'session_only' label. Durable persistence requires a migration
 * that is NOT authorized in Phase 49-C-1 — see the package report
 * (PERSISTENCE_MIGRATION_REQUIRED).
 */
import type { OpportunityAuditEntry, OpportunityRecord } from './types'

const records: OpportunityRecord[] = []
const MAX_RECORDS = 500

function newId(): string {
  return `opag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeDedupeKey(title: string, sourceUrl: string | null): string {
  const t = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const u = (sourceUrl ?? '').toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '')
  return `${t}::${u}`
}

export function findDuplicate(title: string, sourceUrl: string | null): OpportunityRecord | null {
  const key = normalizeDedupeKey(title, sourceUrl)
  return records.find(r => normalizeDedupeKey(r.title, r.sourceUrl) === key) ?? null
}

export function insertRecord(
  record: Omit<OpportunityRecord, 'id' | 'createdAt' | 'updatedAt' | 'auditHistory'>,
  audit: Omit<OpportunityAuditEntry, 'at'>,
): OpportunityRecord {
  const now = new Date().toISOString()
  const full: OpportunityRecord = {
    ...record,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    auditHistory: [{ ...audit, at: now }],
  }
  records.unshift(full)
  if (records.length > MAX_RECORDS) records.splice(MAX_RECORDS)
  return full
}

export function getRecord(id: string): OpportunityRecord | null {
  return records.find(r => r.id === id) ?? null
}

export function listRecords(): OpportunityRecord[] {
  return [...records]
}

/** Append an audit entry and touch updatedAt. Returns false when id unknown. */
export function appendAudit(
  id: string,
  entry: Omit<OpportunityAuditEntry, 'at'>,
): OpportunityRecord | null {
  const record = getRecord(id)
  if (!record) return null
  record.auditHistory.push({ ...entry, at: new Date().toISOString() })
  record.updatedAt = new Date().toISOString()
  return record
}

/** Test hook — clears the store. Not used by any API route. */
export function __resetOpportunityAgentStore(): void {
  records.splice(0, records.length)
}
