import { extractJsonObject } from './localCoder'
import type {
  FoundryHypothesisStatus,
  FoundryModelDecision,
  FoundryPlanChanges,
} from './foundryModelTypes'
import type { FoundryMissionPermissions } from './foundryMissionTypes'
import { validateModelToolRequest } from './foundryToolCatalog'
import { LOCAL_MODEL_DEFAULT_REASONING } from './foundryLocalModelRuntime'
import { normalizeBoundedRetryToolName } from './foundryBoundedRetry'

const DECISIONS = new Set(['TOOL', 'REPLAN', 'COMPLETE', 'BLOCKED'])
const HYPOTHESIS_STATES = new Set<FoundryHypothesisStatus>(['OPEN', 'SUPPORTED', 'REJECTED', 'CONFIRMED'])
const PLAN_INTENTS = new Set([
  'UNDERSTAND', 'SEARCH', 'READ', 'MAP', 'IMPACT', 'BASELINE', 'PATCH_SOURCE', 'PATCH_TESTS',
  'SELF_REVIEW', 'TEST', 'DIAGNOSE', 'REGRESSION', 'LINT',
  'TYPECHECK', 'LAUNCH', 'BROWSER_VERIFY', 'COMPUTER_VERIFY', 'SELF_CHECK', 'BUILD',
  'PACKAGE', 'INSTALL', 'ACTIVATE', 'TRANSITION', 'IDENTITY', 'COMPLETE',
])

function strings(value: unknown, max = 40): string[] | undefined {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined
  return value.slice(0, max)
}

function parsePlanChanges(value: unknown): FoundryPlanChanges | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const hypotheses = Array.isArray(raw.hypotheses)
    ? raw.hypotheses.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const h = item as Record<string, unknown>
        if (typeof h.statement !== 'string' || !HYPOTHESIS_STATES.has(h.status as FoundryHypothesisStatus)) return []
        return [{
          id: typeof h.id === 'string' ? h.id : undefined,
          statement: h.statement.slice(0, 1_000),
          status: h.status as FoundryHypothesisStatus,
          evidenceFor: strings(h.evidenceFor, 20),
          evidenceAgainst: strings(h.evidenceAgainst, 20),
        }]
      })
    : undefined
  const add = Array.isArray(raw.add)
    ? raw.add.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const step = item as Record<string, unknown>
        if (typeof step.id !== 'string' || typeof step.intent !== 'string' || !PLAN_INTENTS.has(step.intent) || typeof step.title !== 'string') return []
        return [{ id: step.id.slice(0, 80), intent: step.intent as never, title: step.title.slice(0, 300) }]
      })
    : undefined
  return {
    goal: typeof raw.goal === 'string' ? raw.goal.slice(0, 2_000) : undefined,
    successCriteria: strings(raw.successCriteria, 30),
    add,
    removeStepIds: strings(raw.removeStepIds, 30),
    reorderStepIds: strings(raw.reorderStepIds, 60),
    hypotheses,
    findings: strings(raw.findings, 30),
  }
}

export function parseAndValidateModelDecision(
  rawText: string,
  permissions: FoundryMissionPermissions,
  allowedToolNames?: ReadonlySet<string>,
  boundedRetryLock?: {
    currentState: 'BOUNDED_RETRY'
    requiredTool: 'file.replace_unique'
    currentAnchorId: string
  },
): { ok: true; decision: FoundryModelDecision } | { ok: false; error: string } {
  const raw = extractJsonObject(rawText)
  if (!raw) return { ok: false, error: 'Model response is not a JSON object.' }
  const decisionValue = typeof raw.decision === 'string' ? raw.decision.trim().toUpperCase() : ''
  if (!DECISIONS.has(decisionValue)) {
    return { ok: false, error: 'decision must be TOOL, REPLAN, COMPLETE, or BLOCKED.' }
  }
  const summary = typeof raw.reasoningSummary === 'string' && raw.reasoningSummary.trim()
    ? raw.reasoningSummary.trim().slice(0, 2_000)
    : LOCAL_MODEL_DEFAULT_REASONING

  const decision: FoundryModelDecision = {
    decision: decisionValue as FoundryModelDecision['decision'],
    reasoningSummary: summary,
    expectedObservation: typeof raw.expectedObservation === 'string' ? raw.expectedObservation.slice(0, 1_000) : undefined,
    planChanges: parsePlanChanges(raw.planChanges ?? raw.plan),
  }

  if (decision.decision === 'TOOL') {
    if (!raw.tool || typeof raw.tool !== 'object' || Array.isArray(raw.tool)) {
      return { ok: false, error: 'TOOL decision requires tool object.' }
    }
    const request = raw.tool as Record<string, unknown>
    if (typeof request.name !== 'string') return { ok: false, error: 'tool.name must be a string.' }
    const rawArgs = request.args && typeof request.args === 'object' && !Array.isArray(request.args)
      ? request.args as Record<string, unknown>
      : {}
    const normalized = normalizeBoundedRetryToolName({
      state: boundedRetryLock?.currentState,
      requestedName: request.name,
      args: rawArgs,
      currentAnchorId: boundedRetryLock?.currentAnchorId,
      onlyOneLegalTool: Boolean(boundedRetryLock && allowedToolNames?.size === 1 && allowedToolNames.has('file.replace_unique')),
    })
    const name = normalized.name
    const checked = validateModelToolRequest(name, rawArgs, permissions)
    if (!checked.ok) return checked
    if (allowedToolNames && !allowedToolNames.has(checked.name)) {
      const lockAllowsIllegal = Boolean(
        boundedRetryLock?.currentState === 'BOUNDED_RETRY'
        && (checked.name === 'file.read' || checked.name === 'workspace.search' || checked.name === 'file.replace_unique'),
      )
      if (!lockAllowsIllegal) {
        return { ok: false, error: `Tool "${checked.name}" was not exposed for this reasoning turn.` }
      }
    }
    decision.tool = { name: checked.name, args: checked.args }
    decision.toolNameNormalized = normalized.normalized
  }

  if (decision.decision === 'BLOCKED') {
    if (typeof raw.blocker === 'string' && raw.blocker.trim()) {
      const why = raw.blocker.trim().slice(0, 2_000)
      decision.blocker = { blocker: why, evidence: why, attempted: summary, why, unblock: 'Provide missing evidence or a valid next TOOL.' }
    } else if (!raw.blocker || typeof raw.blocker !== 'object' || Array.isArray(raw.blocker)) {
      return { ok: false, error: 'BLOCKED decision requires structured blocker evidence.' }
    } else {
      const blocker = raw.blocker as Record<string, unknown>
      const keys = ['blocker', 'evidence', 'attempted', 'why', 'unblock'] as const
      if (keys.some(key => typeof blocker[key] !== 'string' || !(blocker[key] as string).trim())) {
        return { ok: false, error: 'BLOCKED requires blocker, evidence, attempted, why, and unblock strings.' }
      }
      decision.blocker = Object.fromEntries(keys.map(key => [key, (blocker[key] as string).slice(0, 2_000)])) as FoundryModelDecision['blocker']
    }
  }

  if (decision.decision === 'COMPLETE' && decision.tool) {
    return { ok: false, error: 'COMPLETE cannot include a tool request.' }
  }
  return { ok: true, decision }
}
