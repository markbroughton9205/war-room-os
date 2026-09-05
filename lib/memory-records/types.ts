// Reuses the MemoryType/MemoryScope unions already defined for the heavier AI-proposed
// memory-write-gate (lib/council/memory-write-gate/types.ts) so the two systems share vocabulary.
// war_room_memory_records is deliberately a lighter, directly-Commander-authored path (matching
// the existing /api/tools/memory convention: Commander-gated, no staged-approval machinery) — the
// full stage→verify→commit→rollback gate stays reserved for AI-proposed writes, which Wave 1
// does not add a new caller for.
export type { MemoryScope, MemoryType } from '@/lib/council/memory-write-gate/types'

export type MemoryRecordStatus = 'active' | 'superseded' | 'retracted'
export type MemoryImportanceTier = 'trivial' | 'operational' | 'strategic' | 'critical'

export type MemoryRecord = {
  id: string
  content: string
  memory_type: string
  scope: string
  project_id: string | null
  conversation_id: string | null
  status: MemoryRecordStatus
  effective_from: string
  effective_until: string | null
  superseded_by: string | null
  importance_tier: MemoryImportanceTier
  source_type: string
  source_ref: Record<string, unknown>
  created_by: string
  created_at: string
}
