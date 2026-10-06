/**
 * Stale budget-refusal recovery: a RESOURCE_BUDGET_EXHAUSTED refusal recorded before the Commander extended the budget is resolved for decision-making
 * (marker in the model context, BLOCKED refused) and kept in the history; a refusal recorded at or after the extension, or an exhausted budget, still blocks.
 * Real Resource Governor (create / exhaust / extend / authorize) on an isolated contracts root, real model-context builder and gate evaluator.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'stale-budget-'))
mkdirSync(path.join(tmp, 'base'), { recursive: true })
Object.assign(process.env, { REPO_ROOT: path.join(tmp, 'base'), FOUNDRY_CONTRACTS_ROOT: path.join(tmp, 'contracts'), WAR_ROOM_LOCAL_DATA_DIR: path.join(tmp, 'app-data') })

const { createResourceBudget, extendResourceBudget, authorizeResourceAction } = await import('./foundryResourceGovernor')
const { saveResourceBudget, loadActiveResourceBudget } = await import('./foundryContractStore')
const { startMissionInput } = await import('./foundryMissionController')
const { buildFoundryModelContext } = await import('./foundryModelContext')
const { evaluateBlockedDecision } = await import('./foundryEngineeringGateTable')
const { budgetExtensionCurrency, markStaleBudgetRefusals, hasCurrentBudgetRefusal, isStaleBudgetRefusal } = await import('./foundryStaleBudgetRefusal')

const REFUSAL = 'RESOURCE_BUDGET_EXHAUSTED: tool is not authorized. Commander must extend the budget.'
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()
const BLOCK = { reasoningSummary: 'tool is not authorized. Commander must extend the budget.', blocker: { blocker: 'tool is not authorized. Commander must extend the budget.', evidence: 'resource budget exhausted', why: 'budget' } } as never

/** A mission whose model-call allowance is spent (the real governor refuses), then optionally extended by the Commander. */
function missionWithBudget(label: string, extend: boolean) {
  const mission = startMissionInput(`Fix add in calc.mjs (${label})`, label, {})
  createResourceBudget({ missionId: mission.missionId, limits: { maxModelCalls: 2 } })
  const spent = loadActiveResourceBudget(mission.missionId)!
  spent.totals.modelCalls = 2
  saveResourceBudget(spent)
  assert.equal(authorizeResourceAction({ missionId: mission.missionId, kind: 'model' }).code, 'RESOURCE_BUDGET_EXHAUSTED', 'the governor refuses the spent budget')
  mission.toolCalls.push({ at: ago(60_000), tool: 'file.replace_unique', ok: false, reason: 'retry', error: REFUSAL, excerpt: REFUSAL })
  mission.errors.push({ at: ago(60_000), klass: 'PROVIDER' as never, message: `Model response rejected (PROVIDER): ${REFUSAL}` })
  if (extend) {
    const decision = extendResourceBudget({ missionId: mission.missionId, commanderConfirmed: true, nextLimits: { maxModelCalls: 5 }, reason: 'validator' })
    assert.equal(decision.ok, true)
  }
  return mission
}
const contextOf = (mission: ReturnType<typeof missionWithBudget>) => buildFoundryModelContext(mission)

// 1. Old refusal + healthy superseding budget: the model sees a resolved marker, the mission can continue (BLOCKED on it is refused), history intact.
{
  const m = missionWithBudget('stale', true)
  const before = JSON.stringify(m.toolCalls.map(c => [c.at, c.tool, c.error, c.excerpt]))
  const errorsBefore = m.errors.length
  const context = contextOf(m)
  const seen = JSON.stringify(context.recentToolResults) + JSON.stringify(context.recentErrors)
  assert.ok(!/RESOURCE_BUDGET_EXHAUSTED/.test(seen), `no raw refusal in the model context: ${seen}`)
  assert.ok(seen.includes('STALE_BUDGET_REFUSAL'), 'a resolved marker replaces it')
  assert.equal(context.recentErrors.length, 0, 'the stale refusal no longer influences recent errors')
  const verdict = evaluateBlockedDecision(m, BLOCK)
  assert.equal(verdict.allowed, false)
  assert.ok(verdict.compact.includes('STALE_BUDGET_REFUSAL') && verdict.compact.includes('Do not BLOCKED'), verdict.compact)
  assert.equal(markStaleBudgetRefusals(m), 1)
  assert.equal(markStaleBudgetRefusals(m), 0, 'marking is idempotent')
  assert.ok(m.toolCalls[0].staleBudgetRefusal, 'the record is flagged resolved')
  assert.equal(JSON.stringify(m.toolCalls.map(c => [c.at, c.tool, c.error, c.excerpt])), before, 'flagging keeps every historical byte')
  assert.equal(m.errors.length, errorsBefore, 'no error record was removed')
  ok('1: stale refusal + healthy superseding budget => resolved marker, BLOCKED refused, history preserved')
}

// 2. A current refusal still blocks: governor refuses again and a refusal recorded after the extension keeps the mission blocked.
{
  const m = missionWithBudget('current', true)
  m.toolCalls.push({ at: ahead(5_000), tool: 'file.replace_unique', ok: false, reason: 'again', error: REFUSAL, excerpt: REFUSAL })
  const currency = budgetExtensionCurrency(m.missionId)!
  assert.equal(hasCurrentBudgetRefusal(m, currency), true)
  const context = contextOf(m)
  const last = context.recentToolResults.at(-1)!
  assert.ok(String(last.error).includes('RESOURCE_BUDGET_EXHAUSTED'), 'the current refusal is shown raw')
  assert.ok(!evaluateBlockedDecision(m, BLOCK).compact.includes('STALE_BUDGET_REFUSAL'), 'the stale guard does not fire on a current refusal (existing gate-table rules apply unchanged)')
  assert.equal(markStaleBudgetRefusals(m), 1, 'only the old one is flagged')
  assert.equal(m.toolCalls[1].staleBudgetRefusal, undefined, 'the current refusal is not flagged')
  const spent = loadActiveResourceBudget(m.missionId)!
  spent.totals.modelCalls = 5
  saveResourceBudget(spent)
  assert.equal(authorizeResourceAction({ missionId: m.missionId, kind: 'model' }).code, 'RESOURCE_BUDGET_EXHAUSTED', 'the extended budget still refuses once it is spent')
  assert.equal(budgetExtensionCurrency(m.missionId), null, 'an exhausted superseding budget makes nothing stale')
  ok('2: a refusal at or after the extension, and an exhausted extended budget, still block')
}

// 3. No extension at all: nothing is stale and the original refusal blocks as before.
{
  const m = missionWithBudget('unextended', false)
  assert.equal(budgetExtensionCurrency(m.missionId), null)
  assert.ok(String(contextOf(m).recentToolResults.at(-1)!.error).includes('RESOURCE_BUDGET_EXHAUSTED'))
  assert.ok(!evaluateBlockedDecision(m, BLOCK).compact.includes('STALE_BUDGET_REFUSAL'), 'the stale guard does not fire without an extension')
  assert.equal(markStaleBudgetRefusals(m), 0)
  assert.equal(isStaleBudgetRefusal(REFUSAL, ago(1_000), null), false)
  // a healthy, never-extended budget does not make an old refusal stale either
  const healthy = startMissionInput('Fix add in calc.mjs (healthy)', 'healthy', {})
  createResourceBudget({ missionId: healthy.missionId })
  healthy.toolCalls.push({ at: ago(60_000), tool: 'file.replace_unique', ok: false, reason: 'old', error: REFUSAL, excerpt: REFUSAL })
  assert.equal(budgetExtensionCurrency(healthy.missionId), null, 'version 1 is not an extension')
  assert.equal(markStaleBudgetRefusals(healthy), 0)
  ok('3: with no superseding budget the refusal stays current and blocks')
}

// 4. A resumed mission works against the active (extended) budget version, with usage preserved.
{
  const m = missionWithBudget('resume', true)
  const currency = budgetExtensionCurrency(m.missionId)!
  const active = loadActiveResourceBudget(m.missionId)!
  assert.equal(currency.budgetId, active.budgetId)
  assert.equal(active.version, 2)
  assert.equal(active.limits.maxModelCalls, 5)
  assert.equal(active.totals.modelCalls, 2, 'usage is preserved across the extension')
  const decision = authorizeResourceAction({ missionId: m.missionId, kind: 'model' })
  assert.equal(decision.ok, true)
  assert.equal(decision.budget?.budgetId, active.budgetId, 'the governor uses the active version')
  ok('4: the resumed mission uses the active budget version with preserved usage')
}

// 5. Unrelated model/tool errors are never suppressed, and an unrelated BLOCKED decision is untouched.
{
  const m = missionWithBudget('unrelated', true)
  m.toolCalls.push({ at: ago(30_000), tool: 'file.replace_unique', ok: false, reason: 'bad', error: 'REPEATED_BAD_PATCH: this exact replacement was already rejected', excerpt: 'REPEATED_BAD_PATCH: this exact replacement was already rejected' })
  m.errors.push({ at: ago(30_000), klass: 'PROVIDER' as never, message: 'Model response rejected (PROVIDER): connection refused' })
  const context = contextOf(m)
  assert.ok(context.recentToolResults.some(r => String(r.error).startsWith('REPEATED_BAD_PATCH')), 'an unrelated tool error stays raw')
  assert.ok(context.recentErrors.some(e => e.message.includes('connection refused')), 'an unrelated provider error stays')
  assert.equal(markStaleBudgetRefusals(m), 1, 'only the budget refusal is flagged')
  assert.equal(m.toolCalls[1].staleBudgetRefusal, undefined)
  const terra = evaluateBlockedDecision(m, { reasoningSummary: 'TERRA_LOCKED', blocker: { blocker: 'TERRA_LOCKED', evidence: 'protected subsystem', why: 'terra' } } as never)
  assert.equal(terra.allowed, true, 'a non-budget BLOCKED decision is untouched')
  assert.ok(!terra.compact.includes('STALE_BUDGET_REFUSAL'))
  ok('5: unrelated errors and decisions are not suppressed')
}

// 6. The resume path flags superseded refusals before the model runs (and the journal says so).
{
  const { readFileSync } = await import('node:fs')
  const controller = readFileSync(path.join(process.cwd(), 'lib/native-builder/foundryMissionController.ts'), 'utf8')
  const resume = controller.slice(controller.indexOf('export async function resumeMission'), controller.indexOf('const activeModelMissionRuns'))
  assert.ok(/markStaleBudgetRefusals\(mission\)/.test(resume) && /staleRefusals > 0/.test(resume) && /saveMission\(mission\)/.test(resume), 'resumeMission flags and saves')
  assert.ok(resume.indexOf('markStaleBudgetRefusals(mission)') < resume.indexOf('runModelMission(missionId'), 'flagging happens before the run')
  ok('6: a resumed mission flags superseded refusals before running')
}

console.log(`\n${passed}/6 stale budget refusal validations passed`)
assert.equal(passed, 6)
