import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { MemoryFamilyPartition } from '@/lib/memory/types'
import { isMemoryFamilyPartition } from '@/lib/memory/types'
import { insertMemoryProposal } from '@/lib/memory/store'
import { redactProposalContent, tryParseMemoryProposalLine, validateProposal } from '@/lib/memory/proposals'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/**
 * When model output contains `MEMORY_PROPOSAL:{...}`, insert a pending row (never auto-approve).
 *
 * MEMORY-14 reconciliation (2026-09-06): traced the full architecture per an explicit mission
 * requirement not to assume the prior fix was complete. Findings, with evidence:
 *   - lib/council/nebula/memory.ts's NebulaMemoryScope taxonomy (working/private/council/mission/
 *     commander/global/constellation) and agentMayWriteMemoryScope()/agentMayAccessMemoryScope()
 *     have NO real persistence layer anywhere in this codebase. createWorkingMemory() - the only
 *     function that builds a NebulaMemoryRecord - has zero callers outside its own file (grep
 *     confirmed). lib/council/constellation/planner.ts's `allowedMemoryScopes: ['working',
 *     'constellation']` is a static config value nothing ever checks against. There is no table,
 *     no insert call, no read call for Nebula-scoped memory anywhere.
 *   - war_room_memory_proposals (supabase/war_room_production_init.sql) is a SEPARATE, legacy
 *     family-attribution system: its `family_partition_check` constraint enumerates exactly the 8
 *     MemoryFamilyPartition values ('ChatGPT Family', 'Claude Family', ... 'Baby AI Observer') -
 *     there is no scope column, and none of NebulaMemoryScope's 7 values overlap with it at all.
 *   - Conclusion (mission's branch E): this is NOT the Nebula-scoped-memory persistence layer, and
 *     no real write path for Nebula-scoped memory exists anywhere to enforce
 *     agentMayWriteMemoryScope against. The previous fix's `agentMayWriteMemoryScope(nebulaAgentId,
 *     'mission')` call here was checking a scope with no relationship to anything real in this
 *     table - a hard-coded, always-'mission', always-permitted (DEFAULT_ALLOWED_SCOPES grants
 *     'mission' to all 8 agents) decorative check that could never reject anything and protected
 *     nothing. Removed per the mission's explicit instruction not to invent a fake scope
 *     assumption. Building a real Nebula-memory persistence/write boundary is new functionality,
 *     not a repair of an existing gap - out of scope for a closure mission that forbids Wave 2.
 *
 * The genuinely real, valid fix from before is preserved and strengthened below: the model's own
 * response text can self-report a `family_partition` in its MEMORY_PROPOSAL JSON, and
 * family_partition IS the only "who does this belong to" field this table actually has. A
 * self-reported partition that happened to be a valid enum member (e.g. "Red Team") was previously
 * accepted even if a DIFFERENT seat (e.g. ORION/claude) was the one actually emitting the response.
 * `emittingSeat` is the real, caller-known identity of whichever seat generated `responseText`; a
 * self-report that disagrees with it is rejected outright, not silently corrected. Strengthened
 * here with a second, independent check: when `emittingSeat` is supplied, its own
 * councilSingleFamilyToMemoryPartition(emittingSeat) mapping must agree with the caller-supplied
 * `fallbackPartition` too - if a caller ever passes a `fallbackPartition` inconsistent with the
 * `emittingSeat` it also passed (a bug upstream, or identity unavailable/mismatched at this
 * boundary), this fails closed rather than trusting `fallbackPartition` blindly.
 */
export async function tryPersistMemoryProposalFromModelOutput(opts: {
  client: WarRoomSupabase | null
  responseText: string
  fallbackPartition: MemoryFamilyPartition
  /** The real, caller-known seat that generated `responseText` - the enforcement point's source
   * of truth for identity, independent of anything self-reported in the model's own output. */
  emittingSeat?: CouncilOrchestrationFamily | null
  conversationId?: string | null
  extraMetadata?: Record<string, unknown>
}): Promise<{ inserted: boolean; proposalId?: string; skipReason?: string }> {
  if (!opts.client) {
    return { inserted: false, skipReason: 'no_db' }
  }

  // Fail closed if the caller's own two identity signals disagree - this can only happen from a
  // bug upstream (e.g. fallbackPartition computed from a different seat than emittingSeat), but an
  // authorization boundary should never silently trust one arbitrarily over the other.
  if (opts.emittingSeat && councilSingleFamilyToMemoryPartition(opts.emittingSeat) !== opts.fallbackPartition) {
    return { inserted: false, skipReason: 'emitting_seat_fallback_partition_mismatch' }
  }

  const parsed = tryParseMemoryProposalLine(opts.responseText)
  if (!parsed) {
    return { inserted: false, skipReason: 'no_line' }
  }
  const redactedBody = redactProposalContent(parsed.content)
  const fpRaw = typeof parsed.family_partition === 'string' ? parsed.family_partition.trim() : ''
  const selfReportedPartition = fpRaw && isMemoryFamilyPartition(fpRaw) ? fpRaw : null

  // Reject BEFORE insertion if the model's self-report disagrees with the real, caller-known
  // emitting identity - this is the actual authorization boundary, not the enum-membership check
  // above (which only proves the string is A valid partition, not THIS agent's partition).
  if (selfReportedPartition && selfReportedPartition !== opts.fallbackPartition) {
    return { inserted: false, skipReason: 'unauthorized_scope_self_report' }
  }
  const family_partition = selfReportedPartition ?? opts.fallbackPartition

  const v = validateProposal({ ...parsed, content: redactedBody, family_partition })
  if (!v.ok) {
    return { inserted: false, skipReason: v.error }
  }
  const ins = await insertMemoryProposal(opts.client, {
    family_partition: v.value.family_partition,
    proposed_by: v.value.proposed_by,
    title: v.value.title,
    content_redacted: v.value.content,
    conversation_id: v.value.conversation_id ?? opts.conversationId ?? null,
    metadata: { ...v.value.metadata, ...(opts.extraMetadata ?? {}) },
  })
  if (!ins.ok) {
    return { inserted: false, skipReason: ins.error }
  }
  return { inserted: true, proposalId: ins.id }
}

export function councilSingleFamilyToMemoryPartition(family: string): MemoryFamilyPartition {
  switch (family) {
    case 'chatgpt':
      return 'ChatGPT Family'
    case 'claude':
      return 'Claude Family'
    case 'grok':
      return 'Grok Family'
    case 'gemini':
      return 'Gemini Family'
    case 'kimi':
      return 'Kimi Family'
    case 'red_team':
      return 'Red Team'
    case 'bridge_architect':
      return 'Bridge Architect'
    case 'baby':
      return 'Baby AI Observer'
    default:
      return 'ChatGPT Family'
  }
}
