export type BuildRequestType = 'feature' | 'bugfix' | 'refactor' | 'research' | 'deployment'

export type BuildRequestStatus = 'drafted' | 'reviewing' | 'ready' | 'blocked' | 'completed'

export type BuildPriority = 'low' | 'medium' | 'high'

export type AgentConnectionLabel = 'Available/manual' | 'Not connected' | 'Standby' | 'Future integration'

export type BuildRequest = {
  id: string
  request_id: string
  title: string
  description: string
  type: BuildRequestType
  status: BuildRequestStatus
  assigned_agent: string | null
  created_at: string
  updated_at?: string
  completed_at?: string | null
  priority: BuildPriority
  notes?: string | null
  /** True when the row exists only in browser memory (Supabase unavailable). */
  local_only?: boolean
}

export type BuildAgentDefinition = {
  id: string
  name: string
  role: string
  connection_label: AgentConnectionLabel
}
