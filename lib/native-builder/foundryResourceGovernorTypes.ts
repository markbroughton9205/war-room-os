/**
 * Execution resource budgets for Standalone Engineer.
 * Capability does not grant resource authority. No billing/credit actions.
 */
export const FOUNDRY_RESOURCE_SCHEMA_VERSION = 1 as const

export const FOUNDRY_RESOURCE_BUDGET_STATUSES = [
  'ACTIVE',
  'SOFT_LIMIT',
  'HARD_LIMIT',
  'PAUSED',
  'EXHAUSTED',
  'SUPERSEDED',
] as const
export type FoundryResourceBudgetStatus = (typeof FOUNDRY_RESOURCE_BUDGET_STATUSES)[number]

export const FOUNDRY_RESOURCE_SCOPES = ['MISSION', 'TASK', 'PROVIDER', 'TOOL_FAMILY', 'WALL_CLOCK'] as const
export type FoundryResourceScope = (typeof FOUNDRY_RESOURCE_SCOPES)[number]

export const FOUNDRY_RESOURCE_COST_STATES = ['ACTUAL', 'ESTIMATED', 'UNKNOWN'] as const
export type FoundryResourceCostState = (typeof FOUNDRY_RESOURCE_COST_STATES)[number]

export const FOUNDRY_RESOURCE_LIMIT_POLICIES = ['CONTINUE', 'CHEAPER_PATH', 'PAUSE', 'NEEDS_COMMANDER', 'BLOCK'] as const
export type FoundryResourceLimitPolicy = (typeof FOUNDRY_RESOURCE_LIMIT_POLICIES)[number]

export const FOUNDRY_RESOURCE_ACTION_KINDS = [
  'model',
  'tool',
  'terminal',
  'test',
  'build',
  'browser',
  'computer',
  'replan-l0',
  'replan-l1',
  'replan-l2',
] as const
export type FoundryResourceActionKind = (typeof FOUNDRY_RESOURCE_ACTION_KINDS)[number]

export const FOUNDRY_RESOURCE_USAGE_STATES = ['STARTED', 'COMPLETED', 'DROPPED'] as const
export type FoundryResourceUsageState = (typeof FOUNDRY_RESOURCE_USAGE_STATES)[number]

/** Conservative Standalone Engineer defaults. Commander may raise them. No universal dollar doctrine. */
export const FOUNDRY_RESOURCE_DEFAULT_LIMITS = {
  maxWallClockMs: 2 * 60 * 60 * 1000,
  maxModelCalls: 40,
  maxInputTokens: 100_000,
  maxOutputTokens: 50_000,
  maxTotalTokens: 150_000,
  maxEstimatedRemoteCostUsd: null as number | null,
  maxToolCalls: 80,
  maxTerminalCalls: 24,
  maxTestRuns: 12,
  maxBuildRuns: 6,
  maxBrowserActions: 20,
  maxComputerActions: 20,
  maxSteers: 4,
  maxTaskReplans: 3,
  maxDagReplans: 3,
  maxProviderFailures: 6,
  maxConcurrentAgents: 4,
} as const

export const FOUNDRY_RESOURCE_SOFT_RATIO = 0.8 as const

export type FoundryResourceLimits = {
  maxWallClockMs?: number | null
  maxModelCalls?: number | null
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  maxTotalTokens?: number | null
  maxEstimatedRemoteCostUsd?: number | null
  maxToolCalls?: number | null
  maxTerminalCalls?: number | null
  maxTestRuns?: number | null
  maxBuildRuns?: number | null
  maxBrowserActions?: number | null
  maxComputerActions?: number | null
  maxSteers?: number | null
  maxTaskReplans?: number | null
  maxDagReplans?: number | null
  maxProviderFailures?: number | null
  maxConcurrentAgents?: number | null
}

export type FoundryResourceTotals = {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  actualCostUsd: number | null
  toolCalls: number
  terminalCalls: number
  testRuns: number
  buildRuns: number
  browserActions: number
  computerActions: number
  providerFailures: number
  steers: number
  taskReplans: number
  dagReplans: number
  activeExecutionMs: number
  pausedWaitMs: number
}

export type FoundryResourceClock = {
  startedAt: string | null
  lastTickAt: string | null
  paused: boolean
  pausedAt: string | null
  activeExecutionMs: number
  pausedWaitMs: number
}

export type FoundryResourceBudget = {
  schemaVersion: typeof FOUNDRY_RESOURCE_SCHEMA_VERSION
  budgetId: string
  version: number
  missionId: string
  graphId: string | null
  taskId: string | null
  scope: FoundryResourceScope
  createdAt: string
  updatedAt: string
  limits: FoundryResourceLimits
  totals: FoundryResourceTotals
  clock: FoundryResourceClock
  policy: {
    onSoftLimit: FoundryResourceLimitPolicy
    onHardLimit: FoundryResourceLimitPolicy
  }
  status: FoundryResourceBudgetStatus
  costState: FoundryResourceCostState
  supersedesBudgetId?: string | null
  localRemoteCostUsd: number
}

export type FoundryResourceUsage = {
  schemaVersion: typeof FOUNDRY_RESOURCE_SCHEMA_VERSION
  usageId: string
  actionId: string
  missionId: string
  budgetId: string
  graphId?: string | null
  taskId?: string | null
  provider?: string | null
  model?: string | null
  tool?: string | null
  kind: FoundryResourceActionKind
  startedAt: string
  finishedAt: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  tokenSource: 'PROVIDER' | 'ESTIMATED' | 'NONE'
  estimatedCostUsd?: number | null
  actualCostUsd?: number | null
  costState: FoundryResourceCostState
  toolCalls: number
  terminalCalls: number
  testRuns: number
  buildRuns: number
  browserActions: number
  computerActions: number
  providerFailures: number
  wallClockMs: number
  state: FoundryResourceUsageState
}

export type FoundryResourceExtension = {
  extensionId: string
  budgetId: string
  missionId: string
  previousVersion: number
  nextVersion: number
  previousLimits: FoundryResourceLimits
  nextLimits: FoundryResourceLimits
  previousTotals: FoundryResourceTotals
  commanderConfirmed: true
  createdAt: string
  reason: string
}

export type FoundryResourcePricing = {
  provider: string
  model: string
  inputPer1kUsd: number
  outputPer1kUsd: number
}

export type FoundryResourceDecision = {
  ok: boolean
  code: 'ALLOWED' | 'SOFT_LIMIT' | 'RESOURCE_BUDGET_EXHAUSTED' | 'NO_BUDGET' | 'PAUSED' | 'AUTOMATIC_BUDGET_INCREASE_REFUSED'
  reason: string
  budget: FoundryResourceBudget | null
  cheaperPath?: string | null
  contextCompression?: string | null
}

export type FoundryResourceView = {
  budgetId: string | null
  status: FoundryResourceBudgetStatus | 'NONE'
  costState: FoundryResourceCostState
  remoteCostLabel: string
  localProvider: boolean
  tokensUsed: number
  tokensLimit: number | null
  modelCallsUsed: number
  modelCallsLimit: number | null
  wallMsUsed: number
  wallMsLimit: number | null
  testsUsed: number
  testsLimit: number | null
  buildsUsed: number
  buildsLimit: number | null
  replansUsed: number
  replansLimit: number | null
  toolCallsUsed: number
  browserUsed: number
  computerUsed: number
  warning: 'RESOURCE BUDGET 80% USED' | 'RESOURCE BUDGET EXHAUSTED' | null
  providers: Array<{ provider: string; model: string; calls: number; tokens: number; costLabel: string }>
}

export function emptyResourceTotals(): FoundryResourceTotals {
  return {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    actualCostUsd: null,
    toolCalls: 0,
    terminalCalls: 0,
    testRuns: 0,
    buildRuns: 0,
    browserActions: 0,
    computerActions: 0,
    providerFailures: 0,
    steers: 0,
    taskReplans: 0,
    dagReplans: 0,
    activeExecutionMs: 0,
    pausedWaitMs: 0,
  }
}

export function defaultResourceLimits(): FoundryResourceLimits {
  return {
    maxWallClockMs: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxWallClockMs,
    maxModelCalls: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxModelCalls,
    maxInputTokens: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxInputTokens,
    maxOutputTokens: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxOutputTokens,
    maxTotalTokens: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTotalTokens,
    maxEstimatedRemoteCostUsd: null,
    maxToolCalls: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxToolCalls,
    maxTerminalCalls: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTerminalCalls,
    maxTestRuns: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTestRuns,
    maxBuildRuns: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxBuildRuns,
    maxBrowserActions: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxBrowserActions,
    maxComputerActions: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxComputerActions,
    maxSteers: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxSteers,
    maxTaskReplans: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTaskReplans,
    maxDagReplans: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxDagReplans,
    maxProviderFailures: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxProviderFailures,
    maxConcurrentAgents: FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxConcurrentAgents,
  }
}
