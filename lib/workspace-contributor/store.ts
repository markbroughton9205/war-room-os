import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { WORKSPACE_ATTACHMENTS_BUCKET } from './attachments'
import {
  WORKSPACE_ROLE,
  type WorkspaceCommanderTransitionInput,
  type WorkspaceMember,
  type WorkspaceProposal,
  type WorkspaceProposalAttachment,
  type WorkspaceProposalEvent,
  type WorkspaceProposalInput,
  type WorkspaceProposalStatus,
  type WorkspaceSettings,
} from './types'

export type WorkspaceStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string }

export type WorkspaceStore = {
  getMember(userId: string): Promise<WorkspaceStoreResult<WorkspaceMember>>
  getSettings(userId: string): Promise<WorkspaceStoreResult<WorkspaceSettings>>
  upsertSettings(userId: string, settings: Omit<WorkspaceSettings, 'workspace_owner_id' | 'updated_at'>): Promise<WorkspaceStoreResult<WorkspaceSettings>>
  listProposals(userId: string): Promise<WorkspaceStoreResult<WorkspaceProposal[]>>
  listCommanderProposals(filters?: { status?: string | null; category?: string | null; owner?: string | null }): Promise<WorkspaceStoreResult<WorkspaceProposal[]>>
  getProposal(proposalId: string): Promise<WorkspaceStoreResult<WorkspaceProposal>>
  getOwnedProposal(userId: string, proposalId: string): Promise<WorkspaceStoreResult<WorkspaceProposal>>
  createProposal(userId: string, input: WorkspaceProposalInput): Promise<WorkspaceStoreResult<{ proposal: WorkspaceProposal; event: WorkspaceProposalEvent }>>
  updateDraftProposal(userId: string, proposalId: string, input: Partial<WorkspaceProposalInput>): Promise<WorkspaceStoreResult<WorkspaceProposal>>
  submitProposal(userId: string, proposalId: string, idempotencyKey: string): Promise<WorkspaceStoreResult<{ proposal: WorkspaceProposal; event: WorkspaceProposalEvent }>>
  commanderTransition(proposalId: string, commanderUserId: string, input: WorkspaceCommanderTransitionInput): Promise<WorkspaceStoreResult<{ proposal: WorkspaceProposal; event: WorkspaceProposalEvent }>>
  listEvents(proposalId: string): Promise<WorkspaceStoreResult<WorkspaceProposalEvent[]>>
  listAttachments(proposalId: string): Promise<WorkspaceStoreResult<WorkspaceProposalAttachment[]>>
  getAttachmentStorageUsage(userId: string): Promise<WorkspaceStoreResult<{ bytes: number }>>
  uploadAttachmentBytes(storagePath: string, bytes: Uint8Array, mimeType: string): Promise<WorkspaceStoreResult<{ uploaded: true }>>
  insertAttachment(input: Omit<WorkspaceProposalAttachment, 'attachment_id' | 'created_at'>): Promise<WorkspaceStoreResult<WorkspaceProposalAttachment>>
  deleteAttachmentObject(storagePath: string): Promise<WorkspaceStoreResult<{ deleted: true }>>
  deleteOwnedAttachment(userId: string, proposalId: string, attachmentId: string): Promise<WorkspaceStoreResult<{ deleted: true }>>
  getAttachment(attachmentId: string): Promise<WorkspaceStoreResult<WorkspaceProposalAttachment>>
  createSignedAttachmentUrl(storagePath: string): Promise<WorkspaceStoreResult<{ signedUrl: string }>>
}

export function createSupabaseWorkspaceStore(): WorkspaceStore {
  const admin = createSupabaseAdminClient()

  return {
    async getMember(userId) {
      const { data, error } = await admin.from('workspace_members').select('*').eq('workspace_owner_id', userId).maybeSingle()
      if (error) return failure(500, 'workspace_member_lookup_failed')
      if (!data) return failure(403, 'workspace_membership_required')
      return success(data as WorkspaceMember)
    },
    async getSettings(userId) {
      const { data, error } = await admin.from('workspace_settings').select('*').eq('workspace_owner_id', userId).maybeSingle()
      if (error) return failure(500, 'workspace_settings_lookup_failed')
      if (!data) {
        return success({
          workspace_owner_id: userId,
          layout: {},
          widgets: {},
          theme: {},
          enabled_tools: {},
          council_preferences: {},
          updated_at: new Date().toISOString(),
        })
      }
      return success(data as WorkspaceSettings)
    },
    async upsertSettings(userId, settings) {
      const { data, error } = await admin.from('workspace_settings').upsert({ workspace_owner_id: userId, ...settings, updated_at: new Date().toISOString() }).select('*').single()
      if (error) return failure(500, 'workspace_settings_update_failed')
      return success(data as WorkspaceSettings)
    },
    async listProposals(userId) {
      const { data, error } = await admin.from('workspace_proposals').select('*').eq('workspace_owner_id', userId).order('created_at', { ascending: false })
      if (error) return failure(500, 'workspace_proposals_lookup_failed')
      return success((data ?? []) as WorkspaceProposal[])
    },
    async listCommanderProposals(filters) {
      let query = admin.from('workspace_proposals').select('*').order('created_at', { ascending: false })
      if (filters?.status) query = query.eq('status', filters.status)
      if (filters?.category) query = query.eq('category', filters.category)
      if (filters?.owner) query = query.eq('workspace_owner_id', filters.owner)
      const { data, error } = await query
      if (error) return failure(500, 'commander_proposals_lookup_failed')
      return success((data ?? []) as WorkspaceProposal[])
    },
    async getProposal(proposalId) {
      const { data, error } = await admin.from('workspace_proposals').select('*').eq('proposal_id', proposalId).maybeSingle()
      if (error) return failure(500, 'workspace_proposal_lookup_failed')
      if (!data) return failure(404, 'proposal_not_found')
      return success(data as WorkspaceProposal)
    },
    async getOwnedProposal(userId, proposalId) {
      const { data, error } = await admin.from('workspace_proposals').select('*').eq('proposal_id', proposalId).eq('workspace_owner_id', userId).maybeSingle()
      if (error) return failure(500, 'workspace_proposal_lookup_failed')
      if (!data) return failure(404, 'proposal_not_found')
      return success(data as WorkspaceProposal)
    },
    async createProposal(userId, input) {
      const { data, error } = await admin.rpc('workspace_create_proposal', {
        p_workspace_owner_id: userId,
        p_title: input.title,
        p_description: input.description,
        p_category: input.category,
      })
      if (error) return failure(500, 'workspace_proposal_create_failed')
      return success(data as { proposal: WorkspaceProposal; event: WorkspaceProposalEvent })
    },
    async updateDraftProposal(userId, proposalId, input) {
      const existing = await this.getOwnedProposal(userId, proposalId)
      if (!existing.ok) return existing
      if (!['draft', 'revision_requested'].includes(existing.value.status)) return failure(409, 'proposal_not_editable')
      const { data, error } = await admin.from('workspace_proposals')
        .update({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('proposal_id', proposalId)
        .eq('workspace_owner_id', userId)
        .select('*')
        .single()
      if (error) return failure(500, 'workspace_proposal_update_failed')
      return success(data as WorkspaceProposal)
    },
    async submitProposal(userId, proposalId, idempotencyKey) {
      const { data, error } = await admin.rpc('workspace_transition_proposal', {
        p_proposal_id: proposalId,
        p_actor_user_id: userId,
        p_actor_role: WORKSPACE_ROLE,
        p_to_status: 'submitted',
        p_idempotency_key: idempotencyKey,
        p_reason: null,
        p_commander_decision: null,
        p_commander_decision_reason: null,
        p_implementation_ref: null,
      })
      if (error) return failure(409, workspaceTransitionError(error.message))
      return success(data as { proposal: WorkspaceProposal; event: WorkspaceProposalEvent })
    },
    async commanderTransition(proposalId, commanderUserId, input) {
      const { data, error } = await admin.rpc('workspace_transition_proposal', {
        p_proposal_id: proposalId,
        p_actor_user_id: commanderUserId,
        p_actor_role: 'commander',
        p_to_status: input.toStatus,
        p_idempotency_key: input.idempotencyKey,
        p_reason: input.reason ?? null,
        p_commander_decision: input.commanderDecision ?? null,
        p_commander_decision_reason: input.commanderDecisionReason ?? null,
        p_implementation_ref: input.implementationRef ?? null,
      })
      if (error) return failure(409, workspaceTransitionError(error.message))
      return success(data as { proposal: WorkspaceProposal; event: WorkspaceProposalEvent })
    },
    async listEvents(proposalId) {
      const { data, error } = await admin.from('workspace_proposal_events').select('*').eq('proposal_id', proposalId).order('created_at').order('event_id')
      if (error) return failure(500, 'workspace_events_lookup_failed')
      return success((data ?? []) as WorkspaceProposalEvent[])
    },
    async listAttachments(proposalId) {
      const { data, error } = await admin.from('workspace_proposal_attachments').select('*').eq('proposal_id', proposalId).order('created_at')
      if (error) return failure(500, 'workspace_attachments_lookup_failed')
      return success((data ?? []) as WorkspaceProposalAttachment[])
    },
    async getAttachmentStorageUsage(userId) {
      const { data, error } = await admin.from('workspace_proposal_attachments').select('size_bytes').eq('workspace_owner_id', userId)
      if (error) return failure(500, 'workspace_attachment_usage_lookup_failed')
      const bytes = (data ?? []).reduce((total, row) => total + Number(row.size_bytes ?? 0), 0)
      return success({ bytes })
    },
    async uploadAttachmentBytes(storagePath, bytes, mimeType) {
      const { error } = await admin.storage.from(WORKSPACE_ATTACHMENTS_BUCKET).upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: false,
      })
      if (error) return failure(500, 'workspace_attachment_upload_failed')
      return success({ uploaded: true })
    },
    async insertAttachment(input) {
      const { data, error } = await admin.from('workspace_proposal_attachments').insert(input).select('*').single()
      if (error) return failure(500, 'workspace_attachment_insert_failed')
      return success(data as WorkspaceProposalAttachment)
    },
    async deleteAttachmentObject(storagePath) {
      const { error } = await admin.storage.from(WORKSPACE_ATTACHMENTS_BUCKET).remove([storagePath])
      if (error) return failure(500, 'workspace_attachment_object_delete_failed')
      return success({ deleted: true })
    },
    async deleteOwnedAttachment(userId, proposalId, attachmentId) {
      const existing = await this.getOwnedProposal(userId, proposalId)
      if (!existing.ok) return existing as WorkspaceStoreResult<{ deleted: true }>
      const { data: attachment, error: lookupError } = await admin.from('workspace_proposal_attachments').select('*').eq('attachment_id', attachmentId).eq('proposal_id', proposalId).eq('workspace_owner_id', userId).maybeSingle()
      if (lookupError) return failure(500, 'workspace_attachment_lookup_failed')
      if (!attachment) return failure(404, 'attachment_not_found')
      const objectDeleted = await this.deleteAttachmentObject((attachment as WorkspaceProposalAttachment).storage_path)
      if (!objectDeleted.ok) return objectDeleted
      const { error } = await admin.from('workspace_proposal_attachments').delete().eq('attachment_id', attachmentId).eq('proposal_id', proposalId).eq('workspace_owner_id', userId)
      if (error) return failure(500, 'workspace_attachment_delete_failed')
      return success({ deleted: true })
    },
    async getAttachment(attachmentId) {
      const { data, error } = await admin.from('workspace_proposal_attachments').select('*').eq('attachment_id', attachmentId).maybeSingle()
      if (error) return failure(500, 'workspace_attachment_lookup_failed')
      if (!data) return failure(404, 'attachment_not_found')
      return success(data as WorkspaceProposalAttachment)
    },
    async createSignedAttachmentUrl(storagePath) {
      const { data, error } = await admin.storage.from(WORKSPACE_ATTACHMENTS_BUCKET).createSignedUrl(storagePath, 600)
      if (error || !data?.signedUrl) return failure(500, 'workspace_attachment_signed_url_failed')
      return success({ signedUrl: data.signedUrl })
    },
  }
}

export function success<T>(value: T): WorkspaceStoreResult<T> {
  return { ok: true, value }
}

export function failure(status: number, error: string): WorkspaceStoreResult<never> {
  return { ok: false, status, error }
}

function workspaceTransitionError(message: string): string {
  if (message.includes('idempotency_conflict')) return 'idempotency_conflict'
  if (message.includes('invalid_workspace_transition')) return 'invalid_workspace_transition'
  if (message.includes('proposal_owner_mismatch')) return 'proposal_owner_mismatch'
  if (message.includes('proposal_not_found')) return 'proposal_not_found'
  return 'workspace_proposal_transition_failed'
}

export function isWorkspaceProposalStatus(value: unknown): value is WorkspaceProposalStatus {
  return typeof value === 'string' && [
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
  ].includes(value)
}
