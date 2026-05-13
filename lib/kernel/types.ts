export type Capability =
  | 'research'
  | 'decompose'
  | 'synthesize'
  | 'criticize'
  | 'execute'
  | 'remember'
  | 'notify'
  | 'deploy'
  | 'verify'
  | 'extract'
  | 'scout'
  | 'approve'
  | 'code'
  | 'debug'
  | 'analyze_repo'
  | 'communicate'
  | 'orchestrate'
  | 'architecture'
  | 'realtime_research'
  | 'signal_detection'
  | 'task_sequencing'
  | 'risk_check'
  | 'pattern_learning'
  | 'patch_planning'

export type AgentFamily =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'kimi'
  | 'red_team'
  | 'baby_ai'
  | 'codex_local'
  | 'opportunity_scout'
  | 'repo_analyst'

export type KernelEventType =
  | 'decree.created'
  | 'tool.requested'
  | 'research.started'
  | 'research.completed'
  | 'opportunity.found'
  | 'opportunity.assigned'
  | 'action.required'
  | 'approval.granted'
  | 'memory.recommended'
  | 'memory.saved'
  | 'build.requested'
  | 'build.completed'
  | 'deployment.requested'
  | 'deployment.completed'
  | 'error.raised'

export type ToolStatus = 'idle' | 'scanning' | 'active' | 'complete' | 'error'

export type ApprovalRisk =
  | 'low'
  | 'medium'
  | 'high'
  | 'financial'
  | 'legal'
  | 'identity'
  | 'deployment'

export type MemoryIntent =
  | 'temporary'
  | 'session'
  | 'operational'
  | 'strategic'
  | 'permanent'
  | 'archived'

export type KernelEvent = {
  type: KernelEventType
  source: AgentFamily | 'system' | 'rael'
  createdAt: string
  capability?: Capability
  status?: ToolStatus
  risk?: ApprovalRisk
  summary: string
  payload?: Record<string, unknown>
}

export type RoutingDecision = {
  capability: Capability
  primaryFamily: AgentFamily
  supportingFamilies: AgentFamily[]
  approvalRisk: ApprovalRisk
  reason: string
  autonomousExecutionAllowed: false
}
