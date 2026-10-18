/**
 * Bounded execution resource governor around existing Foundry loops.
 * Does not rebuild router, broker, scheduler, replan, or contracts.
 * Never buys credits, never opens provider billing, and never silently raises budgets.
 */
import { randomUUID } from 'node:crypto'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'
import {
  appendContractEvent,
  listResourceBudgets,
  listResourceExtensions,
  listResourceUsage,
  loadActiveResourceBudget,
  loadActiveTaskResourceBudget,
  loadResourceUsageByAction,
  saveResourceBudget,
  saveResourceExtension,
  saveResourceUsage,
} from './foundryContractStore'
import {
  FOUNDRY_RESOURCE_SCHEMA_VERSION,
  FOUNDRY_RESOURCE_SOFT_RATIO,
  defaultResourceLimits,
  emptyResourceTotals,
  type FoundryResourceActionKind,
  type FoundryResourceBudget,
  type FoundryResourceCostState,
  type FoundryResourceDecision,
  type FoundryResourceLimits,
  type FoundryResourcePricing,
  type FoundryResourceTotals,
  type FoundryResourceUsage,
  type FoundryResourceView,
} from './foundryResourceGovernorTypes'

const pricingRegistry = new Map<string, FoundryResourcePricing>()

export function registerFoundryResourcePricing(pricing: FoundryResourcePricing): void {
  pricingRegistry.set(`${pricing.provider}:${pricing.model}`.toLowerCase(), pricing)
}

export function clearFoundryResourcePricing(): void {
  pricingRegistry.clear()
}

export function lookupFoundryResourcePricing(provider?: string | null, model?: string | null): FoundryResourcePricing | null {
  if (!provider || !model) return null
  const envRaw = process.env.FOUNDRY_RESOURCE_PRICING?.trim()
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw) as Record<string, { inputPer1kUsd: number; outputPer1kUsd: number }>
      const hit = parsed[`${provider}:${model}`] ?? parsed[provider]
      if (hit && Number.isFinite(hit.inputPer1kUsd) && Number.isFinite(hit.outputPer1kUsd)) {
        return { provider, model, inputPer1kUsd: hit.inputPer1kUsd, outputPer1kUsd: hit.outputPer1kUsd }
      }
    } catch {
      /* ignore malformed env; never invent */
    }
  }
  return pricingRegistry.get(`${provider}:${model}`.toLowerCase()) ?? null
}

export function isLocalResourceProvider(provider?: string | null): boolean {
  return provider === 'ollama' || provider === 'wrim'
}

function emit(missionId: string, type: Parameters<typeof appendContractEvent>[1], text: string, metadata?: Record<string, string | number | boolean | null>) {
  appendContractEvent(missionId, type, text, null, metadata)
}

function nowIso(): string {
  return new Date().toISOString()
}

function tickClock(budget: FoundryResourceBudget, at = Date.now()): FoundryResourceBudget {
  const last = budget.clock.lastTickAt ? Date.parse(budget.clock.lastTickAt) : at
  const delta = Math.max(0, at - (Number.isFinite(last) ? last : at))
  if (budget.clock.paused) budget.clock.pausedWaitMs += delta
  else budget.clock.activeExecutionMs += delta
  budget.clock.lastTickAt = new Date(at).toISOString()
  budget.totals.activeExecutionMs = budget.clock.activeExecutionMs
  budget.totals.pausedWaitMs = budget.clock.pausedWaitMs
  return budget
}

function ratio(used: number, limit?: number | null): number {
  if (!limit || limit <= 0) return 0
  return used / limit
}

function highestRatio(budget: FoundryResourceBudget): { key: string; value: number } {
  const pairs: Array<[string, number]> = [
    ['tokens', ratio(budget.totals.totalTokens, budget.limits.maxTotalTokens)],
    ['inputTokens', ratio(budget.totals.inputTokens, budget.limits.maxInputTokens)],
    ['outputTokens', ratio(budget.totals.outputTokens, budget.limits.maxOutputTokens)],
    ['modelCalls', ratio(budget.totals.modelCalls, budget.limits.maxModelCalls)],
    ['cost', ratio(budget.totals.estimatedCostUsd, budget.limits.maxEstimatedRemoteCostUsd)],
    ['tools', ratio(budget.totals.toolCalls, budget.limits.maxToolCalls)],
    ['terminal', ratio(budget.totals.terminalCalls, budget.limits.maxTerminalCalls)],
    ['tests', ratio(budget.totals.testRuns, budget.limits.maxTestRuns)],
    ['builds', ratio(budget.totals.buildRuns, budget.limits.maxBuildRuns)],
    ['browser', ratio(budget.totals.browserActions, budget.limits.maxBrowserActions)],
    ['computer', ratio(budget.totals.computerActions, budget.limits.maxComputerActions)],
    ['steers', ratio(budget.totals.steers, budget.limits.maxSteers)],
    ['taskReplans', ratio(budget.totals.taskReplans, budget.limits.maxTaskReplans)],
    ['dagReplans', ratio(budget.totals.dagReplans, budget.limits.maxDagReplans)],
    ['providerFailures', ratio(budget.totals.providerFailures, budget.limits.maxProviderFailures)],
    ['wallClock', ratio(budget.clock.activeExecutionMs, budget.limits.maxWallClockMs)],
  ]
  return pairs.reduce((best, [key, value]) => (value > best.value ? { key, value } : best), { key: 'none', value: 0 })
}

function projectedExceeds(limit: number | null | undefined, used: number, add: number): boolean {
  if (limit == null || limit < 0) return false
  return used + add > limit
}

export function refreshBudgetStatus(budget: FoundryResourceBudget): FoundryResourceBudget {
  if (budget.status === 'SUPERSEDED' || budget.status === 'PAUSED') return budget
  const top = highestRatio(budget)
  if (top.value >= 1) {
    if (budget.status !== 'EXHAUSTED' && budget.status !== 'HARD_LIMIT') {
      emit(budget.missionId, 'RESOURCE_HARD_LIMIT', `RESOURCE BUDGET EXHAUSTED (${top.key})`, { budgetId: budget.budgetId, metric: top.key })
      emit(budget.missionId, 'RESOURCE_BUDGET_EXHAUSTED', `Hard limit reached on ${top.key}. Commander action required.`, { budgetId: budget.budgetId })
    }
    budget.status = 'EXHAUSTED'
    return budget
  }
  if (top.value >= FOUNDRY_RESOURCE_SOFT_RATIO) {
    if (budget.status !== 'SOFT_LIMIT') {
      emit(budget.missionId, 'RESOURCE_SOFT_LIMIT', `RESOURCE BUDGET 80% USED (${top.key}). Foundry will continue within remaining authorized budget.`, { budgetId: budget.budgetId, metric: top.key })
    }
    budget.status = 'SOFT_LIMIT'
    return budget
  }
  budget.status = 'ACTIVE'
  return budget
}

export function createResourceBudget(input: {
  missionId: string
  graphId?: string | null
  taskId?: string | null
  scope?: FoundryResourceBudget['scope']
  limits?: Partial<FoundryResourceLimits>
  ensure?: boolean
}): FoundryResourceBudget {
  if (input.ensure) {
    const existing = loadActiveResourceBudget(input.missionId)
    if (existing && existing.status !== 'SUPERSEDED') return existing
  }
  const budget: FoundryResourceBudget = {
    schemaVersion: FOUNDRY_RESOURCE_SCHEMA_VERSION,
    budgetId: `RB-${randomUUID()}`,
    version: 1,
    missionId: input.missionId,
    graphId: input.graphId ?? null,
    taskId: input.taskId ?? null,
    scope: input.scope ?? 'MISSION',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    limits: {
      ...defaultResourceLimits(),
      ...(Number.isFinite(Number(process.env.FOUNDRY_DEFAULT_REMOTE_COST_USD)) && Number(process.env.FOUNDRY_DEFAULT_REMOTE_COST_USD) > 0
        ? { maxEstimatedRemoteCostUsd: Number(process.env.FOUNDRY_DEFAULT_REMOTE_COST_USD) }
        : {}),
      ...input.limits,
    },
    totals: emptyResourceTotals(),
    clock: { startedAt: nowIso(), lastTickAt: nowIso(), paused: false, pausedAt: null, activeExecutionMs: 0, pausedWaitMs: 0 },
    policy: { onSoftLimit: 'CHEAPER_PATH', onHardLimit: 'NEEDS_COMMANDER' },
    status: 'ACTIVE',
    costState: 'UNKNOWN',
    supersedesBudgetId: null,
    localRemoteCostUsd: 0,
  }
  saveResourceBudget(budget)
  emit(input.missionId, 'RESOURCE_BUDGET_CREATED', `Resource budget ${budget.budgetId} ACTIVE`, { budgetId: budget.budgetId, version: 1 })
  return budget
}

export function ensureResourceBudget(missionId: string, graphId?: string | null, limits?: Partial<FoundryResourceLimits>): FoundryResourceBudget {
  return createResourceBudget({ missionId, graphId, limits, ensure: true })
}

export function cheaperContinuationHint(budget: FoundryResourceBudget): string | null {
  if (budget.status !== 'SOFT_LIMIT') return null
  return 'Prefer deterministic tools, local model if policy permits, narrower context, and avoid repeated full builds/tests.'
}

export function contextCompressionHint(budget: FoundryResourceBudget): string | null {
  const tokenRatio = Math.max(
    ratio(budget.totals.totalTokens, budget.limits.maxTotalTokens),
    ratio(budget.totals.inputTokens, budget.limits.maxInputTokens),
  )
  if (tokenRatio < FOUNDRY_RESOURCE_SOFT_RATIO) return null
  return 'Bound provider prompt context: summarize older observations and retrieve narrower files. Do not erase authoritative mission history.'
}

function governingBudgets(input: {
  missionId: string
  kind: FoundryResourceActionKind
  graphId?: string | null
  taskId?: string | null
  createIfMissing?: boolean
}): FoundryResourceBudget[] {
  const mission = input.createIfMissing
    ? ensureResourceBudget(input.missionId, input.graphId)
    : loadActiveResourceBudget(input.missionId)
  const extras = listResourceBudgets(input.missionId).filter(item => {
    if (item.status === 'SUPERSEDED') return false
    if (mission && item.budgetId === mission.budgetId) return false
    if (item.scope === 'TASK') return Boolean(input.taskId && item.taskId === input.taskId)
    if (item.scope === 'PROVIDER') return input.kind === 'model'
    if (item.scope === 'TOOL_FAMILY') return ['tool', 'terminal', 'test', 'build', 'browser', 'computer'].includes(input.kind)
    if (item.scope === 'WALL_CLOCK') return true
    return false
  })
  if (input.taskId) {
    const taskBudget = loadActiveTaskResourceBudget(input.missionId, input.taskId)
    if (taskBudget && (!mission || taskBudget.budgetId !== mission.budgetId) && !extras.some(item => item.budgetId === taskBudget.budgetId)) {
      extras.push(taskBudget)
    }
  }
  return [mission, ...extras].filter((item): item is FoundryResourceBudget => Boolean(item))
}

function decideBudget(budget: FoundryResourceBudget, input: {
  kind: FoundryResourceActionKind
  estimatedTokens?: number
  estimatedCostUsd?: number
}): FoundryResourceDecision {
  tickClock(budget)
  if (budget.status === 'PAUSED' || budget.clock.paused) {
    saveResourceBudget(budget)
    return { ok: false, code: 'PAUSED', reason: 'Resource execution is paused.', budget }
  }
  const add = {
    model: input.kind === 'model' ? 1 : 0,
    tokens: input.kind === 'model' ? (input.estimatedTokens ?? 0) : 0,
    cost: input.estimatedCostUsd ?? 0,
    tool: ['tool', 'terminal', 'test', 'build', 'browser', 'computer'].includes(input.kind) ? 1 : 0,
    terminal: input.kind === 'terminal' ? 1 : 0,
    test: input.kind === 'test' ? 1 : 0,
    build: input.kind === 'build' ? 1 : 0,
    browser: input.kind === 'browser' ? 1 : 0,
    computer: input.kind === 'computer' ? 1 : 0,
    steer: input.kind === 'replan-l0' ? 1 : 0,
    taskReplan: input.kind === 'replan-l1' ? 1 : 0,
    dagReplan: input.kind === 'replan-l2' ? 1 : 0,
  }
  const hard =
    projectedExceeds(budget.limits.maxModelCalls, budget.totals.modelCalls, add.model)
    || projectedExceeds(budget.limits.maxTotalTokens, budget.totals.totalTokens, add.tokens)
    || projectedExceeds(budget.limits.maxInputTokens, budget.totals.inputTokens, add.tokens)
    || projectedExceeds(budget.limits.maxEstimatedRemoteCostUsd, budget.totals.estimatedCostUsd, add.cost)
    || projectedExceeds(budget.limits.maxToolCalls, budget.totals.toolCalls, add.tool)
    || projectedExceeds(budget.limits.maxTerminalCalls, budget.totals.terminalCalls, add.terminal)
    || projectedExceeds(budget.limits.maxTestRuns, budget.totals.testRuns, add.test)
    || projectedExceeds(budget.limits.maxBuildRuns, budget.totals.buildRuns, add.build)
    || projectedExceeds(budget.limits.maxBrowserActions, budget.totals.browserActions, add.browser)
    || projectedExceeds(budget.limits.maxComputerActions, budget.totals.computerActions, add.computer)
    || projectedExceeds(budget.limits.maxSteers, budget.totals.steers, add.steer)
    || projectedExceeds(budget.limits.maxTaskReplans, budget.totals.taskReplans, add.taskReplan)
    || projectedExceeds(budget.limits.maxDagReplans, budget.totals.dagReplans, add.dagReplan)
    || projectedExceeds(budget.limits.maxProviderFailures, budget.totals.providerFailures, 0)
    || projectedExceeds(budget.limits.maxWallClockMs, budget.clock.activeExecutionMs, 0)

  if (hard || budget.status === 'EXHAUSTED' || budget.status === 'HARD_LIMIT') {
    budget.status = 'EXHAUSTED'
    saveResourceBudget(budget)
    emit(budget.missionId, 'RESOURCE_BUDGET_EXHAUSTED', `RESOURCE_BUDGET_EXHAUSTED: ${input.kind} refused.`, { kind: input.kind, budgetId: budget.budgetId, scope: budget.scope })
    return {
      ok: false,
      code: 'RESOURCE_BUDGET_EXHAUSTED',
      reason: `RESOURCE_BUDGET_EXHAUSTED: ${input.kind} is not authorized. Commander must extend the budget.`,
      budget,
    }
  }
  refreshBudgetStatus(budget)
  saveResourceBudget(budget)
  if (budget.status === 'SOFT_LIMIT') {
    return {
      ok: true,
      code: 'SOFT_LIMIT',
      reason: 'RESOURCE BUDGET 80% USED. Foundry will continue within remaining authorized budget.',
      budget,
      cheaperPath: cheaperContinuationHint(budget),
      contextCompression: contextCompressionHint(budget),
    }
  }
  return { ok: true, code: 'ALLOWED', reason: 'authorized', budget, contextCompression: contextCompressionHint(budget) }
}

export function authorizeResourceAction(input: {
  missionId: string
  kind: FoundryResourceActionKind
  graphId?: string | null
  taskId?: string | null
  provider?: string | null
  model?: string | null
  estimatedTokens?: number
  estimatedCostUsd?: number
  createIfMissing?: boolean
}): FoundryResourceDecision {
  const budgets = governingBudgets(input)
  if (!budgets.length) return { ok: true, code: 'NO_BUDGET', reason: 'No resource budget; governor is not yet bound.', budget: null }
  let soft: FoundryResourceDecision | null = null
  for (const budget of budgets) {
    const decision = decideBudget(budget, input)
    if (!decision.ok) return decision
    if (decision.code === 'SOFT_LIMIT') soft = decision
  }
  return soft ?? { ok: true, code: 'ALLOWED', reason: 'authorized', budget: budgets[0], contextCompression: contextCompressionHint(budgets[0]) }
}

export function beginResourceUsage(input: {
  missionId: string
  kind: FoundryResourceActionKind
  actionId?: string
  graphId?: string | null
  taskId?: string | null
  provider?: string | null
  model?: string | null
  tool?: string | null
}): FoundryResourceUsage | null {
  const budget = loadActiveResourceBudget(input.missionId)
  if (!budget) return null
  const actionId = input.actionId ?? `RA-${randomUUID()}`
  const prior = loadResourceUsageByAction(actionId)
  if (prior) return prior
  const usage: FoundryResourceUsage = {
    schemaVersion: FOUNDRY_RESOURCE_SCHEMA_VERSION,
    usageId: `RU-${randomUUID()}`,
    actionId,
    missionId: input.missionId,
    budgetId: budget.budgetId,
    graphId: input.graphId ?? null,
    taskId: input.taskId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    tool: input.tool ?? null,
    kind: input.kind,
    startedAt: nowIso(),
    finishedAt: null,
    tokenSource: 'NONE',
    costState: 'UNKNOWN',
    toolCalls: 0,
    terminalCalls: 0,
    testRuns: 0,
    buildRuns: 0,
    browserActions: 0,
    computerActions: 0,
    providerFailures: 0,
    wallClockMs: 0,
    state: 'STARTED',
  }
  saveResourceUsage(usage)
  return usage
}

function applyUsageToTotals(totals: FoundryResourceTotals, usage: FoundryResourceUsage, previous?: FoundryResourceUsage | null): FoundryResourceTotals {
  const prev = previous && previous.state === 'COMPLETED' ? previous : null
  const delta = (next: number, old: number) => Math.max(0, next - old)
  return {
    ...totals,
    modelCalls: totals.modelCalls + (usage.kind === 'model' && !prev ? 1 : 0),
    inputTokens: totals.inputTokens + delta(usage.inputTokens ?? 0, prev?.inputTokens ?? 0),
    outputTokens: totals.outputTokens + delta(usage.outputTokens ?? 0, prev?.outputTokens ?? 0),
    totalTokens: totals.totalTokens + delta(usage.totalTokens ?? 0, prev?.totalTokens ?? 0),
    estimatedCostUsd: Number((totals.estimatedCostUsd + delta(usage.estimatedCostUsd ?? 0, prev?.estimatedCostUsd ?? 0)).toFixed(6)),
    actualCostUsd: usage.actualCostUsd != null
      ? Number(((totals.actualCostUsd ?? 0) + delta(usage.actualCostUsd, prev?.actualCostUsd ?? 0)).toFixed(6))
      : totals.actualCostUsd,
    toolCalls: totals.toolCalls + delta(usage.toolCalls, prev?.toolCalls ?? 0),
    terminalCalls: totals.terminalCalls + delta(usage.terminalCalls, prev?.terminalCalls ?? 0),
    testRuns: totals.testRuns + delta(usage.testRuns, prev?.testRuns ?? 0),
    buildRuns: totals.buildRuns + delta(usage.buildRuns, prev?.buildRuns ?? 0),
    browserActions: totals.browserActions + delta(usage.browserActions, prev?.browserActions ?? 0),
    computerActions: totals.computerActions + delta(usage.computerActions, prev?.computerActions ?? 0),
    providerFailures: totals.providerFailures + delta(usage.providerFailures, prev?.providerFailures ?? 0),
    steers: totals.steers + (usage.kind === 'replan-l0' && !prev ? 1 : 0),
    taskReplans: totals.taskReplans + (usage.kind === 'replan-l1' && !prev ? 1 : 0),
    dagReplans: totals.dagReplans + (usage.kind === 'replan-l2' && !prev ? 1 : 0),
    activeExecutionMs: totals.activeExecutionMs,
    pausedWaitMs: totals.pausedWaitMs,
  }
}

export function completeResourceUsage(input: {
  actionId: string
  missionId: string
  ok: boolean
  provider?: string | null
  model?: string | null
  tool?: string | null
  kind?: FoundryResourceActionKind
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  tokenSource?: FoundryResourceUsage['tokenSource']
  actualCostUsd?: number | null
  wallClockMs?: number
}): FoundryResourceUsage | null {
  const budget = loadActiveResourceBudget(input.missionId)
  if (!budget) return null
  const prior = loadResourceUsageByAction(input.actionId)
  if (prior?.state === 'COMPLETED') return prior
  const provider = input.provider ?? prior?.provider ?? null
  const model = input.model ?? prior?.model ?? null
  const local = isLocalResourceProvider(provider)
  const inputTokens = input.inputTokens ?? prior?.inputTokens ?? 0
  const outputTokens = input.outputTokens ?? prior?.outputTokens ?? 0
  const totalTokens = input.totalTokens ?? (inputTokens + outputTokens)
  const tokenSource = input.tokenSource ?? (input.inputTokens != null || input.outputTokens != null ? 'PROVIDER' : prior?.tokenSource ?? 'NONE')
  const pricing = lookupFoundryResourcePricing(provider, model)
  let costState: FoundryResourceCostState = 'UNKNOWN'
  let estimatedCostUsd: number | null = null
  let actualCostUsd: number | null = input.actualCostUsd ?? null
  if (local) {
    estimatedCostUsd = 0
    actualCostUsd = 0
    costState = 'ACTUAL'
    budget.localRemoteCostUsd = 0
  } else if (actualCostUsd != null) {
    costState = 'ACTUAL'
    estimatedCostUsd = actualCostUsd
  } else if (pricing && totalTokens > 0) {
    estimatedCostUsd = (inputTokens / 1000) * pricing.inputPer1kUsd + (outputTokens / 1000) * pricing.outputPer1kUsd
    costState = 'ESTIMATED'
  } else {
    costState = 'UNKNOWN'
  }
  const kind = input.kind ?? prior?.kind ?? 'tool'
  const usage: FoundryResourceUsage = {
    schemaVersion: FOUNDRY_RESOURCE_SCHEMA_VERSION,
    usageId: prior?.usageId ?? `RU-${randomUUID()}`,
    actionId: input.actionId,
    missionId: input.missionId,
    budgetId: budget.budgetId,
    graphId: prior?.graphId ?? null,
    taskId: prior?.taskId ?? null,
    provider,
    model,
    tool: input.tool ?? prior?.tool ?? null,
    kind,
    startedAt: prior?.startedAt ?? nowIso(),
    finishedAt: nowIso(),
    inputTokens,
    outputTokens,
    totalTokens,
    tokenSource,
    estimatedCostUsd,
    actualCostUsd,
    costState,
    toolCalls: ['tool', 'terminal', 'test', 'build', 'browser', 'computer'].includes(kind) ? 1 : 0,
    terminalCalls: kind === 'terminal' ? 1 : 0,
    testRuns: kind === 'test' ? 1 : 0,
    buildRuns: kind === 'build' ? 1 : 0,
    browserActions: kind === 'browser' ? 1 : 0,
    computerActions: kind === 'computer' ? 1 : 0,
    providerFailures: input.ok ? 0 : (kind === 'model' ? 1 : 0),
    wallClockMs: input.wallClockMs ?? (prior ? Math.max(0, Date.parse(nowIso()) - Date.parse(prior.startedAt)) : 0),
    state: 'COMPLETED',
  }
  if (!provider && kind === 'model') {
    emit(input.missionId, 'RESOURCE_USAGE_RECORDED', 'UNATTRIBUTED_PROVIDER_USAGE', { actionId: usage.actionId })
  }
  budget.totals = applyUsageToTotals(budget.totals, usage, prior)
  if (costState !== 'UNKNOWN') budget.costState = costState
  else if (budget.totals.estimatedCostUsd === 0 && budget.totals.actualCostUsd == null) budget.costState = 'UNKNOWN'
  tickClock(budget)
  refreshBudgetStatus(budget)
  budget.updatedAt = nowIso()
  saveResourceUsage(usage)
  saveResourceBudget(budget)
  for (const extra of governingBudgets({ missionId: input.missionId, kind, taskId: usage.taskId })) {
    if (extra.budgetId === budget.budgetId) continue
    extra.totals = applyUsageToTotals(extra.totals, usage, prior)
    if (costState !== 'UNKNOWN') extra.costState = costState
    tickClock(extra)
    refreshBudgetStatus(extra)
    extra.updatedAt = nowIso()
    saveResourceBudget(extra)
  }
  emit(input.missionId, 'RESOURCE_USAGE_RECORDED', `${kind} ${provider ?? 'unattributed'} tokens=${totalTokens} cost=${costState}`, {
    actionId: usage.actionId,
    provider: provider ?? '',
    model: model ?? '',
    kind,
  })
  return usage
}

export function refuseAutomaticBudgetIncrease(missionId: string, reason = 'Agent requested more budget.'): FoundryResourceDecision {
  const budget = loadActiveResourceBudget(missionId)
  emit(missionId, 'RESOURCE_BUDGET_EXHAUSTED', 'AUTOMATIC_BUDGET_INCREASE_REFUSED. Commander confirmation required.', { automatic: 0 })
  return {
    ok: false,
    code: 'AUTOMATIC_BUDGET_INCREASE_REFUSED',
    reason: `${reason} Foundry cannot automatically increase token, cost, or provider budgets.`,
    budget,
  }
}

export function extendResourceBudget(input: {
  missionId: string
  commanderConfirmed: boolean
  nextLimits: Partial<FoundryResourceLimits>
  reason?: string
}): FoundryResourceDecision {
  if (!input.commanderConfirmed) return refuseAutomaticBudgetIncrease(input.missionId, 'Budget extension lacks Commander confirmation.')
  const previous = loadActiveResourceBudget(input.missionId) ?? ensureResourceBudget(input.missionId)
  const snapshotLimits = { ...previous.limits }
  const snapshotTotals = { ...previous.totals }
  previous.status = 'SUPERSEDED'
  previous.updatedAt = nowIso()
  saveResourceBudget(previous)
  const next: FoundryResourceBudget = {
    ...previous,
    budgetId: `RB-${randomUUID()}`,
    version: previous.version + 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    limits: { ...previous.limits, ...input.nextLimits },
    totals: { ...previous.totals },
    clock: { ...previous.clock, paused: false, pausedAt: null, lastTickAt: nowIso() },
    status: 'ACTIVE',
    supersedesBudgetId: previous.budgetId,
  }
  refreshBudgetStatus(next)
  saveResourceBudget(next)
  const extension = {
    extensionId: `RX-${randomUUID()}`,
    budgetId: next.budgetId,
    missionId: input.missionId,
    previousVersion: previous.version,
    nextVersion: next.version,
    previousLimits: snapshotLimits,
    nextLimits: next.limits,
    previousTotals: snapshotTotals,
    commanderConfirmed: true as const,
    createdAt: nowIso(),
    reason: input.reason ?? 'Commander extended resource budget.',
  }
  saveResourceExtension(extension)
  emit(input.missionId, 'RESOURCE_BUDGET_EXTENDED', `Budget ${next.budgetId} v${next.version} replaced ${previous.budgetId}. Usage preserved.`, {
    previousBudgetId: previous.budgetId,
    budgetId: next.budgetId,
    version: next.version,
  })
  emit(input.missionId, 'RESOURCE_EXECUTION_RESUMED', 'Resource budget extended; execution may resume if no other blocker remains.', { budgetId: next.budgetId })
  return { ok: true, code: 'ALLOWED', reason: 'Commander extended the resource budget.', budget: next }
}

export function pauseResourceClock(missionId: string): FoundryResourceBudget | null {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) return null
  tickClock(budget)
  budget.clock.paused = true
  budget.clock.pausedAt = nowIso()
  budget.status = 'PAUSED'
  budget.updatedAt = nowIso()
  saveResourceBudget(budget)
  emit(missionId, 'RESOURCE_EXECUTION_PAUSED', 'Wall-clock budget paused while Commander paused execution.', { budgetId: budget.budgetId })
  return budget
}

export function resumeResourceClock(missionId: string): FoundryResourceBudget | null {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) return null
  tickClock(budget)
  budget.clock.paused = false
  budget.clock.pausedAt = null
  budget.clock.lastTickAt = nowIso()
  if (budget.status === 'PAUSED') budget.status = 'ACTIVE'
  refreshBudgetStatus(budget)
  budget.updatedAt = nowIso()
  saveResourceBudget(budget)
  emit(missionId, 'RESOURCE_EXECUTION_RESUMED', 'Resource wall-clock resumed.', { budgetId: budget.budgetId })
  return budget
}

export function recoverResourceBudget(missionId: string): FoundryResourceBudget | null {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) return null
  const usage = listResourceUsage(missionId)
  const totals = emptyResourceTotals()
  const seen = new Set<string>()
  for (const item of usage) {
    if (seen.has(item.actionId)) continue
    seen.add(item.actionId)
    if (item.state === 'COMPLETED' || item.state === 'STARTED') {
      Object.assign(totals, applyUsageToTotals(totals, item, null))
    }
  }
  totals.activeExecutionMs = budget.clock.activeExecutionMs
  totals.pausedWaitMs = budget.clock.pausedWaitMs
  budget.totals = totals
  budget.clock.lastTickAt = nowIso()
  refreshBudgetStatus(budget)
  saveResourceBudget(budget)
  return budget
}

export function missionMaxConcurrentAgents(missionId: string, schedulerMax: number): number {
  const budget = loadActiveResourceBudget(missionId)
  const missionMax = budget?.limits.maxConcurrentAgents
  if (missionMax == null) return schedulerMax
  return Math.max(1, Math.min(schedulerMax, missionMax))
}

export function resourceBudgetBlocksExecution(missionId: string): FoundryResourceDecision | null {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) return null
  tickClock(budget)
  refreshBudgetStatus(budget)
  saveResourceBudget(budget)
  if (budget.status === 'EXHAUSTED' || budget.status === 'HARD_LIMIT') {
    return {
      ok: false,
      code: 'RESOURCE_BUDGET_EXHAUSTED',
      reason: 'RESOURCE_BUDGET_EXHAUSTED. Commander action required.',
      budget,
    }
  }
  if (budget.status === 'PAUSED' || budget.clock.paused) {
    return { ok: false, code: 'PAUSED', reason: 'Resource execution is paused.', budget }
  }
  return { ok: true, code: budget.status === 'SOFT_LIMIT' ? 'SOFT_LIMIT' : 'ALLOWED', reason: 'authorized', budget, cheaperPath: cheaperContinuationHint(budget), contextCompression: contextCompressionHint(budget) }
}

export function stagnationShouldBlockForBudget(missionId: string): boolean {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) return false
  const top = highestRatio(tickClock(budget))
  return budget.status === 'EXHAUSTED' || top.value >= FOUNDRY_RESOURCE_SOFT_RATIO
}

export function classifyEngineerToolFamily(tool: string): FoundryResourceActionKind {
  if (tool.startsWith('browser.')) return 'browser'
  if (tool.startsWith('computer.')) return 'computer'
  if (tool === 'test.run' || tool === 'validation.run') return 'test'
  if (tool === 'build.run' || tool === 'typecheck.run' || tool === 'package.run') return 'build'
  if (tool.startsWith('terminal.') || tool.startsWith('process.')) return 'terminal'
  return 'tool'
}

function compactCount(used: number): string {
  if (used >= 1000) return `${Math.round(used / 100) / 10}k`
  return String(used)
}

export function buildResourceView(missionId: string): FoundryResourceView {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) {
    return {
      budgetId: null,
      status: 'NONE',
      costState: 'UNKNOWN',
      remoteCostLabel: 'COST UNKNOWN',
      localProvider: false,
      tokensUsed: 0,
      tokensLimit: null,
      modelCallsUsed: 0,
      modelCallsLimit: null,
      wallMsUsed: 0,
      wallMsLimit: null,
      testsUsed: 0,
      testsLimit: null,
      buildsUsed: 0,
      buildsLimit: null,
      replansUsed: 0,
      replansLimit: null,
      toolCallsUsed: 0,
      browserUsed: 0,
      computerUsed: 0,
      warning: null,
      providers: [],
    }
  }
  tickClock(budget)
  const usage = listResourceUsage(missionId)
  const byProvider = new Map<string, { provider: string; model: string; calls: number; tokens: number; cost: number; costState: FoundryResourceCostState }>()
  for (const item of usage.filter(row => row.kind === 'model' && row.state === 'COMPLETED')) {
    const key = `${item.provider ?? 'unattributed'}:${item.model ?? ''}`
    const current = byProvider.get(key) ?? { provider: item.provider ?? 'unattributed', model: item.model ?? '', calls: 0, tokens: 0, cost: 0, costState: item.costState }
    current.calls += 1
    current.tokens += item.totalTokens ?? 0
    current.cost += item.estimatedCostUsd ?? 0
    current.costState = item.costState
    byProvider.set(key, current)
  }
  const onlyLocal = [...byProvider.values()].length > 0 && [...byProvider.values()].every(item => isLocalResourceProvider(item.provider))
  let remoteCostLabel = 'COST UNKNOWN'
  if (onlyLocal) remoteCostLabel = '$0.00'
  else if (budget.costState === 'UNKNOWN' && budget.totals.estimatedCostUsd === 0) remoteCostLabel = 'COST UNKNOWN'
  else if (budget.costState === 'ESTIMATED') remoteCostLabel = `$${budget.totals.estimatedCostUsd.toFixed(2)} ESTIMATED`
  else if (budget.costState === 'ACTUAL' && budget.totals.actualCostUsd != null) remoteCostLabel = `$${budget.totals.actualCostUsd.toFixed(2)}`
  else if (budget.totals.estimatedCostUsd > 0) remoteCostLabel = `$${budget.totals.estimatedCostUsd.toFixed(2)} ESTIMATED`
  const warning = budget.status === 'EXHAUSTED' || budget.status === 'HARD_LIMIT'
    ? 'RESOURCE BUDGET EXHAUSTED'
    : budget.status === 'SOFT_LIMIT'
      ? 'RESOURCE BUDGET 80% USED'
      : null
  return {
    budgetId: budget.budgetId,
    status: budget.status,
    costState: budget.costState,
    remoteCostLabel,
    localProvider: onlyLocal,
    tokensUsed: budget.totals.totalTokens,
    tokensLimit: budget.limits.maxTotalTokens ?? null,
    modelCallsUsed: budget.totals.modelCalls,
    modelCallsLimit: budget.limits.maxModelCalls ?? null,
    wallMsUsed: budget.clock.activeExecutionMs,
    wallMsLimit: budget.limits.maxWallClockMs ?? null,
    testsUsed: budget.totals.testRuns,
    testsLimit: budget.limits.maxTestRuns ?? null,
    buildsUsed: budget.totals.buildRuns,
    buildsLimit: budget.limits.maxBuildRuns ?? null,
    replansUsed: budget.totals.steers + budget.totals.taskReplans + budget.totals.dagReplans,
    replansLimit: (budget.limits.maxDagReplans ?? 0) + (budget.limits.maxTaskReplans ?? 0) + (budget.limits.maxSteers ?? 0) || null,
    toolCallsUsed: budget.totals.toolCalls,
    browserUsed: budget.totals.browserActions,
    computerUsed: budget.totals.computerActions,
    warning,
    providers: [...byProvider.values()].map(item => ({
      provider: item.provider,
      model: item.model,
      calls: item.calls,
      tokens: item.tokens,
      costLabel: isLocalResourceProvider(item.provider)
        ? '$0.00'
        : item.costState === 'UNKNOWN' && item.cost === 0
          ? 'COST UNKNOWN'
          : `$${item.cost.toFixed(2)} ${item.costState === 'ESTIMATED' ? 'ESTIMATED' : ''}`.trim(),
    })),
  }
}

export function formatResourceMeter(used: number, limit: number | null, kind: 'tokens' | 'calls' | 'ms' | 'usd' | 'count'): string {
  if (kind === 'ms') {
    const usedM = Math.round(used / 60000)
    const limitM = limit != null ? Math.round(limit / 60000) : null
    return limitM == null ? `${usedM}m` : `${usedM}m / ${limitM}m`
  }
  if (kind === 'tokens') return limit == null ? compactCount(used) : `${compactCount(used)} / ${compactCount(limit)}`
  if (kind === 'usd') return limit == null ? `$${used.toFixed(2)}` : `$${used.toFixed(2)} / $${limit.toFixed(2)}`
  return limit == null ? String(used) : `${used} / ${limit}`
}

export function attachResourceViewToGraph(graph: FoundryCommandCenterGraph): FoundryCommandCenterGraph {
  graph.resourceView = buildResourceView(graph.missionId)
  graph.resourceBudgetId = graph.resourceView.budgetId
  return graph
}

export function listBudgetHistory(missionId: string) {
  return { budgets: listResourceBudgets(missionId), usage: listResourceUsage(missionId) }
}

export function listBudgetExtensions(budgetId: string) {
  return listResourceExtensions(budgetId)
}

export { compactCount }
