export type LocalAgentEngineId =
  | 'ollama'
  | 'lm_studio'
  | 'openhands'
  | 'aider'
  | 'continue'
  | 'goose'

export type LocalAgentEngineStatus =
  | 'detected'
  | 'not_detected'
  | 'config_needed'
  | 'reachable'
  | 'unreachable'
  | 'error'

export type LocalModelProvider = 'ollama' | 'lm_studio'

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
  | 'code-repair'
  | 'coding-review'
  | 'realtime-signals'
  | 'planning'
  | 'risk-review'
  | 'risk-analysis'
  | 'task-decomposition'
  | 'diff-explanation'
  | 'diff-review'
  | 'rollback-planning'
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
  modelsReachable?: boolean
  chatCompletionsReachable?: boolean
  functional?: boolean
  lastFunctionalTestAt?: string | null
  error?: string | null
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

export type LocalLMStudioModel = {
  id: string
  object: string | null
  ownedBy: string | null
}

export type LocalProviderAvailability = {
  provider: LocalModelProvider
  detected: boolean
  reachable: boolean
  functional: boolean
  models: Array<LocalOllamaModel | LocalLMStudioModel>
  error: string | null
}

export type LocalFamilyAgentAvailability = LocalFamilyAgent & {
  modelInstalled: boolean
  provider: LocalModelProvider
  model: string
  detected: boolean
  functional: boolean
}

export type LocalFamilyAgentsResponse = {
  ollamaDetected: boolean
  lmStudioDetected: boolean
  availableModels: LocalOllamaModel[]
  lmStudioModels: LocalLMStudioModel[]
  providers: {
    ollama: LocalProviderAvailability
    lmStudio: LocalProviderAvailability
  }
  preferredProvider: LocalModelProvider | null
  preferredModel: string | null
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
