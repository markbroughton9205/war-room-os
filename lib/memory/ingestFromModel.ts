import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { MemoryFamilyPartition } from '@/lib/memory/types'
import { isMemoryFamilyPartition } from '@/lib/memory/types'
import { insertMemoryProposal } from '@/lib/memory/store'
import { redactProposalContent, tryParseMemoryProposalLine, validateProposal } from '@/lib/memory/proposals'
import { agentMayWriteMemoryScope } from '@/lib/council/nebula/memory'
import { nebulaAgentForSeat } from '@/lib/council/nebula/identity'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/**
 * When model output contains `MEMORY_PROPOSAL:{...}`, insert a pending row (never auto-approve).
 *
 * MEMORY-14 enforcement (audit finding: agentMayWriteMemoryScope was exported but never called
 * from this, the actual durable-proposal path): the model's own response text can self-report a
 * `family_partition` in its MEMORY_PROPOSAL JSON, and the live war_room_memory_proposals schema has
 * no separate scope/owner column to check it against - family_partition IS the only "who does this
 * belong to" field that exists. Before this fix, a self-reported partition that happened to be a
 * valid enum member (e.g. "Red Team") was accepted even if a DIFFERENT seat (e.g. ORION/claude)
 * was the one actually emitting the response - the model could claim to speak for another family.
 * `emittingSeat` is the real, caller-known identity of whichever seat generated `responseText`
 * (execute.ts always has this - it's the same seat used to compute `fallbackPartition` in the
 * first place), and is now checked BEFORE insertion: a self-reported partition that disagrees with
 * it is rejected outright, not silently corrected. Separately, agentMayWriteMemoryScope (the
 * pre-existing, never-invoked Nebula scope policy) is now actually called as defense-in-depth: this
 * durable multi-family-visible proposal store is treated as 'mission' scope, which
 * DEFAULT_ALLOWED_SCOPES grants to every Nebula agent today (so no currently-working agent is
 * newly blocked), while 'commander'/'global' remain categorically unwritable exactly as that
 * function already defined - no new scope rule is introduced here.
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

  const nebulaAgentId = opts.emittingSeat ? nebulaAgentForSeat(opts.emittingSeat)?.id ?? null : null
  if (nebulaAgentId && !agentMayWriteMemoryScope(nebulaAgentId, 'mission')) {
    return { inserted: false, skipReason: 'scope_not_authorized' }
  }

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
