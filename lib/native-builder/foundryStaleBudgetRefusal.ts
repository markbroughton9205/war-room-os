import { loadActiveResourceBudget } from './foundryContractStore'
import type { FoundryMissionRecord } from './foundryMissionTypes'

/**
 * A RESOURCE_BUDGET_EXHAUSTED refusal is true when it happens and stale once the Commander has extended that budget: the governor then
 * holds a newer ACTIVE version with headroom. The old refusal stays in the mission history (audit), but it must not steer a decision, or a
 * model that reads it will keep choosing BLOCKED after the budget is fixed. A refusal recorded at or after the extension is current.
 */
export const BUDGET_REFUSAL_PATTERN = /RESOURCE_BUDGET_EXHAUSTED|resource budget exhausted/i

export type BudgetExtensionCurrency = { budgetId: string; version: number; extendedAtMs: number }

/** The extension that makes older refusals stale, or null when there is no healthy superseding budget. */
export function budgetExtensionCurrency(missionId: string): BudgetExtensionCurrency | null {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget || !budget.supersedesBudgetId || budget.version < 2) return null
  if (budget.status !== 'ACTIVE' && budget.status !== 'SOFT_LIMIT') return null
  if (budget.clock.paused) return null
  const extendedAtMs = Date.parse(budget.createdAt)
  if (!Number.isFinite(extendedAtMs)) return null
  return { budgetId: budget.budgetId, version: budget.version, extendedAtMs }
}

export function isStaleBudgetRefusal(text: string | undefined, at: string, currency: BudgetExtensionCurrency | null): boolean {
  if (!currency || !text || !BUDGET_REFUSAL_PATTERN.test(text)) return false
  const atMs = Date.parse(at)
  return Number.isFinite(atMs) && atMs < currency.extendedAtMs
}

export function staleBudgetRefusalMarker(currency: BudgetExtensionCurrency): string {
  return `STALE_BUDGET_REFUSAL: an earlier budget refusal was resolved when the Commander extended the budget (${currency.budgetId} v${currency.version}, ACTIVE). It is kept in the mission history only. Do not treat it as a blocker; continue the NEXT_REQUIRED_ACTION.`
}

/** Flag superseded refusals on the tool-call records (text is kept untouched). Returns how many records were newly flagged. */
export function markStaleBudgetRefusals(mission: FoundryMissionRecord): number {
  const currency = budgetExtensionCurrency(mission.missionId)
  if (!currency) return 0
  let marked = 0
  for (const call of mission.toolCalls) {
    if (call.staleBudgetRefusal) continue
    if (isStaleBudgetRefusal(`${call.error ?? ''} ${call.excerpt ?? ''}`, call.at, currency)) {
      call.staleBudgetRefusal = { resolvedByBudgetId: currency.budgetId, version: currency.version }
      marked += 1
    }
  }
  return marked
}

/** True when a budget refusal was recorded after the extension: that one is current and must still block. */
export function hasCurrentBudgetRefusal(mission: FoundryMissionRecord, currency: BudgetExtensionCurrency): boolean {
  const current = (text: string | undefined, at: string) => {
    if (!text || !BUDGET_REFUSAL_PATTERN.test(text)) return false
    const atMs = Date.parse(at)
    return !Number.isFinite(atMs) || atMs >= currency.extendedAtMs
  }
  return mission.toolCalls.some(call => current(`${call.error ?? ''} ${call.excerpt ?? ''}`, call.at))
    || mission.observations.some(observation => current(observation.text, observation.at))
}

/** True when a BLOCKED decision rests only on a stale budget refusal (the budget is extended and nothing newer was refused). */
export function blockedOnStaleBudgetRefusal(mission: FoundryMissionRecord, decisionText: string): BudgetExtensionCurrency | null {
  if (!BUDGET_REFUSAL_PATTERN.test(decisionText) && !/budget/i.test(decisionText)) return null
  const currency = budgetExtensionCurrency(mission.missionId)
  if (!currency || hasCurrentBudgetRefusal(mission, currency)) return null
  return currency
}
