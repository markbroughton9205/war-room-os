/**
 * WR-Engineer engineering memory — domain types.
 *
 * Deliberately separate from lib/wr-engineer/identity/*.md (IDENTITY/SOUL/USER are constitutional
 * identity layers, loaded once per session and never treated as ordinary data records — see
 * identity/loader.ts's header). Engineering memory is ordinary, queryable, append-heavy data:
 * architecture facts, decisions, bugs, fixes, failures, validation results, dependency facts,
 * mission history, and model facts, accumulated across sessions.
 *
 * Phase 1 storage (memory/store.ts) is a local JSON-file store under .war-room/wr-engineer/ — the
 * same "sovereign agent state lives under .war-room/, gitignored, not a new Supabase migration"
 * convention lib/native-builder already uses for its own snapshots. This is a deliberate Phase 1
 * scoping choice, not a final architecture: docs/war-room-constitution.md §5 and the existing
 * war_room_memory_records table (lib/memory-records/*) are the natural longer-term home once a
 * migration is explicitly authorized — the EngineeringMemoryStore interface below is written so
 * swapping the backend later (JSON file -> war_room_memory_records) changes only store.ts's
 * implementation, never a caller.
 */
import type { EpistemicStatus } from '../types'

export const ENGINEERING_MEMORY_CATEGORIES = [
  'ARCHITECTURE',
  'DECISION',
  'BUG',
  'FIX',
  'FAILURE',
  'VALIDATION',
  'DEPENDENCY',
  'MISSION',
  'REPOSITORY_FACT',
  'MODEL_FACT',
] as const
export type EngineeringMemoryCategory = (typeof ENGINEERING_MEMORY_CATEGORIES)[number]

export type EngineeringMemoryRecord = {
  id: string
  category: EngineeringMemoryCategory
  summary: string
  detail: string
  /** How confidently this record's content can be trusted right now (SOUL.md §6) — a DECISION or
   * ARCHITECTURE fact recorded from direct inspection is OBSERVED; a FAILURE hypothesis not yet
   * confirmed is INFERENCE or NOT_VERIFIED. */
  epistemicStatus: EpistemicStatus
  /** Free-form cross-references: file paths, mission ids, native-builder repair ids, other memory
   * record ids. Not a foreign-key constraint — just enough structure to trace provenance. */
  relatedRefs: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type CreateMemoryRecordInput = {
  category: EngineeringMemoryCategory
  summary: string
  detail: string
  epistemicStatus: EpistemicStatus
  relatedRefs?: string[]
  tags?: string[]
}

export type MemoryQuery = {
  category?: EngineeringMemoryCategory
  tag?: string
  /** Case-insensitive substring match against summary + detail. */
  textContains?: string
}

/** Backend-agnostic contract — see this file's header for why Phase 1 backs this with a local JSON
 * store rather than a new Supabase table. */
export interface EngineeringMemoryStore {
  record(input: CreateMemoryRecordInput): Promise<EngineeringMemoryRecord>
  get(id: string): Promise<EngineeringMemoryRecord | null>
  query(query?: MemoryQuery): Promise<EngineeringMemoryRecord[]>
  all(): Promise<EngineeringMemoryRecord[]>
}
