import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { MemoryFamilyPartition } from '@/lib/memory/types'
import { isMemoryFamilyPartition } from '@/lib/memory/types'
import { insertMemoryProposal } from '@/lib/memory/store'
import { redactProposalContent, tryParseMemoryProposalLine, validateProposal } from '@/lib/memory/proposals'

/** When model output contains `MEMORY_PROPOSAL:{...}`, insert a pending row (never auto-approve). */
export async function tryPersistMemoryProposalFromModelOutput(opts: {
  client: WarRoomSupabase | null
  responseText: string
  fallbackPartition: MemoryFamilyPartition
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
  const family_partition = fpRaw && isMemoryFamilyPartition(fpRaw) ? fpRaw : opts.fallbackPartition
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
