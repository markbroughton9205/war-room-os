/** Phase 10 governance / adversarial validation. Run: pnpm run validate:agent-ops-governance */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { harness, freshOps, fullNeed, draft, activeAgent, NOW, mins } from './testkit'
import * as api from './index'
import { AgentOpsLog } from './log'
import { AgentRegistry, deriveAgents } from './registry'
import { assertTransition, AgentTransitionError } from './lifecycle'
import { executeWorker, registerWorker, deriveWorkers } from './workers'
import type { AgentState } from './types'

const { check, finish } = harness('AGENT_OPS_GOVERNANCE_VALIDATION')

const PROTECTED = ['docs/war-room-constitution.md', 'CLAUDE.md', 'docs/phases/phase-10.md', 'docs/phases/phase-9.md', 'middleware.ts', 'lib/security/commanderSession.ts', 'lib/native-builder/foundryWorkerRouting.ts', 'lib/native-builder/foundryModelProviders.ts', 'lib/model-router/registry.ts', 'lib/model-router/dispatch.ts']
const present = PROTECTED.filter(existsSync)
const hash = () => present.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex')).join()
const missionsDir = path.join(os.homedir(), '.local/share/war-room-os/data/foundry/missions')
const missionSig = () => (existsSync(missionsDir) ? readdirSync(missionsDir).sort().map((n) => `${n}:${statSync(path.join(missionsDir, n)).mtimeMs}:${statSync(path.join(missionsDir, n)).size}`).join('|') : 'none')
const h0 = hash()
const m0 = missionSig()

// F1: lifecycle fuzz — whatever order of attempts, only legal edges are ever logged/derived
{
  let seed = 1006
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const states: AgentState[] = ['PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED', 'UNDER_REVIEW', 'RETIRED', 'REJECTED']
  const actors = ['commander:mark', 'system:governor', 'agent:self', 'commander:', '', 'system:x y']
  const o = freshOps(); const need = fullNeed(); o.reg.recordNeed(need); const spec = o.reg.propose(need.id, draft(), NOW)
  let accepted = 0
  for (let i = 0; i < 400; i++) { try { o.reg.transition(spec.id, states[Math.floor(rnd() * states.length)], actors[Math.floor(rnd() * actors.length)], 'fuzz', NOW); accepted += 1 } catch (e) { if (!(e instanceof AgentTransitionError)) throw e } }
  const d = deriveAgents(o.log)
  const hist = d.agents.get(spec.id)!.history
  let legal = true
  for (const h of hist) { try { assertTransition(h.from, h.to, h.by) } catch { legal = false } }
  check('G01_lifecycle_fuzz_only_legal_edges_logged', legal && d.rejectedTransitions === 0 && hist.length === accepted && hist.every((h, i) => i === 0 || hist[i - 1].to === h.from), `accepted=${accepted}`)
  const terminal = d.agents.get(spec.id)!.state
  check('G02_terminal_state_absorbs_everything', (terminal === 'RETIRED' || terminal === 'REJECTED') ? states.every((s) => { try { o.reg.transition(spec.id, s, 'commander:mark', 'x', NOW); return false } catch { return true } }) : true)
}

// F2: concurrency inside the process
{
  const a = activeAgent()
  registerWorker(a.log, { id: 'w', agentId: a.spec.id, category: 'documentation_freshness', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 2000, maxRunsPerDay: 50, maxConsecutiveFailures: 3, cadenceMinutes: null } }, 'commander:mark', NOW)
  const slow = () => new Promise<Record<string, never>>((r) => setTimeout(() => r({}), 150))
  const results = await Promise.all([executeWorker(a.log, 'w', slow, { now: NOW, runId: 'c1' }), executeWorker(a.log, 'w', slow, { now: NOW, runId: 'c2' }), executeWorker(a.log, 'w', slow, { now: NOW, runId: 'c3' })])
  check('G03_concurrent_runs_of_one_worker_are_serialized', results.filter((r) => r.ok).length === 1 && results.filter((r) => !r.ok && r.reason === 'ALREADY_RUNNING').length === 2)
  const dup = await executeWorker(a.log, 'w', async () => ({}), { now: NOW, runId: 'c1' })
  check('G04_reused_run_id_is_idempotent_not_double_counted', dup.ok && deriveWorkers(a.log).workers.get('w')!.runs.filter((r) => r.runId === 'c1').length === 1 && deriveWorkers(a.log).workers.get('w')!.runs.find((r) => r.runId === 'c1')!.status === 'SUCCEEDED')
}

// F3: static boundaries
const lib = 'lib/agents/ops'
const files = readdirSync(lib).filter((f) => f.endsWith('.ts') && !/validation\.ts$|testkit\.ts$/.test(f)).map((f) => path.join(lib, f))
const src = (f: string) => readFileSync(f, 'utf8')
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
{
  const writers = files.filter((f) => /\b(writeFile|writeFileSync|appendFile|appendFileSync|rmSync|unlinkSync|renameSync|copyFile|createWriteStream|mkdirSync)\b/.test(strip(src(f))))
  check('G05_only_the_log_module_writes_files', writers.map((f) => path.basename(f)).join() === 'log.ts', writers.join(','))
  const bad = files.filter((f) => /from '@\/lib\/(native-builder|model-router|council|council-routing|payments|deploy|security)\b/.test(src(f)))
  check('G06_cannot_import_routing_deploy_payments_foundry_missions', bad.length === 0, bad.join(','))
  const net = files.filter((f) => /\b(fetch\(|XMLHttpRequest|child_process|node:https?|node:net|spawn\()/.test(strip(src(f))))
  check('G07_no_network_or_process_spawning', net.length === 0, net.join(','))
  const mutators = Object.keys(api).filter((k) => /^(apply(?!ApprovedScopeChange)|deploy|push|merge|spend|rewrite|mutate|promote|sendExternal)/i.test(k))
  check('G08_no_mutating_exports_beyond_governed_ones', mutators.length === 0, mutators.join(','))
  const importers = execFileSync('grep', ['-rl', '--include=*.ts', '--include=*.tsx', '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=.war-room', '@/lib/agents/ops', 'app', 'lib', 'components', 'scripts'], { encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('lib/agents/ops/')).sort()
  check('G09_only_sanctioned_dependents', importers.join() === ['app/api/foundry/agents/ops/route.ts', 'components/war-room/foundry/FoundryAgentOpsPanel.tsx'].join(), importers.join(','))
  const instr = ['instrumentation.ts', 'instrumentation.js'].filter(existsSync).some((f) => readFileSync(f, 'utf8').includes('agents/ops'))
  check('G10_no_startup_or_boot_hooks', !instr && !files.some((f) => /setInterval|instrumentation/.test(strip(src(f)))))
}

// F4: full governed scenario never touches policy, routing, missions, or Phase 9 data
{
  const a = activeAgent()
  registerWorker(a.log, { id: 'w2', agentId: a.spec.id, category: 'incident_watch', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 500, maxRunsPerDay: 50, maxConsecutiveFailures: 2, cadenceMinutes: null } }, 'commander:mark', NOW)
  await executeWorker(a.log, 'w2', async (ctx) => { ctx.requestEffect('production_change'); return {} }, { now: NOW, runId: 'g1' })
  await executeWorker(a.log, 'w2', async () => { throw new Error('x') }, { now: NOW, runId: 'g2' })
  new AgentRegistry(a.log).transition(a.spec.id, 'RETIRED', 'commander:mark', 'done', NOW)
  check('G11_scenario_leaves_policy_routing_and_commander_auth_files_unchanged', hash() === h0 && present.length >= 8, `files=${present.length}`)
  check('G12_historical_mission_records_not_rewritten', missionSig() === m0, existsSync(missionsDir) ? 'checked app-data missions' : 'no missions dir')
}

// F5: secrets never persisted anywhere
{
  const a = activeAgent()
  registerWorker(a.log, { id: 'w3', agentId: a.spec.id, category: 'incident_watch', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 500, maxRunsPerDay: 50, maxConsecutiveFailures: 5, cadenceMinutes: null } }, 'commander:mark', NOW)
  const secrets = ['sk-abcdefghijklmnopqrstuvwxyz123456', 'ghp_abcdefghijklmnopqrstuvwxyz1234', 'Bearer abcdefghijklmnopqrstuvwxyz123456', 'password=hunter2hunter2']
  for (const [i, sct] of secrets.entries()) await executeWorker(a.log, 'w3', async () => { throw new Error(`leaked ${sct}`) }, { now: mins(i), runId: `s${i}` })
  await executeWorker(a.log, 'w3', async () => ({ outputs: secrets.map((sct) => ({ kind: sct, ref: sct, summary: sct })), toolsUsed: secrets }), { now: mins(9), runId: 's9' })
  const raw = readFileSync(a.log.file, 'utf8')
  check('G13_no_credential_in_persisted_state_under_error_and_output_paths', secrets.every((sct) => !raw.includes(sct.slice(0, 22))) && raw.includes('[REDACTED]'))
}

// F6: file tamper resilience
{
  const a = activeAgent()
  const raw = readFileSync(a.log.file, 'utf8')
  const forged = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.t === 'transition')
  const tampered = forged.map((r) => ({ ...r, rid: r.rid + '-x', tr: { ...r.tr, from: 'RETIRED', to: 'ACTIVE' } }))
  for (const t of tampered) { try { new AgentOpsLog(a.dir).append(t) } catch { /* */ } }
  check('G14_forged_transition_records_do_not_change_state', new AgentRegistry(new AgentOpsLog(a.dir)).get(a.spec.id)!.state === 'ACTIVE' && deriveAgents(new AgentOpsLog(a.dir)).rejectedTransitions === tampered.length)
  const runnerless = deriveWorkers(new AgentOpsLog(a.dir))
  check('G15_derive_workers_ignores_non_commander_registrations', runnerless.workers.size === 0)
  new AgentOpsLog(a.dir).append({ t: 'worker', worker: { id: 'evil', agentId: a.spec.id, category: 'incident_watch', version: '1', mission: 'm', permissionScope: ['read_docs'], memoryScope: ['docs'], limits: { maxRuntimeMs: 100, maxRunsPerDay: 1, maxConsecutiveFailures: 1, cadenceMinutes: null }, preApprovedEffects: ['spend'], createdAt: NOW.toISOString() }, approvedBy: 'agent:self' })
  const r = await executeWorker(new AgentOpsLog(a.dir), 'evil', async (ctx) => { ctx.requestEffect('spend'); return {} }, { now: NOW })
  check('G16_worker_registered_by_non_commander_is_inert', !r.ok && r.reason === 'WORKER_UNKNOWN')
}
void mins
finish()
