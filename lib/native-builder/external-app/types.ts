export const EXTERNAL_APP_TOOL_NAMES = [
  'external_app.discover',
  'external_app.focus',
  'external_app.insert_text',
  'external_app.observe',
  'external_app.cancel',
  'external_app.status',
  'cursor.submit_prompt',
  'cursor.observe_generation',
  'cursor.read_response',
] as const

export type ExternalAppToolName = (typeof EXTERNAL_APP_TOOL_NAMES)[number]

export function isExternalAppToolName(value: string): value is ExternalAppToolName {
  return (EXTERNAL_APP_TOOL_NAMES as readonly string[]).includes(value)
}

export type ExternalBackendId =
  | 'accessibility'
  | 'app-electron-debug'
  | 'wayland-portal'
  | 'wayland-atspi-focus'
  | 'wayland-atspi-keysynth'
  | 'vision'

export type ExternalRiskClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'COMMANDER_ONLY'

export type ExternalSafetyClass = 'SAFE_AUTONOMOUS' | 'COMMANDER_APPROVAL_REQUIRED' | 'BLOCKED'

export type RegisteredExternalApp = {
  appId: string
  processIdentity: string[]
  desktopIdentity: string[]
  allowedWindowPatterns: string[]
  supportedBackends: ExternalBackendId[]
  supportedActions: string[]
  riskClassification: ExternalRiskClass
  interactionBoundaries: string[]
}

export type ExternalWindowIdentity = {
  appId: string
  appName: string
  title: string
  role?: string
  screen?: { x: number; y: number; width: number; height: number }
  pidHints?: number[]
  wayland: boolean
  backend: ExternalBackendId
}

export type ExternalTargetBinding = {
  bindingId: string
  application: string
  windowIdentity: ExternalWindowIdentity
  frameGeneration: string
  semanticTarget: string
  boundingRegion: { x: number; y: number; width: number; height: number }
  expectedRole: string
  expectedState: string
  screenshotPath?: string
  timestamp: string
  cdp?: {
    origin: string
    targetId: string
    wsUrl: string
    role: string
    accessibleName: string
    domIdentity: string
    frameId: string
    workspaceIdentity: string
  }
}

export type ExternalMissionBinding = {
  missionId: string
  taskId: string
  projectId: string
  cursorWorkspaceIdentity: string | null
  promptHash: string
  submissionTimestamp: string | null
  responseHash: string | null
}

export type CommanderAttentionRequired = {
  kind: 'COMMANDER_ATTENTION_REQUIRED'
  reason: string
  missionId: string
  taskId: string
  application: string
  requestedAction: string
  risk: ExternalRiskClass
  currentState: string
  whatFoundryNeeds: string
  resumeToken: string
}

export type ExternalActionResult = {
  ok: boolean
  tool: ExternalAppToolName | string
  backend?: ExternalBackendId | string
  actionSuccess?: boolean
  stateSuccess?: boolean
  result?: unknown
  error?: string
  attention?: CommanderAttentionRequired
  binding?: ExternalTargetBinding | null
}

export type ExternalAuditRecord = {
  application: string
  backend: string
  target: string
  action: string
  expectedState: string
  observedState: string
  mission: string
  task: string
  timestamp: string
  result: 'ACTION_SUCCESS' | 'STATE_SUCCESS' | 'FAIL' | 'BLOCKED' | 'ATTENTION_REQUIRED' | 'CANCELLED'
}
