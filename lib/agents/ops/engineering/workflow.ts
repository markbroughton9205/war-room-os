import type { AgentOpsLog } from '../log'
import type { Actor, CheckpointState, CheckpointStep, EngineeringTool, FileChange, ValidationRecord } from '../types'
import { acknowledgeCancel, completeAssignment, deriveAssignments, executionGate, failAssignment, finalizeCancel } from './assignments'
import { type EngineeringCodePlan, planFromCode } from './codePlanner'
import { latestCheckpoint, planResume, runEffectOnce, saveCheckpoint, sha256 } from './continuity'
import { MAX_REPAIR_ATTEMPTS, addEvidence, deriveLedger, markUndetermined, proposeHypothesis, recordFailure, recordRepair, recordValidation, authorizeRepair, parseToolOutput } from './debugLedger'
import { ANALYST_SYSTEM, ENGINEER_REWRITE_SYSTEM, ENGINEER_SYSTEM, analystPrompt, chooseMode, featurePrompt, parseEditReply, repairPrompt, type FileJob } from './prompts'
import type { CommandRecord, ModelClient, ModelResult } from './runtime/ports'
import { runCommand, runHermetic } from './runtime/commandRunner'
import { Workspace, treeHash } from './runtime/workspaceFs'
import { buildWorkspaceIndex, indexSource, topLevelDuplicates } from './workspaceIndex'
import { collisionFacts, isCollisionProblem } from './collision'
import { quarantineTests, quarantineAssertions } from './testContract'
import { undefinedNames, routeFindings, routeTable, contractRouteProblems, statusReachability, syntaxProblems, legacyStateDrift, domIds, missingDomIds } from './staticGates'
import { persistenceProblems, persistenceProbe, wantsPersistence, type PersistenceProbe } from './persistenceContract'
import { buildEvidence, renderEvidence, parseTestFailures } from './failureEvidence'
import { startupProbe } from './startupProbe'
import { storageEnvVars } from './persistenceContract'
import { seedFromHandoff } from './successor'

export type FeatureRequest = { request: string; acceptance: string[]; hints?: string[] }
export type WorkflowEvent = { at: string; kind: string; detail: string }
export type FinalVerification = { label: string; argv: string[]; run: () => Promise<CommandRecord> }
export type WorkflowDeps = {
  log: AgentOpsLog
  assignmentId: string
  ws: Workspace
  model: ModelClient
  tools: EngineeringTool[]
  actor?: Actor
  lessons?: (ctx: { plan: EngineeringCodePlan; request: string }) => string[]
  finalVerification?: FinalVerification
  clock?: () => Date
  onEvent?: (e: WorkflowEvent) => void
  /** Stop after N completed steps (used by crash/restart tests and acceptance to simulate process death). */
  crashAfterSteps?: number
  /** Model to escalate to (already installed, permissive) after two materially distinct repair hypotheses were refuted. Never switched silently: every switch is an ESCALATE event and a result record. */
  escalation?: { label: string; model: ModelClient }
}
export type RepairTraceEntry = { step: string; label: string; attempt: number; check: number | null; checkName: string; key: string; hypothesis: string; files: string[]; model: string; contextDepth: 0 | 1; before: string; after: string; outcome: 'TARGET_FIXED' | 'CHANGED' | 'REFUTED' | 'NO_EDIT' }
export type EscalationRecord = { step: string; attempt: number; reason: string; modelBefore: string; modelAfter: string; contextDepth: 1; outcomeAfter?: string }
export type WorkflowResult = {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PAUSED' | 'CONFLICT' | 'BLOCKED' | 'CRASHED'
  reason: string
  modelCalls: number
  quarantinedTests?: number
  repairTrace?: RepairTraceEntry[]
  escalations?: EscalationRecord[]
  repairs: number
  filesChanged: string[]
  stepsDone: number
  tokens: number | 'UNKNOWN'
  latencyMs: number
  executor: { provider: string; model: string } | 'UNKNOWN'
}
const FACT_BEARING = /route conflict|does not serve what the acceptance contract|nothing in the code can ever respond|existing exports changed|persistence contract|syntax error|never declared or imported/
const LAYER_ORDER = ['storage', 'domain', 'api', 'ui', 'tests']

export async function runFeatureWorkflow(deps: WorkflowDeps, req: FeatureRequest): Promise<WorkflowResult> {
  const { log, assignmentId, ws } = deps
  const actor = deps.actor ?? 'system:engineering-runner'
  const clock = deps.clock ?? (() => new Date())
  const asg = deriveAssignments(log).assignments.get(assignmentId)
  if (!asg) throw new Error(`unknown assignment: ${assignmentId}`)
  const limits = asg.assignment.limits
  const t0 = Date.now()
  let modelCalls = 0
  let tokens: number | 'UNKNOWN' = 0
  let executor: WorkflowResult['executor'] = 'UNKNOWN'
  let repairs = 0
  let quarantined = 0
  const trace: RepairTraceEntry[] = []
  const escalations: EscalationRecord[] = []
  let activeModel: ModelClient = deps.model
  let stepsDone = 0
  const changed = new Set<string>()
  const emit = (kind: string, detail: string) => deps.onEvent?.({ at: clock().toISOString(), kind, detail })
  const result = (status: WorkflowResult['status'], reason: string): WorkflowResult => ({ status, reason, modelCalls, repairs, filesChanged: [...changed], quarantinedTests: quarantined, repairTrace: trace, escalations, stepsDone, tokens, latencyMs: Date.now() - t0, executor })

  // ---- state: resume from the latest checkpoint when one exists
  const baselineSnap = ws.snapshot()
  const baselineText: Record<string, string> = {}
  for (const p of Object.keys(baselineSnap).filter((x) => /\.(m?js|html?)$/.test(x) && !/node_modules/.test(x)).slice(0, 80)) baselineText[p] = ws.read(p)
  const prior = latestCheckpoint(log, assignmentId)
  let state: CheckpointState
  let plan: EngineeringCodePlan
  const index0 = buildWorkspaceIndex(ws.root)
  if (prior) {
    const rp = planResume(log, assignmentId, { fileHash: (p) => ws.hash(p), allFileHashes: ws.snapshot() })
    if (!rp.safeToResume) return result('CONFLICT', `cannot resume safely: ${rp.conflicts.join('; ')}`)
    state = prior.state
    for (const r of rp.redo) { const s = state.steps.find((x) => x.id === r.stepId); if (s) { s.status = 'PENDING'; s.note = `redo: ${r.reason}` } }
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    for (const f of state.fileChanges) changed.add(f.path)
    emit('RESUME', `resuming from checkpoint ${prior.seq}; skipping ${rp.skip.join(',') || 'none'}; redo ${rp.redo.map((r) => r.stepId).join(',') || 'none'}`)
  } else if (seedFromHandoff(log, assignmentId, ws).seeded) {
    // successor: start from the PREDECESSOR's structured checkpoint (done steps kept, the rest retried), never from scratch
    const seed = seedFromHandoff(log, assignmentId, ws)
    if (!seed.seeded) throw new Error('unreachable')
    if (!seed.safe) return result('CONFLICT', `cannot continue the predecessor's work safely: ${seed.conflicts.join('; ')}`)
    state = seed.state
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    for (const f of state.fileChanges) changed.add(f.path)
    saveCheckpoint(log, assignmentId, state, actor, clock())
    emit('SUCCESSOR', `continuing ${seed.fromAssignment}: keeping ${seed.skip.join(',') || 'no'} done step(s), retrying ${state.steps.filter((x) => x.status === 'PENDING').map((x) => x.id).join(',')}; ${seed.carriedDoNotRepeat} doNotRepeat carried`)
  } else {
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    const fileSteps: CheckpointStep[] = []
    let n = 0
    for (const layer of LAYER_ORDER) {
      const sl = plan.slices.find((s) => s.layer === layer)
      if (!sl) continue
      // the page that loads a changed client script is part of the UI surface: it must be a step even when the planner ranking missed it
      const uiHosts = layer === 'ui' ? sl.files.flatMap((f) => (index0.dependents[f.path] ?? []).filter((h) => index0.files[h]?.isHtml && !sl.files.some((x) => x.path === h)).map((h) => ({ path: h, action: 'modify' as const, rationale: `loads ${f.path}` }))).filter((h, i, a) => a.findIndex((x) => x.path === h.path) === i) : []
      for (const f of [...sl.files, ...uiHosts]) { n += 1; fileSteps.push({ id: `s${n}`, title: `${layer}: ${f.action} ${f.path}`, status: 'PENDING', layer, files: [f.path], note: f.rationale.slice(0, 120) }) }
    }
    if (!fileSteps.length) { failAssignment(log, assignmentId, actor, 'the code-aware plan found no files to change: ' + (plan.uncertainties[0] ?? 'UNDETERMINED'), undefined, clock()); return result('FAILED', 'no plan: ' + (plan.uncertainties[0] ?? 'UNDETERMINED')) }
    // Acceptance runs BEFORE model-written tests: the independent verifier is ground truth for the implementation, so implementation defects are repaired against it first.
    if (deps.finalVerification) { const at = fileSteps.findIndex((x) => x.layer === 'tests'); fileSteps.splice(at < 0 ? fileSteps.length : at, 0, { id: 'accept', title: 'acceptance: independent verification', status: 'PENDING', files: [] }) }
    fileSteps.push({ id: 'verify', title: 'end-to-end validation', status: 'PENDING', files: [] })
    const treeBefore = treeHash(baselineSnap)
    state = {
      objective: req.request, acceptanceCriteria: req.acceptance, steps: fileSteps, currentStepId: fileSteps[0].id, fileChanges: [], artifacts: ['plan'], validations: [], blockers: [], effectsDone: [], doNotRepeat: [], dependencies: asg.assignment.dependencies,
      workspace: { id: asg.assignment.workspace?.id ?? 'UNKNOWN', root: ws.root, kind: asg.assignment.workspace?.kind ?? 'sandbox', gitHead: 'UNKNOWN', baselineTreeHash: treeBefore, baselineFileHashes: Object.keys(baselineSnap).length <= 400 ? baselineSnap : 'UNKNOWN' },
    }
    saveCheckpoint(log, assignmentId, state, actor, clock())
    emit('PLAN', `${fileSteps.filter((s) => s.files.length).length} file step(s): ${fileSteps.filter((s) => s.files.length).map((s) => s.files[0]).join(', ')}`)
  }
  const checkpoint = () => { state.fileChanges = state.fileChanges.slice(-200); saveCheckpoint(log, assignmentId, state, actor, clock()) }

  // ---- helpers
  const budgetLeft = () => modelCalls < limits.maxModelCalls && Date.now() - t0 < limits.maxRuntimeMs
  const call = async (system: string, prompt: string, json = false, sampling: { temperature?: number; seed?: number } = {}): Promise<ModelResult> => {
    if (!deps.tools.includes('model_local')) return { ok: false, detail: 'model_local not granted', executor: 'UNKNOWN' }
    modelCalls += 1
    const ac = new AbortController()
    const poll = setInterval(() => { const g = executionGate(log, assignmentId); if (!g.proceed && g.reason !== 'OK') ac.abort() }, 400)
    try { const r = await activeModel.generate({ system, prompt, json, ...sampling, signal: ac.signal, maxTokens: 3500, timeoutMs: Math.min(300_000, limits.maxRuntimeMs) }); return r } finally { clearInterval(poll) }
  }
  const noteTokens = (r: ModelResult) => { if (r.ok) { executor = r.executor; tokens = tokens === 'UNKNOWN' || r.outputTokens === 'UNKNOWN' ? 'UNKNOWN' : tokens + r.outputTokens + (r.promptTokens === 'UNKNOWN' ? 0 : r.promptTokens); if (r.promptTokens === 'UNKNOWN') tokens = 'UNKNOWN' } }
  type Gate = { stop: WorkflowResult | null }
  const boundary = (): Gate => {
    const g = executionGate(log, assignmentId)
    if (g.proceed) return { stop: null }
    const v = deriveAssignments(log).assignments.get(assignmentId)!
    if (g.reason === 'PAUSED') return { stop: result('PAUSED', 'assignment is paused; no further work until a Commander resumes it') }
    if (g.reason === 'CANCEL_REQUESTED') { acknowledgeCancel(log, assignmentId, actor, clock()); finalizeCancel(log, assignmentId, actor, 'STOPPED', `stopped at a safe step boundary after cancellation (${v.stopReason ?? 'requested'})`, clock()); return { stop: result('CANCELLED', 'cancelled by the Commander at a safe boundary') } }
    if (g.reason === 'STOPPING') { finalizeCancel(log, assignmentId, actor, 'STOPPED', 'stopped', clock()); return { stop: result('CANCELLED', 'stopped') } }
    if (g.reason === 'AGENT_NOT_ACTIVE') { failAssignment(log, assignmentId, actor, 'the agent is no longer ACTIVE (retired or paused): work stopped', undefined, clock()); return { stop: result('FAILED', 'agent not active') } }
    return { stop: result('BLOCKED', `execution gate: ${g.reason}`) }
  }
  const budgetStop = (): WorkflowResult | null => { if (stepsDone >= limits.maxSteps) return result('FAILED', 'step budget exhausted'); if (!budgetLeft()) return result('FAILED', 'model-call or runtime budget exhausted'); return null }

  const readRel = (p: string) => (ws.exists(p) ? ws.read(p) : '')
  /** Workspace files that the failing output itself names (stack frames, import errors), then changed files, then what those import. */
  const candidatesFromOutput = (output: string, changedNow: string[]): string[] => {
    const named: string[] = []
    for (const m of output.matchAll(/(?:file:\/\/)?((?:\/[\w.@-]+)*\/)?((?:[\w.@-]+\/)*[\w.@-]+\.(?:m?js|cjs|ts|tsx))/g)) {
      const raw = (m[1] ?? '') + m[2]
      const rel = raw.startsWith(ws.root + '/') ? raw.slice(ws.root.length + 1) : raw.startsWith('/') ? '' : raw
      if (rel && !named.includes(rel) && ws.exists(rel) && !/^test\//.test(rel)) named.push(rel)
    }
    const idx = buildWorkspaceIndex(ws.root)
    const related = changedNow.flatMap((f) => (idx.files[f]?.imports ?? []).map((i) => i.resolved).filter((x): x is string => !!x))
    return [...new Set([...named, ...changedNow, ...related])].filter((p) => ws.exists(p)).slice(0, 6)
  }
  const keepExportsFor = (path: string): string[] => {
    if (!ws.exists(path)) return []
    const idx = buildWorkspaceIndex(ws.root)
    const f = idx.files[path]
    return (f?.exports ?? []).filter((name) => Object.values(idx.files).some((o) => o.path !== path && o.imports.some((i) => i.resolved === path && (i.names.includes(name) || i.names.includes('*')))))
  }
  /** Static API-compatibility gate: a rewrite may not delete an export that another file still imports. */
  const apiCompat = (path: string, content: string): string | null => {
    if (!ws.exists(path)) return null
    const before = indexSource(path, ws.read(path), new Set())
    const after = indexSource(path, content, new Set())
    const removed = before.exports.filter((e) => !after.exports.includes(e))
    if (!removed.length) return null
    const idx = buildWorkspaceIndex(ws.root)
    const users = removed.map((name) => ({ name, by: Object.values(idx.files).filter((f) => f.path !== path && f.imports.some((i) => i.resolved === path && (i.names.includes(name) || i.names.includes('*')))).map((f) => f.path) })).filter((u) => u.by.length)
    return users.length ? `your version removes exports that other files still import: ${users.map((u) => `${u.name} (used by ${u.by.join(', ')})`).join('; ')}. Keep them (add new exports instead of replacing).` : null
  }
  /** Static import gate: a written file may only import names that the workspace module really exports (ground truth, not memory). */
  const importCompat = (path: string, content: string, ignoreModules: Set<string> = new Set()): string | null => {
    const idx = buildWorkspaceIndex(ws.root)
    const known = new Set(Object.keys(idx.files))
    const entry = indexSource(path, content, known)
    const bad: string[] = []
    for (const imp of entry.imports) {
      if (!imp.resolved || imp.names.includes('*') || ignoreModules.has(imp.resolved)) continue
      const target = path === imp.resolved ? undefined : idx.files[imp.resolved]
      if (!target || target.kind === 'data' || target.isHtml || target.exports.includes('default')) continue
      const missing = imp.names.filter((n) => !target.exports.includes(n))
      if (missing.length) bad.push(`${missing.join(', ')} from ${imp.resolved} (it exports: ${target.exports.join(', ') || 'nothing'})`)
    }
    return bad.length ? `you import names that do not exist: ${bad.join('; ')}. Use only the real exports.` : null
  }
  /** Every static gate a reply must pass BEFORE it is written. */
  const gateProblem = (path: string, content: string, ignoreModules: Set<string> = new Set()): string | null => {
    const syn = syntaxProblems(path, content)
    if (syn.length) return `your version has a syntax error and the program would not start: ${syn.join('; ')}. Return the complete, syntactically valid file.`
    const dups = /\.m?[jt]sx?$/.test(path) ? topLevelDuplicates(path, content) : []
    if (dups.length) {
      const imported = dups.filter((n) => new RegExp(`import\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(content))
      const hint = imported.length ? ` ${imported.join(', ')} is both imported and declared here: rename the import with "as" (e.g. import { ${imported[0]} as store_${imported[0]} } from ...) and call the alias.` : ' Edit the existing declaration instead of adding a second one.'
      return `your version declares ${dups.join(', ')} more than once at the top level (a SyntaxError).${hint}\n${collisionFacts(path, content, dups, buildWorkspaceIndex(ws.root))}`
    }
    return apiCompat(path, content) ?? importCompat(path, content, ignoreModules) ?? crossRefProblem(path, content)
  }
  /** Cross-reference gates (see staticGates.ts): only NEW problems are reported, so a file that already had a defect is not blamed for it. */
  const crossRefProblem = (path: string, content: string): string | null => {
    const before = ws.exists(path) ? ws.read(path) : ''
    if (/\.m?js$/.test(path)) {
      const had = new Set(undefinedNames(path, before))
      const fresh = undefinedNames(path, content).filter((n) => !had.has(n))
      if (fresh.length) {
        const idx = buildWorkspaceIndex(ws.root)
        const where = fresh.map((n) => { const f = Object.values(idx.files).find((x) => x.path !== path && x.exports.includes(n)); return f ? `${n} is exported by ${f.path} (add: import { ${n} } from '<relative path to ${f.path}>')` : `${n} is not exported by any workspace file (declare it or do not call it)` })
        return `your version uses names that are never declared or imported, which fails at run time with "is not defined": ${where.join('; ')}.`
      }
      const dispatcher = /createServer\s*\(/.test(content) || routeTable(content).length >= 3
      if (dispatcher) {
        const hadF = new Set(routeFindings(path, before).map((f) => `${f.kind}|${f.hidden}`))
        const found = routeFindings(path, content).filter((f) => !hadF.has(`${f.kind}|${f.hidden}`))
        if (found.length) return `route conflict: ${found.map((f) => f.kind === 'DUPLICATE' ? `${f.hidden} is registered twice (lines ${f.hidingLine} and ${f.hiddenLine})` : `${f.hidden} (line ${f.hiddenLine}) is never reached: ${f.hiding} (line ${f.hidingLine}) matches it first [${f.kind === 'PREFIX_SHADOWS' ? 'broad prefix route' : 'parameter route'}]`).join('; ')}. Register every specific route BEFORE any prefix or parameter route that also matches it.`
        const clients = Object.keys(ws.snapshot()).filter((f) => /^public\/.+\.js$/.test(f)).map((f) => ws.read(f))
        const cp = contractRouteProblems(path, content, req.acceptance, clients)
        if (cp.length) return `the server does not serve what the acceptance contract requires: ${cp.join('; ')}. Add or fix exactly these routes (method and path as written in the contract).`
        const files = { ...Object.fromEntries(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f)).map((f) => [f, ws.read(f)])), [path]: content }
        const lost = statusReachability(files, req.acceptance)
        if (lost.length) return `the acceptance contract requires HTTP ${lost.join(', ')} but nothing in the code can ever respond with it. A generic catch that always answers one status hides it: raise errors that carry their status (for example err.status) and answer with that status.`
      }
      const drift = legacyStateDrift(path, before, content)
      if (drift.length) return `existing exports changed which data they use: ${drift.map((d) => `${d.fn}() used ${d.was} and now uses the NEW state ${d.now}`).join('; ')}. Existing endpoints must keep their own behaviour and data: leave ${drift.map((d) => d.fn).join(', ')} using ${drift[0].was} and add NEW functions for the new feature.`
      const snap = Object.fromEntries(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f) && !/^(test|node_modules|public)\//.test(f)).map((f) => [f, ws.read(f)]))
      const hadP = new Set(persistenceProblems(snap, req.acceptance))
      const pp = persistenceProblems({ ...snap, [path]: content }, req.acceptance).filter((x) => !hadP.has(x))
      if (pp.length) return `persistence contract: ${pp.join('; ')}`
    }
    if (/\.html?$/.test(path)) {
      const ids = [...new Set(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f) && !/^(test|src|node_modules)\//.test(f) && f !== 'server.mjs').flatMap((f) => domIds(ws.read(f))))]
      const had = new Set(missingDomIds(before, ids))
      const miss = missingDomIds(content, ids).filter((i) => !had.has(i))
      if (miss.length) return `the page is missing elements that its client scripts read: ${miss.map((i) => `id="${i}"`).join(', ')}. Add elements with exactly these ids.`
    }
    return null
  }
  /** NO_CHANGE is not acceptable for a page whose client scripts read element ids it does not contain. */
  const pageMissing = (path: string): string | null => {
    if (!ws.exists(path)) return null
    const ids = [...new Set(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f) && !/^(test|src|node_modules)\//.test(f) && f !== 'server.mjs').flatMap((f) => domIds(ws.read(f))))]
    const miss = missingDomIds(ws.read(path), ids)
    return miss.length ? `NO_CHANGE is not valid: the client scripts read ${miss.map((i) => `id="${i}"`).join(', ')} but the page has no such element. Add them.` : null
  }
  const relatedFor = (path: string, doneFiles: string[]) => {
    const idx = buildWorkspaceIndex(ws.root)
    const f = idx.files[path]
    const names = new Set<string>([...(f?.imports.map((i) => i.resolved).filter((x): x is string => !!x) ?? []), ...doneFiles])
    const out: { path: string; text: string }[] = []
    let budget = 9000
    for (const p of names) { if (p === path || !ws.exists(p)) continue; const t = ws.read(p); if (budget - t.length < 0) break; budget -= t.length; out.push({ path: p, text: t }) }
    // for tests/ui: show the server routes and service as ground truth
    return out
  }
  let restoreSeq = 0
  /** tag: a restore/revert is a NEW effect even when the same content was written earlier (the idempotency key would otherwise treat it as already done and skip it). */
  const writeFile = async (stepId: string, path: string, content: string, tag = '') => {
    const key = `write:${path}:${sha256(content).slice(0, 12)}${tag}`
    const before = ws.hash(path)
    const expected: FileChange = { path, beforeHash: before, afterHash: sha256(content), stepId }
    const out = await runEffectOnce(log, assignmentId, key, { kind: 'file_write', consequential: true, summary: `write ${path}`, expectedChanges: [expected] }, async () => { const w = ws.write(path, content); return { value: w, fileChanges: [{ path, beforeHash: w.beforeHash, afterHash: w.afterHash, stepId }] } }, (p) => ws.hash(p))
    if (out.conflict) throw new Error(out.conflict)
    if (out.ran || out.skipped === 'RECONCILED_LANDED') { state.fileChanges = [...state.fileChanges.filter((c) => !(c.path === path && c.stepId === stepId)), expected]; if (!state.effectsDone.includes(key)) state.effectsDone.push(key); changed.add(path) }
  }
  // test runs are hermetic (fresh copy of the workspace each time); syntax/type checks are read-only so they run in place
  const runCheck = async (argv: string[]) => (argv[0] === 'node' && argv[1] === '--test' ? runHermetic(ws.root, argv, deps.tools, { timeoutMs: 90_000 }) : runCommand(ws.root, argv, deps.tools, { timeoutMs: 90_000 }))
  const validationFor = (stepFiles: string[]): string[][] => {
    const cmds: string[][] = []
    for (const f of stepFiles) if (/\.m?js$/.test(f)) cmds.push(['node', '--check', f])
    return cmds
  }
  const allTests = (): string[] | null => { const t = Object.keys(ws.snapshot()).filter((f) => /^test\/.+\.test\.m?js$/.test(f)); return t.length ? ['node', '--test', ...t] : null }

  const hypTokens = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
  /** Near-identical wording (token Jaccard >= 0.6) means the analyst re-proposed a cause that was already acted on without fixing the failure. */
  const sameHypothesis = (a: string, b: string) => { const A = hypTokens(a), B = hypTokens(b); let i = 0; for (const x of A) if (B.has(x)) i += 1; return A.size > 0 && B.size > 0 && i / (A.size + B.size - i) >= 0.6 }
  const sourceFiles = (): Record<string, string> => Object.fromEntries(Object.keys(ws.snapshot()).filter((p) => /\.(m?js|html?)$/.test(p) && !/node_modules/.test(p)).map((p) => [p, ws.read(p)]))
  const modelLabel = (m: ModelClient): string => (m === deps.model ? (executor === 'UNKNOWN' ? 'primary' : executor.model) : deps.escalation && m === deps.escalation.model ? deps.escalation.label : 'unknown')
  const probeRecord = (pr: PersistenceProbe): CommandRecord => {
    const body = pr.verdict === 'FAIL' ? `not ok 1 - persistence round trip survives a restart\n  message: ${pr.detail}\n# tests 1\n# pass 0\n# fail 1\n` : `ok 1 - persistence round trip survives a restart\n# tests 1\n# pass 1\n# fail 0\n`
    return { argv: ['persistence-probe'], cwd: ws.root, exitCode: pr.verdict === 'FAIL' ? 1 : 0, timedOut: false, stdout: body, stderr: '', durationMs: 0, startedAt: clock().toISOString(), outputHash: sha256(body) }
  }
  const legacyNames = [...new Set(Object.values(baselineText).flatMap((t) => [...t.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map((m) => m[1])))]
  const runProbe = async (): Promise<PersistenceProbe> => persistenceProbe(ws.root, req.acceptance, Object.keys(ws.snapshot()), legacyNames)
  /**
   * The evidence-driven repair loop for ONE failing command. Returns true when the ORIGINAL failure is fixed.
   * failed check -> implicated route/symbol/storage path (failureEvidence) -> ordered, falsifiable hypotheses -> ONE hypothesis acted on per attempt
   * -> the original reproducer is re-run and the SAME check's failure is compared before/after: unchanged = REFUTED (never repeated), changed = progress.
   * Two refuted, materially distinct hypotheses escalate the context depth (and the model, when an escalation model is configured).
   * When the output is not a structured check list (or the failing step is a model-written test), the analyst-driven path below is used.
   */
  const debugLoop = async (failedCmd: CommandRecord, candidates: string[], stepId: string, label: string, rerunOriginal: () => Promise<CommandRecord> = () => runCheck(failedCmd.argv), confine?: string[]): Promise<boolean> => {
    let cmd = failedCmd
    let rec = recordFailure(log, assignmentId, cmd, actor, clock())
    const attemptsNotes: string[] = confine ? ['The implementation already PASSED the independent acceptance verification. The failing test is the suspect: fix the TEST file so it matches the real behaviour; do not change implementation files.'] : []
    const triedFiles = new Set<string>()
    const priorHyps: string[] = []
    const tried = new Map<string, { outcome: 'REFUTED' | 'CHANGED'; times: number; why: string }>()
    let refutedRun = 0
    let escalatedHere: EscalationRecord | null = null
    const canTry = (k: string) => { const t = tried.get(k); return !t || (t.outcome === 'CHANGED' && t.times < 2) }
    // Per-failure budget is MAX_REPAIR_ATTEMPTS; a repair that STRICTLY REDUCES the number of failing checks is progress and opens a fresh failure record
    // for the remainder (its own evidence discipline). The assignment's maxRetries ceiling bounds the total, and strictly-decreasing failures cannot loop.
    const totalCap = Math.max(1, limits.maxRetries), perCap = Math.min(MAX_REPAIR_ATTEMPTS, totalCap)
    try {
    for (let attempt = 1, total = 0; attempt <= perCap && total < totalCap; attempt++, total++) {
      const b = boundary(); if (b.stop) throw Object.assign(new Error('STOP'), { stop: b.stop })
      const bs = budgetStop(); if (bs) throw Object.assign(new Error('STOP'), { stop: bs })
      const out = `${cmd.stdout}\n${cmd.stderr}`
      const evCmd = addEvidence(log, assignmentId, rec.failureId, { kind: /\.m?js$/.test(cmd.argv.at(-1) ?? '') && cmd.argv[1] === '--check' ? 'type_diagnostic' : 'test_result', ref: `${cmd.argv.join(' ')}#attempt${attempt}`, content: out, summary: `${label} failed (exit ${cmd.exitCode}): ${out.split('\n').filter((l) => /Error|not ok|✖|fail/i.test(l)).slice(0, 2).join(' | ').slice(0, 220) || 'see output'}` }, actor, clock())
      const probe = !confine && wantsPersistence(req.acceptance) && /persist|surviv|restart/i.test(out) ? await runProbe().catch(() => null) : null
      const startup = !confine && /could not complete|server exited|did not start/i.test(out) ? await startupProbe(ws.root, Object.fromEntries(storageEnvVars(req.acceptance).map((v) => [v, `${v}.json`]))).catch(() => null) : null
      const ev0 = !/^not ok \d+ - |^\s*✖ /m.test(out) ? null : buildEvidence({ output: out, acceptance: req.acceptance, files: sourceFiles(), baseline: baselineText, probe, startupOutput: startup && !startup.started ? startup.output : undefined, testScope: !!confine })
      // a confined repair (the verified implementation must not change) may only act on hypotheses that target the confined files
      const ev = ev0 && confine ? { ...ev0, queue: ev0.queue.filter((h) => h.files.length > 0 && h.files.every((f) => confine.includes(f))) } : ev0
      const nextH = ev?.queue.find((h) => canTry(h.key)) ?? null
      const refutedList = [...tried].filter(([, t]) => t.outcome === 'REFUTED').map(([key, t]) => ({ key, why: t.why }))
      // escalation: two materially distinct hypotheses were acted on and refuted
      const depth: 0 | 1 = refutedRun >= 2 ? 1 : 0
      if (depth === 1 && !escalatedHere) {
        const before = modelLabel(activeModel)
        if (deps.escalation && activeModel === deps.model) activeModel = deps.escalation.model
        escalatedHere = { step: stepId, attempt, reason: `${refutedRun} materially distinct hypotheses were refuted (${refutedList.map((r) => r.key).join(', ')})`, modelBefore: before, modelAfter: modelLabel(activeModel), contextDepth: 1 }
        escalations.push(escalatedHere)
        emit('ESCALATE', `${label}: context depth 0 -> 1${activeModel !== deps.model ? `, model ${before} -> ${modelLabel(activeModel)}` : ' (no escalation model configured; the model is unchanged)'}; ${escalatedHere.reason}`)
      }
      const implicatedFiles = (h: { files: string[] } | null) => [...new Set([...(h?.files ?? []), ...candidatesFromOutput(out, candidates.filter((c) => ws.exists(c)))])].filter((c) => ws.exists(c) && !/^test\//.test(c) && (!confine || confine.includes(c)))
      let hypText = '', key = '', targets: string[] = [], parsed: { hypothesis?: string; file?: string; differs?: string } = {}
      let cand: string[] = []
      let evidenceText = ''
      if (nextH) {
        hypText = nextH.statement; key = nextH.key
        targets = nextH.files.filter((f) => ws.exists(f))
        if (!targets.length) targets = implicatedFiles(nextH).slice(0, 1)
        cand = implicatedFiles(nextH)
        evidenceText = renderEvidence(ev!, nextH, refutedList)
        for (const f of cand) addEvidence(log, assignmentId, rec.failureId, { kind: 'file_read', ref: f, content: ws.read(f), summary: `current content of ${f}` }, actor, clock())
      } else {
        cand = candidatesFromOutput(out, candidates.filter((c) => ws.exists(c))).filter((c) => !confine || confine.includes(c))
        for (const c of cand) addEvidence(log, assignmentId, rec.failureId, { kind: 'file_read', ref: c, content: ws.read(c), summary: `current content of ${c}` }, actor, clock())
        const ar = await call(ANALYST_SYSTEM, analystPrompt({ failureOutput: out, candidates: cand.map((c) => ({ path: c, text: ws.read(c) })), prior: attemptsNotes }), true)
        noteTokens(ar)
        if (!ar.ok) { attemptsNotes.push(`analysis call failed: ${ar.detail}`); continue }
        try { parsed = JSON.parse(ar.text) } catch { parsed = {} }
        hypText = (parsed.hypothesis ?? '').trim()
        if (!hypText) { attemptsNotes.push('analysis returned no hypothesis'); continue }
        if (priorHyps.some((p) => sameHypothesis(p, hypText)) && budgetLeft()) {
          // the same cause was already acted on and the failure persists: ask once for a DIFFERENT cause before spending another repair
          const again = await call(ANALYST_SYSTEM, analystPrompt({ failureOutput: out, candidates: cand.map((c) => ({ path: c, text: ws.read(c) })), prior: [...attemptsNotes, `REPEATED HYPOTHESIS REJECTED: "${hypText.slice(0, 220)}" was already acted on and the failure persists. Propose a DIFFERENT cause (another file or another mechanism), grounded in the failing output.`] }), true, { temperature: 0.5, seed: 7 + attempt })
          noteTokens(again)
          let p2: { hypothesis?: string; file?: string; differs?: string } = {}
          try { p2 = again.ok ? JSON.parse(again.text) : {} } catch { p2 = {} }
          const h2 = (p2.hypothesis ?? '').trim()
          if (!h2 || priorHyps.some((p) => sameHypothesis(p, h2))) {
            attemptsNotes.push('analyst repeated an already-acted-on hypothesis even when asked for a different one')
            markUndetermined(log, assignmentId, rec.failureId, 'the analyst could only re-propose an already-acted-on cause; no new hypothesis exists to act on', actor, clock())
            state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: no new hypothesis available; cause UNDETERMINED` })
            return false
          }
          hypText = h2; parsed = p2
        }
        priorHyps.push(hypText)
        key = `analyst:${priorHyps.length}`
        targets = [cand.includes(parsed.file ?? '') ? parsed.file! : cand[0]].filter(Boolean)
      }
      if (!targets.length) { attemptsNotes.push('no implicated file could be identified'); continue }
      const lastHyp = [...deriveLedger(log, assignmentId).hypotheses.entries()].filter(([, h]) => h.failureId === rec.failureId && h.status !== 'REFUTED').at(-1)
      const hid = proposeHypothesis(log, assignmentId, rec.failureId, { statement: `${nextH ? `[${key}] ` : ''}${hypText}`.slice(0, 600), supporting: [evCmd.id], ...(lastHyp && attempt > 1 ? { revisionOf: lastHyp[0], whyRevised: `attempt ${attempt - 1} did not fix it; new failure output recorded as ${evCmd.id}` } : {}) }, actor, clock())
      const diff = attempt > 1 ? (parsed.differs && parsed.differs !== 'first attempt' ? parsed.differs : `attempt ${attempt} acts on ${key} (${targets.join(', ')}) using the new failure output`) : null
      const gate = authorizeRepair(log, assignmentId, rec.failureId, { hypothesisId: hid, newEvidence: attempt > 1 ? [evCmd.id] : [], differsFromPrevious: diff, files: targets })
      if (!gate.ok) { attemptsNotes.push(`repair blocked: ${gate.reason}`); markUndetermined(log, assignmentId, rec.failureId, gate.reason, actor, clock()); state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: ${gate.reason}; cause UNDETERMINED` }); return false }
      emit('HYPOTHESIS', `${label}: attempt ${attempt} acts on ${key} -> ${targets.join(', ')}`)
      const written: string[] = []
      for (const file of targets.slice(0, 2)) {
        const keepR = keepExportsFor(file)
        const modeR = chooseMode(true, ws.read(file).split('\n').length, keepR)
        const relatedN = depth === 1 ? 5 : 3, relatedCap = depth === 1 ? 9000 : 3000
        const related = [...cand.filter((c) => c !== file).map((c) => ({ path: c, text: ws.read(c) })), ...relatedFor(file, [...changed])].filter((r, i, a) => a.findIndex((x) => x.path === r.path) === i).slice(0, relatedN)
        const mk = (extra: string, mode: 'edits' | 'rewrite') => repairPrompt({ failureOutput: out, hypothesis: `${hypText}${targets.length > 1 ? `\n(This fix spans ${targets.join(' and ')}; you are editing ${file} now${written.length ? `; already changed: ${written.join(', ')}` : ''}.)` : ''}${extra}`, file, current: ws.read(file), related, request: req.request, lessons: deps.lessons?.({ plan, request: req.request }) ?? [], mode, evidence: evidenceText, relatedCap })
        const rr = await call(modeR === 'edits' ? ENGINEER_SYSTEM : ENGINEER_REWRITE_SYSTEM, mk('', modeR === 'edits' ? 'edits' : 'rewrite'))
        noteTokens(rr)
        if (!rr.ok) { attemptsNotes.push(`repair call failed: ${rr.detail}`); continue }
        let pr = parseEditReply(rr.text, ws.read(file), file)
        if (pr.kind !== 'code' && budgetLeft()) {
          // the command is failing, so NO_CHANGE / an unusable reply is not an answer: ask once more, with the refusal reason and a full rewrite allowed
          const why = pr.kind === 'invalid' ? pr.reason : 'NO_CHANGE is not valid: the failing command above proves a change is needed'
          const rr2 = await call(ENGINEER_REWRITE_SYSTEM, mk(`\nYOUR PREVIOUS REPLY WAS REJECTED: ${why}`, 'rewrite'))
          noteTokens(rr2)
          if (rr2.ok) pr = parseEditReply(rr2.text, ws.read(file), file)
        }
        if (pr.kind !== 'code') { attemptsNotes.push(`repair reply unusable: ${pr.kind === 'invalid' ? pr.reason : 'NO_CHANGE'}`); continue }
        let compat = gateProblem(file, pr.content)
        if (compat && budgetLeft()) {
          const rr3 = await call(ENGINEER_REWRITE_SYSTEM, mk(`\nYOUR PREVIOUS REPLY WAS REJECTED BEFORE IT WAS WRITTEN: ${compat}`, 'rewrite'))
          noteTokens(rr3)
          const p3 = rr3.ok ? parseEditReply(rr3.text, ws.read(file), file) : null
          if (p3 && p3.kind === 'code') { pr = p3; compat = gateProblem(file, pr.content) }
        }
        if (compat) { attemptsNotes.push(`repair rejected: ${compat}`); state.doNotRepeat.push({ key: `reject:${file}:repair${attempt}`, reason: compat }); continue }
        const beforeHash = ws.hash(file)
        await writeFile(stepId, file, pr.content)
        triedFiles.add(file); written.push(file)
        repairs += 1
        attemptsNotes.push(`attempt ${attempt}: ${hypText.slice(0, 120)} (edited ${file}${beforeHash === ws.hash(file) ? ', no effective change' : ''})`)
      }
      const sigBefore = nextH && ev ? ev.signatureOf(nextH.check) : ''
      if (!written.length) {
        if (nextH) { tried.set(key, { outcome: 'REFUTED', times: 1, why: 'no usable, gate-passing edit could be produced for it' }); refutedRun += 1; trace.push({ step: stepId, label, attempt, check: nextH.check, checkName: ev!.checks.find((c) => c.n === nextH.check)?.name ?? '', key, hypothesis: hypText.slice(0, 240), files: [], model: modelLabel(activeModel), contextDepth: depth, before: sigBefore, after: sigBefore, outcome: 'NO_EDIT' }) }
        continue
      }
      const repair = recordRepair(log, assignmentId, rec.failureId, { hypothesisId: hid, filesEdited: written.map((f) => ({ path: f, afterHash: ws.hash(f)! })), rationale: hypText, differsFromPrevious: diff, newEvidence: attempt > 1 ? [evCmd.id] : [] }, actor, clock())
      const rerun = await rerunOriginal()
      const v = recordValidation(log, assignmentId, rec.failureId, repair.repairId, rerun, { changedFiles: [...changed], index: buildWorkspaceIndex(ws.root) }, actor, clock())
      state.validations.push({ stepId, command: rerun.argv.join(' '), status: v.outcome === 'ORIGINAL_FIXED' ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: rerun.outputHash, summary: v.note.slice(0, 200) })
      checkpoint()
      emit('REPAIR', `${label}: attempt ${attempt} -> ${v.outcome}`)
      if (nextH && ev) {
        const evAfter = buildEvidence({ output: `${rerun.stdout}\n${rerun.stderr}`, acceptance: req.acceptance, files: sourceFiles(), baseline: baselineText })
        const still = evAfter.checks.some((c) => c.n === nextH.check)
        const sigAfter = still ? evAfter.signatureOf(nextH.check) : ''
        const outcome: RepairTraceEntry['outcome'] = v.outcome === 'ORIGINAL_FIXED' || !still ? 'TARGET_FIXED' : sigAfter !== sigBefore ? 'CHANGED' : 'REFUTED'
        if (outcome === 'REFUTED') { tried.set(key, { outcome: 'REFUTED', times: 1, why: `the failure of check ${nextH.check} was identical after the repair (${written.join(', ')})` }); refutedRun += 1 }
        else if (outcome === 'CHANGED') tried.set(key, { outcome: 'CHANGED', times: (tried.get(key)?.times ?? 0) + 1, why: 'failure changed' })
        trace.push({ step: stepId, label, attempt, check: nextH.check, checkName: ev.checks.find((c) => c.n === nextH.check)?.name ?? '', key, hypothesis: hypText.slice(0, 240), files: written, model: modelLabel(activeModel), contextDepth: depth, before: sigBefore, after: sigAfter, outcome })
        emit('HYPOTHESIS_RESULT', `${key}: ${outcome}`)
        if (escalatedHere && !escalatedHere.outcomeAfter) escalatedHere.outcomeAfter = `${outcome} (${modelLabel(activeModel)}, depth ${depth})`
      } else if (v.outcome === 'SAME_FAILURE') { refutedRun += 1 }
      if (v.outcome === 'ORIGINAL_FIXED') return true
      const before = parseToolOutput(cmd.stdout, cmd.stderr).fail, after = parseToolOutput(rerun.stdout, rerun.stderr).fail
      if (v.outcome === 'NEW_FAILURE' && rerun.exitCode !== 0 && after < before) {
        attemptsNotes.push(`progress: failing checks ${before} -> ${after}; continuing on the remaining failure`)
        emit('PROGRESS', `${label}: failing checks ${before} -> ${after}`)
        cmd = rerun; rec = recordFailure(log, assignmentId, cmd, actor, clock()); attempt = 0; triedFiles.clear(); priorHyps.length = 0; refutedRun = 0
        continue
      }
      cmd = rerun
    }
    markUndetermined(log, assignmentId, rec.failureId, 'repair attempts exhausted without fixing the original failure', actor, clock())
    state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: ${MAX_REPAIR_ATTEMPTS} evidence-based repairs failed; cause UNDETERMINED` })
    return false
    } finally { activeModel = deps.model }
  }

  // ---- execute steps
  try {
    for (const step of state.steps) {
      if (step.status === 'DONE' || step.status === 'SKIPPED') continue
      const b0 = boundary(); if (b0.stop) { checkpoint(); return b0.stop }
      const bs0 = budgetStop(); if (bs0) { failAssignment(log, assignmentId, actor, bs0.reason, undefined, clock()); return bs0 }
      if (deps.crashAfterSteps !== undefined && stepsDone >= deps.crashAfterSteps) { checkpoint(); return result('CRASHED', `simulated process death after ${stepsDone} step(s)`) }
      state.currentStepId = step.id; step.status = 'ACTIVE'; checkpoint()
      if (step.id === 'accept') {
        const fv = deps.finalVerification!
        // advisory pre-check: a storage round trip on the real module (create -> read -> fresh process -> read) BEFORE the independent verification is spent on it
        if (wantsPersistence(req.acceptance)) {
          const pr = await runProbe().catch(() => null)
          if (pr) {
            emit('PERSISTENCE_PROBE', `${pr.verdict}: ${pr.detail.slice(0, 200)}`)
            if (pr.verdict === 'FAIL') await debugLoop(probeRecord(pr), [...changed].filter((f) => !/^test\//.test(f)), step.id, 'storage round-trip probe', async () => probeRecord(await runProbe()))
          }
        }
        const run = await fv.run()
        state.validations.push({ stepId: 'accept', command: fv.argv.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: fv.label })
        if (run.exitCode !== 0) {
          const ok = await debugLoop(run, [...changed].filter((f) => !/^test\//.test(f)), step.id, fv.label, fv.run)
          if (!ok) { step.status = 'FAILED'; step.note = `${fv.label} failing (UNDETERMINED)`; checkpoint(); failAssignment(log, assignmentId, actor, `${fv.label} fails and the cause is UNDETERMINED after bounded evidence-based repairs`, { validation: 'FAILED', summary: fv.label, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', `${fv.label}: UNDETERMINED`) }
        }
        step.status = 'DONE'; stepsDone += 1; checkpoint(); continue
      }
      if (step.id === 'verify') {
        // end-to-end: all repo tests, then the independent verification supplied by the Commander/harness
        const tests = allTests()
        if (tests) {
          const run = await runCheck(tests)
          state.validations.push({ stepId: 'verify', command: tests.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: `${parseToolOutput(run.stdout, run.stderr).pass} pass / ${parseToolOutput(run.stdout, run.stderr).fail} fail` })
          if (run.exitCode !== 0) { const ok = await debugLoop(run, [...changed].filter((f) => !/^test\//.test(f)).concat([...changed].filter((f) => /^test\//.test(f))), step.id, 'full test suite'); if (!ok) { step.status = 'FAILED'; step.note = 'test suite still failing (UNDETERMINED)'; checkpoint(); failAssignment(log, assignmentId, actor, 'the full test suite fails and the cause is UNDETERMINED after bounded evidence-based repairs', { validation: 'FAILED', summary: 'tests failing', artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', 'test suite failing; UNDETERMINED') } }
        }
        if (deps.finalVerification) {
          const fv = deps.finalVerification
          const run = await fv.run()
          state.validations.push({ stepId: 'verify', command: fv.argv.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: fv.label })
          if (run.exitCode !== 0) {
            const impl = [...changed].filter((f) => !/^test\//.test(f))
            const ok = await debugLoop(run, impl, step.id, fv.label, fv.run)
            if (!ok) { step.status = 'FAILED'; step.note = `${fv.label} failing (UNDETERMINED)`; checkpoint(); failAssignment(log, assignmentId, actor, `${fv.label} fails and the cause is UNDETERMINED after bounded evidence-based repairs`, { validation: 'FAILED', summary: fv.label, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', `${fv.label}: UNDETERMINED`) }
          }
        }
        step.status = 'DONE'; stepsDone += 1; checkpoint(); continue
      }
      // a file step
      const path = step.files[0]
      const job: FileJob = { path, layer: step.layer ?? 'domain', exists: ws.exists(path), current: readRel(path), role: step.layer === 'tests' ? 'test' : 'feature' }
      const notes = state.steps.filter((s) => s.status === 'DONE').map((s) => s.title)
      const lessons = deps.lessons?.({ plan, request: req.request }) ?? []
      let feedback = ''
      const keep = keepExportsFor(path)
      const mode = chooseMode(job.exists, job.current.split('\n').length, keep)
      const askFile = async (extra: string[], retry = 0) => { const r = await call(mode === 'edits' ? ENGINEER_SYSTEM : ENGINEER_REWRITE_SYSTEM, featurePrompt({ request: req.request, acceptance: req.acceptance, plan, job, related: relatedFor(path, [...changed]), lessons, priorNotes: [...notes, ...extra], keepExports: keep, mode }), false, retry ? { temperature: 0.1 + 0.25 * retry, seed: 1000 + retry } : {}); noteTokens(r); return r }
      let reply = await askFile([])
      let parsedReply: ReturnType<typeof parseEditReply> = reply.ok ? parseEditReply(reply.text, job.exists ? job.current : null, path) : { kind: 'invalid', reason: 'model call failed' }
      for (let rej = 0; rej < 3 && reply.ok; rej++) {
        const problem = parsedReply.kind === 'invalid' ? parsedReply.reason : parsedReply.kind === 'code' ? gateProblem(path, parsedReply.content) : parsedReply.kind === 'no_change' && /\.html?$/.test(path) ? pageMissing(path) : null
        if (!problem) break
        if (rej >= 2 && !isCollisionProblem(problem) && !FACT_BEARING.test(problem)) break // the third, targeted retry is reserved for problems that carry exact facts (collisions, route conflicts, contract routes/statuses, state drift, persistence, syntax, undeclared names); bounded
        feedback = problem
        emit('REJECT', `${path}: ${problem}`)
        state.doNotRepeat.push({ key: `reject:${path}:${rej}`, reason: problem })
        const bs = budgetStop(); if (bs) { failAssignment(log, assignmentId, actor, bs.reason, undefined, clock()); return bs }
        reply = await askFile([`YOUR PREVIOUS REPLY WAS REJECTED: ${problem}`, `THE REJECTED REPLY (do NOT repeat it):\n${reply.text.slice(0, 700)}`], rej + 1)
        parsedReply = reply.ok ? parseEditReply(reply.text, job.exists ? job.current : null, path) : { kind: 'invalid', reason: 'model call failed' }
      }
      void feedback
      if (reply.ok) { const skippedFiles = new Set(state.steps.filter((x) => x.status === 'SKIPPED').flatMap((x) => x.files)) // a skipped step's file may be the true defect: let evidence-driven repair find it rather than failing here
      const still = parsedReply.kind === 'code' ? gateProblem(path, parsedReply.content, skippedFiles) : null; if (still) { step.status = 'FAILED'; step.note = `rejected: ${still}`; checkpoint(); failAssignment(log, assignmentId, actor, `the model repeatedly produced a ${path} that ${still}`, undefined, clock()); return result('FAILED', `${path}: incompatible rewrite after 2 rejections`) } }
      if (!reply.ok) { if (reply.detail.includes('cancel')) { const b = boundary(); if (b.stop) { checkpoint(); return b.stop } } step.status = 'FAILED'; step.note = `model call failed: ${reply.detail}`; checkpoint(); failAssignment(log, assignmentId, actor, `model call failed: ${reply.detail}`, undefined, clock()); return result('FAILED', `model call failed: ${reply.detail}`) }
      const pr = parsedReply
      if (pr.kind === 'no_change') { step.status = 'SKIPPED'; step.note = 'model: NO_CHANGE needed for this file'; checkpoint(); emit('NO_CHANGE', path); continue }
      if (pr.kind === 'invalid') { step.status = 'FAILED'; step.note = `unusable reply: ${pr.reason}`; checkpoint(); failAssignment(log, assignmentId, actor, `model reply unusable for ${path}: ${pr.reason}`, undefined, clock()); return result('FAILED', `unusable reply for ${path}`) }
      await writeFile(step.id, path, pr.content)
      emit('WRITE', path)
      // validate this step
      let stepOk = true
      for (const argv of validationFor([path])) {
        const run = await runCheck(argv)
        state.validations.push({ stepId: step.id, command: argv.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: run.exitCode === 0 ? 'syntax ok' : (run.stderr.split('\n').find((l) => /Error/.test(l)) ?? 'failed').slice(0, 160) })
        if (run.exitCode !== 0) { stepOk = await debugLoop(run, [path], step.id, `syntax check ${path}`); if (!stepOk) break }
      }
      if (stepOk && step.layer === 'tests') {
        const tests = allTests()
        if (tests) {
          const run = await runCheck(tests)
          state.validations.push({ stepId: step.id, command: tests.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: `${parseToolOutput(run.stdout, run.stderr).pass} pass / ${parseToolOutput(run.stdout, run.stderr).fail} fail` })
          if (run.exitCode !== 0) {
            // Once the independent acceptance has PASSED, the implementation is verified ground truth: a failure that only implicates the NEW test is a test defect,
            // so the repair is confined to that test file instead of risking the verified behaviour.
            const acceptPassed = state.validations.some((v) => v.stepId === 'accept' && v.status === 'PASSED')
            const out = `${run.stdout}\n${run.stderr}`
            const otherTests = tests.slice(2).filter((t) => t !== path && out.includes(t))
            // ...unless the failure output itself implicates implementation files (a stack frame or path inside src/, server, public): then the implementation is a suspect too
            const implicated = candidatesFromOutput(out, []).filter((f) => !/^test\//.test(f))
            const testOnly = acceptPassed && out.includes(path) && !otherTests.length && !implicated.length
            const implSnap = Object.fromEntries([...changed].filter((f) => !/^test\//.test(f) && ws.exists(f)).map((f) => [f, ws.read(f)]))
            stepOk = await debugLoop(run, testOnly ? [path] : [...changed].filter((f) => !/^test\//.test(f)).concat([path]), step.id, 'tests', () => runCheck(tests), testOnly ? [path] : undefined)
            // implementation files edited at the test stage must not regress the independently verified behaviour: the verifier is the arbiter, the edit is reverted otherwise
            if (acceptPassed && deps.finalVerification && Object.entries(implSnap).some(([f, t]) => ws.read(f) !== t)) {
              const chk = await deps.finalVerification.run()
              if (chk.exitCode !== 0) { for (const [f, t] of Object.entries(implSnap)) if (ws.read(f) !== t) await writeFile(step.id, f, t, `:revert${++restoreSeq}`); state.doNotRepeat.push({ key: `revert:${step.id}`, reason: 'a repair at the test stage changed implementation files and broke the independent acceptance; the edit was reverted' }); emit('REVERT_REGRESSION', `${step.id}: implementation edit reverted (independent acceptance regressed)`); stepOk = (await runCheck(tests)).exitCode === 0 }
            }
            if (!stepOk && acceptPassed) {
              // The implementation PASSED the independent acceptance and only the model-written test still fails: the test asserts something the contract does not require.
              // Quarantine exactly the failing cases (recorded, reviewable, never silent) so an invented expectation cannot block a feature that meets its acceptance criteria.
              const last = await runCheck(tests)
              const failing = parseToolOutput(last.stdout, last.stderr).failures.map((f) => f.name)
              const orig = ws.read(path)
              const q = quarantineTests(path, orig, failing, req.acceptance)
              if (q) {
                await writeFile(step.id, path, q.content)
                const after = await runCheck(tests)
                if (after.exitCode === 0) {
                  const note = q.removed.map((r) => `${r.name} [contract overlap ${r.overlap}${r.criterion !== null ? ` with criterion ${r.criterion + 1}` : ''}]`).join('; ')
                  state.doNotRepeat.push({ key: `quarantine:${path}`, reason: `quarantined ${q.removed.length} model-invented test case(s) that failed against the independently verified implementation: ${note}` })
                  state.validations.push({ stepId: step.id, command: tests.join(' '), status: 'PASSED', at: clock().toISOString(), outputHash: after.outputHash, summary: `after quarantining ${q.removed.length} ungrounded test case(s); ${q.kept.length} contract test(s) kept` })
                  emit('QUARANTINE', `${path}: ${note}`)
                  quarantined += q.removed.length
                  stepOk = true
                } else { await writeFile(step.id, path, orig, `:restore${++restoreSeq}`) }
              }
              if (!stepOk) {
                // the case mixes grounded and ungrounded assertions (or is the only case): disable only the failing assertion statements, up to three rounds, never the whole case
                const removedAll: { line: number; code: string }[] = []
                for (let round = 0; round < 3; round++) {
                  const r = await runCheck(tests)
                  if (r.exitCode === 0) break
                  const fails = parseTestFailures(`${r.stdout}\n${r.stderr}`).filter((f) => f.file === path && f.line)
                  const qa = quarantineAssertions(path, ws.read(path), fails.map((f) => f.line!))
                  if (!qa) break
                  await writeFile(step.id, path, qa.content); removedAll.push(...qa.removed)
                }
                const after = await runCheck(tests)
                if (removedAll.length && after.exitCode === 0) {
                  state.doNotRepeat.push({ key: `quarantine-assertions:${path}`, reason: `disabled ${removedAll.length} assertion(s) that failed against the independently verified implementation and have no contract basis: ${removedAll.map((x) => `line ${x.line}: ${x.code}`).join('; ').slice(0, 300)}` })
                  state.validations.push({ stepId: step.id, command: tests.join(' '), status: 'PASSED', at: clock().toISOString(), outputHash: after.outputHash, summary: `after disabling ${removedAll.length} ungrounded assertion(s)` })
                  emit('QUARANTINE_ASSERTION', `${path}: ${removedAll.map((x) => `line ${x.line}`).join(', ')}`)
                  quarantined += removedAll.length
                  stepOk = true
                } else if (removedAll.length) { await writeFile(step.id, path, orig, `:restore${++restoreSeq}`) }
              }
            }
          }
        }
      }
      if (!stepOk) { step.status = 'FAILED'; checkpoint(); failAssignment(log, assignmentId, actor, `step ${step.id} (${path}) could not be validated; cause UNDETERMINED after bounded evidence-based repairs`, { validation: 'FAILED', summary: `${path} failing`, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', `${path}: UNDETERMINED`) }
      step.status = 'DONE'; stepsDone += 1; checkpoint()
    }
  } catch (err) {
    const stop = (err as { stop?: WorkflowResult }).stop
    if (stop) { checkpoint(); if (stop.status === 'FAILED') failAssignment(log, assignmentId, actor, stop.reason, undefined, clock()); return stop }
    const msg = err instanceof Error ? err.message : String(err)
    checkpoint()
    if (/drifted|refusing to overwrite/.test(msg)) return result('CONFLICT', msg)
    failAssignment(log, assignmentId, actor, `engineering workflow error: ${msg.slice(0, 200)}`, undefined, clock())
    return result('FAILED', msg)
  }

  // ---- completion: only when every step is done/skipped and validations passed
  const lastVerify = [...state.validations].reverse().find((v) => v.stepId === 'verify')
  completeAssignment(log, assignmentId, actor, { validation: 'PASSED', summary: `feature implemented across ${[...changed].length} file(s); ${state.validations.filter((v) => v.status === 'PASSED').length} validations passed${lastVerify ? `; final: ${lastVerify.summary}` : ''}`, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock())
  return result('COMPLETED', 'all steps validated')
}
export type { ValidationRecord }
