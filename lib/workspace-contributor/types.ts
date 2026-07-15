export const WORKSPACE_ROLE = 'workspace_contributor' as const

export const WORKSPACE_PROPOSAL_CATEGORIES = ['feature', 'ui', 'workflow', 'council_behavior'] as const
export const WORKSPACE_PROPOSAL_STATUSES = [
  'draft',
  'submitted',
  'contributor_review',
  'commander_council_review',
  'revision_requested',
  'approved',
  'rejected',
  'implemented',
  'verified',
  'closed',
] as const

export const WORKSPACE_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const

export type WorkspaceRole = typeof WORKSPACE_ROLE
export type WorkspaceProposalCategory = (typeof WORKSPACE_PROPOSAL_CATEGORIES)[number]
export type WorkspaceProposalStatus = (typeof WORKSPACE_PROPOSAL_STATUSES)[number]
export type WorkspaceActorRole = 'workspace_contributor' | 'commander'
export type WorkspaceAttachmentMimeType = (typeof WORKSPACE_ATTACHMENT_MIME_TYPES)[number]

export type WorkspaceMember = {
  workspace_owner_id: string
  role: WorkspaceRole
  ai_access_enabled: boolean
  created_at: string
  updated_at: string
}

export type WorkspaceSettings = {
  workspace_owner_id: string
  layout: Record<string, unknown>
  widgets: Record<string, unknown>
  theme: Record<string, unknown>
  enabled_tools: Record<string, unknown>
  council_preferences: Record<string, unknown>
  updated_at: string
}

export type WorkspaceProposal = {
  proposal_id: string
  workspace_owner_id: string
  title: string
  description: string
  category: WorkspaceProposalCategory
  status: WorkspaceProposalStatus
  contributor_review_summary: string | null
  commander_council_summary: string | null
  commander_decision: string | null
  commander_decision_reason: string | null
  decided_by_user_id: string | null
  decided_at: string | null
  implementation_ref: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export type WorkspaceProposalEvent = {
  event_id: string
  proposal_id: string
  workspace_owner_id: string
  event_sequence: number
  idempotency_key: string
  event_type: string
  from_status: WorkspaceProposalStatus | null
  to_status: WorkspaceProposalStatus
  actor_user_id: string
  actor_role: WorkspaceActorRole
  reason: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type WorkspaceProposalAttachment = {
  attachment_id: string
  proposal_id: string
  workspace_owner_id: string
  storage_path: string
  original_filename: string
  mime_type: WorkspaceAttachmentMimeType
  size_bytes: number
  content_sha256: string
  uploaded_by_user_id: string
  created_at: string
}

export type WorkspaceProposalInput = {
  title: string
  description: string
  category: WorkspaceProposalCategory
}

export type WorkspaceCommanderTransitionInput = {
  toStatus: WorkspaceProposalStatus
  idempotencyKey: string
  reason?: string | null
  commanderDecision?: string | null
  commanderDecisionReason?: string | null
  implementationRef?: string | null
}

export type WorkspaceAttachmentInput = {
  file: File
  originalFilename: string
  mimeType: string
  sizeBytes: number
}
