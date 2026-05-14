/** Display / storage partition for family-scoped approved memory. */
export const MEMORY_FAMILY_PARTITIONS = [
  'ChatGPT Family',
  'Claude Family',
  'Grok Family',
  'Gemini Family',
  'Kimi Family',
  'Red Team',
  'Bridge Architect',
  'Baby AI Observer',
] as const

export type MemoryFamilyPartition = (typeof MEMORY_FAMILY_PARTITIONS)[number]

export function isMemoryFamilyPartition(value: string): value is MemoryFamilyPartition {
  return (MEMORY_FAMILY_PARTITIONS as readonly string[]).includes(value)
}

export type MemoryProposalStatus = 'pending' | 'approved' | 'rejected'

/** Pending or historical proposal (JSON-safe; no raw secrets — use redacted content fields). */
export type MemoryProposal = {
  id: string
  created_at: string
  updated_at?: string
  family_partition: MemoryFamilyPartition
  proposed_by: string
  title: string
  content_redacted: string
  status: MemoryProposalStatus
  metadata: Record<string, unknown>
  conversation_id: string | null
}

export type ApprovedMemory = {
  id: string
  approved_at: string
  family_partition: MemoryFamilyPartition
  title: string
  content: string
  source_proposal_id: string | null
  metadata: Record<string, unknown>
}

/** Read-only mission continuity payload (no secrets). */
export type OperationalMemorySnapshot = {
  activeMission?: {
    conversationId: string | null
    title: string | null
    state: string | null
    lastMessageAt: string | null
  }
  platformSummaryRefs?: {
    permissionMode: string | null
    safetyLock: boolean | null
    lastAutoActionAt: string | null
    lastAutoActionKind: string | null
  }
  incomeOps?: {
    activeOpportunityCount: number
    newestDiscoveredAt: string | null
  }
  agentAssignments?: {
    pendingApprovalCount: number
    recentActionTypeSample: string[]
  }
  recurringPriorities?: string[]
}

export type MemoryContextSnippet = {
  id: string
  approved_at: string
  family_partition: MemoryFamilyPartition
  title: string
  preview: string
}

export type MemoryContextResponse = {
  partition: MemoryFamilyPartition | null
  limit: number
  snippets: MemoryContextSnippet[]
  familyContext: string
  operational: OperationalMemorySnapshot
  operationalNote?: string
}
