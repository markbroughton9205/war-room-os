import { createHash } from 'node:crypto'
import type { SourceAuthorityClass, SourceHistoryEntry, SourceRecord, SourceType } from './types'
import { SOURCE_AUTHORITY_CLASSES, SOURCE_PRIORITY, SOURCE_TYPES } from './types'

export class SourceRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceRegistryError'
  }
}

export function isSourceAuthorityClass(value: string): value is SourceAuthorityClass {
  return (SOURCE_AUTHORITY_CLASSES as readonly string[]).includes(value)
}

export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value)
}

export function sourcePriorityRank(authority: SourceAuthorityClass): number {
  const index = SOURCE_PRIORITY.indexOf(authority)
  return index === -1 ? SOURCE_PRIORITY.length : index
}

export function sortSourcesByPriority(sources: SourceRecord[]): SourceRecord[] {
  return [...sources].sort((a, b) => {
    const rank = sourcePriorityRank(a.authorityClass) - sourcePriorityRank(b.authorityClass)
    if (rank !== 0) return rank
    return a.sourceId.localeCompare(b.sourceId)
  })
}

export function hashSourceContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function createSourceRecord(input: Omit<SourceRecord, 'stale' | 'staleReason' | 'contentHash'> & { contentHash?: string | null }): SourceRecord {
  if (!input.sourceId.trim()) throw new SourceRegistryError('SOURCE_ID required')
  if (!/^https?:\/\//i.test(input.sourceUrl) && !input.sourceUrl.startsWith('repo:')) {
    throw new SourceRegistryError(`SOURCE_URL must be http(s) or repo: reference: ${input.sourceId}`)
  }
  if (!isSourceAuthorityClass(input.authorityClass)) throw new SourceRegistryError(`Unknown authority class: ${input.authorityClass}`)
  if (!isSourceType(input.sourceType)) throw new SourceRegistryError(`Unknown source type: ${input.sourceType}`)
  return {
    ...input,
    contentHash: input.contentHash ?? null,
    stale: false,
    staleReason: null,
  }
}

export function appendSourceHistory(
  history: SourceHistoryEntry[],
  source: SourceRecord,
  action: SourceHistoryEntry['action'],
  at = new Date().toISOString(),
): SourceHistoryEntry[] {
  return [
    ...history,
    {
      sourceId: source.sourceId,
      at,
      action,
      snapshot: {
        sourceUrl: source.sourceUrl,
        version: source.version,
        lastVerified: source.lastVerified,
        contentHash: source.contentHash,
        authorityClass: source.authorityClass,
        stale: source.stale,
      },
    },
  ]
}

export function markSourceStale(source: SourceRecord, reason: string, at = new Date().toISOString()): SourceRecord {
  return {
    ...source,
    stale: true,
    staleReason: reason,
    lastVerified: source.lastVerified,
    retrievedAt: at,
  }
}

export function mergeSourceWithoutClobberingHistory(
  existing: SourceRecord | undefined,
  incoming: SourceRecord,
): { source: SourceRecord; overwrittenHistory: false } {
  if (!existing) return { source: incoming, overwrittenHistory: false }
  return {
    source: {
      ...existing,
      ...incoming,
      sourceId: existing.sourceId,
      retrievedAt: incoming.retrievedAt ?? existing.retrievedAt,
    },
    overwrittenHistory: false,
  }
}
