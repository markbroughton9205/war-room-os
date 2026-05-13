export type LocalAgentEngineId =
  | 'ollama'
  | 'lm_studio'
  | 'openhands'
  | 'aider'
  | 'continue'
  | 'goose'

export type LocalAgentEngineStatus = 'detected' | 'not_detected' | 'error'

export type LocalAgentBridgeStatus = 'online' | 'config_needed' | 'error'

export type LocalAgentTaskLifecycle =
  | 'requested'
  | 'planned'
  | 'diff_ready'
  | 'qa_running'
  | 'approval_required'
  | 'approved'
  | 'applied'
  | 'committed'
  | 'failed'
  | 'rolled_back'

export type LocalFamilyAgentStatus = 'planned' | 'inactive' | 'available'

export type LocalTaskCategory =
  | 'synthesis'
  | 'architecture'
  | 'coding-review'
  | 'realtime-signals'
  | 'planning'
  | 'risk-analysis'
  | 'diff-review'
  | 'qa-review'

export type LocalAgentEngine = {
  id: LocalAgentEngineId
  name: string
  description: string
  defaultEndpoint: string | null
  configurable: boolean
}

export type LocalAgentStatusEntry = {
  id: LocalAgentEngineId
  name: string
  status: LocalAgentEngineStatus
  endpoint: string | null
  message: string
}

export type LocalAgentBridgeStatusResponse = {
  bridge: LocalAgentBridgeStatus
  engines: Record<LocalAgentEngineId, LocalAgentStatusEntry>
  selectedEngine: LocalAgentEngineId | null
  repoAccessStatus: string
  lastTask: string | null
  qaStatus: string
  rollbackCheckpointStatus: string
  checkedAt: string
}

export type LocalFamilyAgent = {
  id: string
  family: string
  displayName: string
  role: string
  preferredModel: string
  status: LocalFamilyAgentStatus
  internetAccess: false
  requiresApproval: true
  canExecuteCode: false
  canModifyFiles: false
  notes: string
}

export type LocalOllamaModel = {
  name: string
  family: string | null
  parameterSize: string | null
  quantization: string | null
}

export type LocalFamilyAgentAvailability = LocalFamilyAgent & {
  modelInstalled: boolean
}

export type LocalFamilyAgentsResponse = {
  ollamaDetected: boolean
  availableModels: LocalOllamaModel[]
  familyAgents: LocalFamilyAgentAvailability[]
  checkedAt: string
}

export type LocalTaskRoutingDecision = {
  taskCategory: LocalTaskCategory
  selectedFamily: string
  selectedAgent: LocalFamilyAgent
  selectedModel: string
  modelInstalled: boolean
  approvalRequired: true
  canExecute: false
  reasoning: string
  recommendedNextStep: string
  recommendedSupportingAgents: LocalFamilyAgent[]
}
