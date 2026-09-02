import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type {
  ContextAssemblerStore,
  MemoryRecordRow,
  MessageRow,
  NewContextSnapshotRow,
  OpenLoopRow,
  PromptArtifactRow,
  ProjectRow,
  SessionSummaryRow,
  WorldKnowledgeRow,
} from './types'

/** Real Supabase-backed ContextAssemblerStore. Every method fails soft (returns null/[]) when
 * Supabase is unavailable or a query errors — the Context Assembler is an inspectable side
 * channel, not load-bearing for the primary chat response, so it must never throw into a caller
 * that's mid-way through returning a Commander-facing reply. */
export function createSupabaseContextAssemblerStore(): ContextAssemblerStore {
  return {
    async getConversation(conversationId) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return null
      const { data } = await sup.client
        .from('war_room_conversations')
        .select('id,active_project_id')
        .eq('id', conversationId)
        .maybeSingle()
      return data ? { id: data.id as string, active_project_id: (data.active_project_id as string) ?? null } : null
    },

    async getProject(projectId) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return null
      const { data } = await sup.client
        .from('war_room_projects')
        .select('id,name,description,status,current_objective,current_phase')
        .eq('id', projectId)
        .maybeSingle()
      return (data as ProjectRow | null) ?? null
    },

    async getOpenLoops(projectId) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return []
      const { data } = await sup.client
        .from('war_room_open_loops')
        .select('id,title,description,status,priority,blocked_by,next_action,updated_at')
        .eq('project_id', projectId)
        .order('priority', { ascending: false })
        .order('updated_at', { ascending: true })
        .limit(20)
      return (data as OpenLoopRow[] | null) ?? []
    },

    async getLatestSessionSummary(conversationId) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return null
      const { data } = await sup.client
        .from('war_room_session_summaries')
        .select('id,summary,unfinished_tasks,next_recommended_action,decisions,key_decrees')
        .eq('session_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return (data as SessionSummaryRow | null) ?? null
    },

    async getActiveMemoryRecords(scope, projectId) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return []
      let query = sup.client
        .from('war_room_memory_records')
        .select('id,content,memory_type,scope,status,effective_from,importance_tier')
        .eq('scope', scope)
        .eq('status', 'active')
        .order('effective_from', { ascending: false })
        .limit(20)
      query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null)
      const { data } = await query
      return (data as MemoryRecordRow[] | null) ?? []
    },

    async getRecentPromptArtifacts(conversationId, limit) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return []
      const { data } = await sup.client
        .from('war_room_prompt_artifacts')
        .select('id,intent,target_agent_id,status,created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit)
      return (data as PromptArtifactRow[] | null) ?? []
    },

    async getRecentMessages(conversationId, limit) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return []
      const { data } = await sup.client
        .from('war_room_messages')
        .select('id,role,content,created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit)
      return ((data as MessageRow[] | null) ?? []).slice().reverse()
    },

    async getActiveWorldKnowledge(projectId, limit) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return []
      let query = sup.client
        .from('war_room_world_knowledge_records')
        .select('id,content,status,confidence,scope')
        .eq('status', 'active')
        .order('valid_from', { ascending: false })
        .limit(limit)
      query = projectId ? query.or(`scope.eq.global,project_id.eq.${projectId}`) : query.eq('scope', 'global')
      const { data } = await query
      return (data as WorldKnowledgeRow[] | null) ?? []
    },

    async insertContextSnapshot(row: NewContextSnapshotRow) {
      const sup = tryWarRoomSupabase()
      if (!sup.ok) return null
      const { data } = await sup.client
        .from('war_room_context_snapshots')
        .insert(row)
        .select('id,conversation_id,project_id,assembled_at,model_target,token_estimate,content_hash,ranking_version,retrieval_strategy_version,included_source_ids,excluded_source_ids,budget_breakdown')
        .single()
      return data ?? null
    },
  }
}
