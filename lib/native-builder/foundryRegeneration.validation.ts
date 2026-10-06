/** Generic validation of the bounded regeneration escalation: reversible, once per task, only after narrow-repair stagnation. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { regenerateStagnantTasks, regenerationNote, MIN_DIAGNOSTICS_FOR_REGENERATION, type RegenerationOps } from './foundryRegeneration'
import { clearNarrowRepairLedger, setNarrowRepairLedgerRootForTests, loadLedger, evaluatePatch } from './foundryNarrowRepair'
import type { MissionGraph, MissionTask } from './foundryMissionExecutive'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const at = '2026-01-01T00:00:00.000Z'
const task = (taskId: string, state: MissionTask['state'], extra: Partial<MissionTask> = {}): MissionTask => ({ taskId, missionId: 'm', description: taskId, state, dependencies: [], blockers: [], resourceClaims: [], filesAtRisk: [], evidenceNeeded: [], completionCondition: '', retryState: { attempts: 2 }, createdAt: at, updatedAt: at, ...extra })
const graph = (tasks: MissionTask[]): MissionGraph => ({ missionId: 'm', goal: 'g', tasks, updatedAt: at })
const STAGNANT = 'BLOCKED: NARROW_REPAIR_STAGNANT - 5 TypeScript diagnostic(s) remain'

const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-regen-'))
setNarrowRepairLedgerRootForTests(path.join(root, '.ledger'))
const quarantineDir = path.join(root, 'quarantine')
const ops: RegenerationOps = {
  quarantine: file => {
    const from = path.join(root, file)
    if (!existsSync(from)) return null
    const to = path.join(quarantineDir, file)
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
    rmSync(from)
    return to
  },
  clearLedger: clearNarrowRepairLedger,
  diagnosticCount: () => 12,
}

// 1. a task whose narrow repair stagnated: file quarantined (copy kept), task reopened with the right note, history recorded.
{
  writeFileSync(path.join(root, 'bad.ts'), "export const a: number = 'x'\n")
  writeFileSync(path.join(root, 'good.ts'), 'export const g = 1\n')
  evaluatePatch(root, 'bad.ts', { startLine: 1, endLine: 1, replacement: "export const a: number = 'y'" })
  assert.ok(Object.keys(loadLedger('bad.ts').tries).length > 0, 'fixture: the ledger has tries')
  const g = graph([task('t_bad', 'FAILED', { files: ['bad.ts'], retryState: { attempts: 2, lastSignature: STAGNANT }, childMissionId: 'child1' }), task('t_good', 'COMPLETED', { files: ['good.ts'] })])
  const out = regenerateStagnantTasks(g, ops)
  const byId = Object.fromEntries(out.graph.tasks.map(item => [item.taskId, item]))
  assert.equal(out.regenerated.length, 1)
  assert.equal(byId.t_bad.state, 'READY')
  assert.equal(byId.t_bad.retryState.attempts, 0)
  assert.equal(byId.t_bad.retryState.lastSignature, regenerationNote)
  assert.equal(byId.t_bad.regenerations?.length, 1)
  assert.deepEqual(byId.t_bad.priorChildren, ['child1'], 'the old child is released before the new attempt')
  assert.equal(existsSync(path.join(root, 'bad.ts')), false, 'the stagnant file is out of the repo')
  assert.equal(readFileSync(path.join(quarantineDir, 'bad.ts'), 'utf8'), "export const a: number = 'x'\n", 'but a byte-identical copy is kept (reversible)')
  assert.deepEqual(loadLedger('bad.ts').tries, {}, 'the stale repair ledger is cleared')
  assert.equal(byId.t_good.state, 'COMPLETED')
  assert.equal(existsSync(path.join(root, 'good.ts')), true, 'unrelated files are untouched')
  ok('stagnant task: file quarantined (copy kept), ledger cleared, task reopened with history; unrelated work untouched')
}

// 2. once per task: a second stagnation after a regeneration is final.
{
  const g = graph([task('t_bad', 'FAILED', { files: ['bad.ts'], retryState: { attempts: 2, lastSignature: STAGNANT }, regenerations: [{ at, reason: 'x', quarantined: ['bad.ts -> q'] }] })])
  writeFileSync(path.join(root, 'bad.ts'), "export const a: number = 'x'\n")
  const out = regenerateStagnantTasks(g, ops)
  assert.equal(out.regenerated.length, 0)
  assert.equal(out.graph.tasks[0].state, 'FAILED')
  assert.equal(existsSync(path.join(root, 'bad.ts')), true, 'nothing is moved a second time')
  ok('at most one regeneration per task: a second stagnation stays FAILED')
}

// 3. only narrow-repair stagnation escalates; other failures and other states do not.
{
  const g = graph([
    task('t_other', 'FAILED', { files: ['bad.ts'], retryState: { attempts: 2, lastSignature: 'WAITING_RESOURCE: busy' } }),
    task('t_run', 'RUNNING', { files: ['bad.ts'], retryState: { attempts: 0, lastSignature: STAGNANT } }),
    task('t_nofiles', 'FAILED', { retryState: { attempts: 2, lastSignature: STAGNANT } }),
  ])
  const out = regenerateStagnantTasks(g, ops)
  assert.equal(out.regenerated.length, 0)
  assert.deepEqual(out.graph.tasks.map(item => item.state), ['FAILED', 'RUNNING', 'FAILED'])
  ok('only a FAILED task with narrow-repair stagnation and owned files is regenerated')
}

// 4. a file that no longer exists is not "regenerated" (nothing to quarantine).
{
  const g = graph([task('t_gone', 'FAILED', { files: ['missing.ts'], retryState: { attempts: 2, lastSignature: STAGNANT } })])
  assert.equal(regenerateStagnantTasks(g, ops).regenerated.length, 0)
  ok('a missing file is left to the normal missing-file rule')
}

// 5. a file that is close to clean is repaired in place: regeneration needs real distance to cover.
{
  writeFileSync(path.join(root, 'near.ts'), "export const n: number = 'x'\n")
  const g = graph([task('t_near', 'FAILED', { files: ['near.ts'], retryState: { attempts: 2, lastSignature: STAGNANT } })])
  // Absolute numbers, not the constant: a test relative to the constant cannot notice the constant being changed.
  assert.equal(MIN_DIAGNOSTICS_FOR_REGENERATION, 5, 'the documented threshold')
  const nearOps: RegenerationOps = { ...ops, diagnosticCount: () => 2 }
  const out = regenerateStagnantTasks(g, nearOps)
  assert.equal(out.regenerated.length, 0)
  assert.equal(out.graph.tasks[0].state, 'FAILED')
  assert.equal(existsSync(path.join(root, 'near.ts')), true, 'the nearly clean file is not touched')
  const far = regenerateStagnantTasks(g, { ...ops, diagnosticCount: () => 5 })
  assert.equal(far.regenerated.length, 1, 'at the threshold it is allowed')
  ok('regeneration is refused for a file with fewer than the minimum remaining diagnostics')
}

rmSync(root, { recursive: true, force: true })
console.log(`FOUNDRY_REGENERATION_VALIDATION ${passed}/5`)
