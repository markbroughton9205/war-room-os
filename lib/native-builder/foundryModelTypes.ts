import type { EngineerToolName } from './engineerTools'
import type {
  FoundryMissionKind,
  FoundryMissionPermissions,
  FoundryMissionState,
  FoundryMissionStep,
} from './foundryMissionTypes'

export type FoundryModelProviderId =
  | 'cursor-agent'
  | 'openai'
  | 'cursor-agent'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'kimi'
  | 'deepseek'
  | 'openai-compatible'
  | 'ollama'
  | 'wrim'

export type FoundryModelDecisionKind = 'TOOL' | 'REPLAN' | 'COMPLETE' | 'BLOCKED'

export type FoundryHypothesisStatus = 'OPEN' | 'SUPPORTED' | 'REJECTED' | 'CONFIRMED'

export type FoundryHypothesis = {
  id: string
  statement: string
  evidenceFor: string[]
  evidenceAgainst: string[]
  status: FoundryHypothesisStatus
  createdAt: string
  updatedAt: string
}

export type FoundryPlanChanges = {
  goal?: string
  successCriteria?: string[]
  add?: Array<Pick<FoundryMissionStep, 'id' | 'intent' | 'title'>>
  removeStepIds?: string[]
  reorderStepIds?: string[]
  hypotheses?: Array<{
    id?: string
    statement: string
    status: FoundryHypothesisStatus
    evidenceFor?: string[]
    evidenceAgainst?: string[]
  }>
  findings?: string[]
}

export type FoundryModelDecision = {
  decision: FoundryModelDecisionKind
  reasoningSummary: string
  tool?: {
    name: EngineerToolName
    args: Record<string, unknown>
  }
  planChanges?: FoundryPlanChanges
  blocker?: {
    blocker: string
    evidence: string
    attempted: string
    why: string
    unblock: string
  }
  expectedObservation?: string
  toolNameNormalized?: boolean
}

export type FoundryModelToolDescription = {
  name: EngineerToolName
  purpose: string
  args: Record<string, string>
  required: string[]
  permission: keyof FoundryMissionPermissions | 'none'
  mutating: boolean
  result: string
}

export type FoundryModelContext = {
  missionId: string
  missionKind: FoundryMissionKind
  userRequest: string
  goal: string
  successCriteria: string[]
  constraints: string[]
  permissions: FoundryMissionPermissions
  phase: FoundryMissionState
  plan: Array<{ id: string; title: string; status: FoundryMissionStep['status'] }>
  hypotheses: FoundryHypothesis[]
  changedFiles: string[]
  importantFindings: string[]
  relevantExcerpts: Array<{ source: string; text: string }>
  visualEvidence: string[]
  recentToolResults: Array<{ tool: string; ok: boolean; reason: string; excerpt?: string; error?: string }>
  recentErrors: Array<{ klass: string; message: string }>
  unresolvedQuestions: string[]
  completionGate: { complete: boolean; missing: string[]; detail: string }
  loopWarning?: string
  tools: FoundryModelToolDescription[]
  boundedRetryLock?: {
    currentState: 'BOUNDED_RETRY'
    requiredTool: 'file.replace_unique'
    currentAnchorId: string
    currentPath: string
  }
}

export type FoundryModelRequestKind =
  | 'reasonMission'
  | 'chooseNextAction'
  | 'diagnoseFailure'
  | 'replan'
  | 'summarizeProgress'

export type FoundryModelRequest = {
  kind: FoundryModelRequestKind
  context: FoundryModelContext
  abortSignal?: AbortSignal
}

export type FoundryWorkerDiagnostics = {
  provider?: string
  model?: string | null
  checkpointId?: string
  checkpointHash?: string
  tokenizerId?: string
  tokenizerHash?: string
  device?: string
  generatedTokenIds?: number[]
  generatedTokenCount?: number
  finishReason?: string
  collapsed?: boolean
  transportSuccess?: boolean
  reasoningUsable?: boolean
  capabilityStatus?: string
  pythonBridge?: string
  runtime?: string
  networkRequired?: false
  mock?: false
}

export type FoundryModelResponse =
  | {
      ok: true
      provider: FoundryModelProviderId
      model: string
      decision: FoundryModelDecision
      rawText: string
      latencyMs: number
      workerDiagnostics?: FoundryWorkerDiagnostics
    }
  | {
      ok: false
      provider: FoundryModelProviderId
      model: string | null
      error: string
      failureClass: 'UNAVAILABLE' | 'TIMEOUT' | 'CONTEXT_LIMIT' | 'MALFORMED' | 'PROVIDER'
      latencyMs: number
      workerDiagnostics?: FoundryWorkerDiagnostics
    }

export interface FoundryMissionModel {
  readonly provider: FoundryModelProviderId
  readonly model: string | null
  reasonMission(request: FoundryModelRequest): Promise<FoundryModelResponse>
  chooseNextAction(request: FoundryModelRequest): Promise<FoundryModelResponse>
  diagnoseFailure(request: FoundryModelRequest): Promise<FoundryModelResponse>
  replan(request: FoundryModelRequest): Promise<FoundryModelResponse>
  summarizeProgress(request: FoundryModelRequest): Promise<FoundryModelResponse>
}

export type FoundryModelRuntimeState = {
  primaryProvider: FoundryModelProviderId | null
  activeProvider: FoundryModelProviderId | null
  activeModel: string | null
  fallbackProvider: FoundryModelProviderId | null
  calls: number
  invalidResponses: number
  providerFailures: number
  consecutiveFailures: number
  repeatedActionCount: number
  lastDecision: FoundryModelDecision | null
  lastReasoningSummary: string | null
  lastExpectedObservation: string | null
}
