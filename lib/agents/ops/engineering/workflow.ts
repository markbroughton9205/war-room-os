import type { AgentOpsLog } from '../log'
import type { Actor, CheckpointState, CheckpointStep, EngineeringTool, FileChange, ValidationRecord } from '../types'
import { acknowledgeCancel, completeAssignment, deriveAssignments, executionGate, failAssignment, finalizeCancel } from './assignments'
import { type EngineeringCodePlan, planFromCode } from './codePlanner'
import { latestCheckpoint, planResume, runEffectOnce, saveCheckpoint, sha256 } from './continuity'
import { MAX_REPAIR_ATTEMPTS, addEvidence, deriveLedger, markUndetermined, proposeHypothesis, recordFailure, recordRepair, recordValidation, authorizeRepair, parseToolOutput } from './debugLedger'
import { ANALYST_SYSTEM, ENGINEER_REWRITE_SYSTEM, ENGINEER_SYSTEM, analystPrompt, chooseMode, featurePrompt, parseEditReply, repairPrompt, type FileJob } from './prompts'
import type { CommandRecord, ModelClient, ModelResult } from './runtime/ports'
import { runCommand } from './runtime/commandRunner'
import { Workspace, treeHash } from './runtime/workspaceFs'
import { buildWorkspaceIndex, indexSource } from './workspaceIndex'

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
}
export type WorkflowResult = {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PAUSED' | 'CONFLICT' | 'BLOCKED' | 'CRASHED'
  reason: string
  modelCalls: number
  repairs: number
  filesChanged: string[]
  stepsDone: number
  tokens: number | 'UNKNOWN'
  latencyMs: number
  executor: { provider: string; model: string } | 'UNKNOWN'
}
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
  let stepsDone = 0
  const changed = new Set<string>()
  const emit = (kind: string, detail: string) => deps.onEvent?.({ at: clock().toISOString(), kind, detail })
  const result = (status: WorkflowResult['status'], reason: string): WorkflowResult => ({ status, reason, modelCalls, repairs, filesChanged: [...changed], stepsDone, tokens, latencyMs: Date.now() - t0, executor })

  // ---- state: resume from the latest checkpoint when one exists
  const baselineSnap = ws.snapshot()
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
  } else {
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    const fileSteps: CheckpointStep[] = []
    let n = 0
    for (const layer of LAYER_ORDER) {
      const sl = plan.slices.find((s) => s.layer === layer)
      if (!sl) continue
      for (const f of sl.files) { n += 1; fileSteps.push({ id: `s${n}`, title: `${layer}: ${f.action} ${f.path}`, status: 'PENDING', layer, files: [f.path], note: f.rationale.slice(0, 120) }) }
    }
    if (!fileSteps.length) { failAssignment(log, assignmentId, actor, 'the code-aware plan found no files to change: ' + (plan.uncertainties[0] ?? 'UNDETERMINED'), undefined, clock()); return result('FAILED', 'no plan: ' + (plan.uncertainties[0] ?? 'UNDETERMINED')) }
    fileSteps.push({ id: 'verify', title: 'end-to-end validation', status: 'PENDING', files: [] })
    const treeBefore = treeHash(baselineSnap)
    state = {
      objective: req.request, acceptanceCriteria: req.acceptance, steps: fileSteps, currentStepId: fileSteps[0].id, fileChanges: [], artifacts: ['plan'], validations: [], blockers: [], effectsDone: [], doNotRepeat: [], dependencies: asg.assignment.dependencies,
      workspace: { id: asg.assignment.workspace?.id ?? 'UNKNOWN', root: ws.root, kind: asg.assignment.workspace?.kind ?? 'sandbox', gitHead: 'UNKNOWN', baselineTreeHash: treeBefore, baselineFileHashes: Object.keys(baselineSnap).length <= 400 ? baselineSnap : 'UNKNOWN' },
    }
    saveCheckpoint(log, assignmentId, state, actor, clock())
    emit('PLAN', `${fileSteps.length - 1} file step(s): ${fileSteps.filter((s) => s.id !== 'verify').map((s) => s.files[0]).join(', ')}`)
  }
  const checkpoint = () => { state.fileChanges = state.fileChanges.slice(-200); saveCheckpoint(log, assignmentId, state, actor, clock()) }

  // ---- helpers
  const budgetLeft = () => modelCalls < limits.maxModelCalls && Date.now() - t0 < limits.maxRuntimeMs
  const call = async (system: string, prompt: string, json = false): Promise<ModelResult> => {
    if (!deps.tools.includes('model_local')) return { ok: false, detail: 'model_local not granted', executor: 'UNKNOWN' }
    modelCalls += 1
    const ac = new AbortController()
    const poll = setInterval(() => { const g = executionGate(log, assignmentId); if (!g.proceed && g.reason !== 'OK') ac.abort() }, 400)
    try { const r = await deps.model.generate({ system, prompt, json, signal: ac.signal, maxTokens: 3500, timeoutMs: Math.min(300_000, limits.maxRuntimeMs) }); return r } finally { clearInterval(poll) }
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
  const writeFile = async (stepId: string, path: string, content: string) => {
    const key = `write:${path}:${sha256(content).slice(0, 12)}`
    const before = ws.hash(path)
    const expected: FileChange = { path, beforeHash: before, afterHash: sha256(content), stepId }
    const out = await runEffectOnce(log, assignmentId, key, { kind: 'file_write', consequential: true, summary: `write ${path}`, expectedChanges: [expected] }, async () => { const w = ws.write(path, content); return { value: w, fileChanges: [{ path, beforeHash: w.beforeHash, afterHash: w.afterHash, stepId }] } }, (p) => ws.hash(p))
    if (out.conflict) throw new Error(out.conflict)
    if (out.ran || out.skipped === 'RECONCILED_LANDED') { state.fileChanges = [...state.fileChanges.filter((c) => !(c.path === path && c.stepId === stepId)), expected]; if (!state.effectsDone.includes(key)) state.effectsDone.push(key); changed.add(path) }
  }
  const runCheck = async (argv: string[]) => { const rec = await runCommand(ws.root, argv, deps.tools, { timeoutMs: 90_000 }); return rec }
  const validationFor = (stepFiles: string[]): string[][] => {
    const cmds: string[][] = []
    for (const f of stepFiles) if (/\.m?js$/.test(f)) cmds.push(['node', '--check', f])
    return cmds
  }
  const allTests = (): string[] | null => { const t = Object.keys(ws.snapshot()).filter((f) => /^test\/.+\.test\.m?js$/.test(f)); return t.length ? ['node', '--test', ...t] : null }

  /** The evidence-driven repair loop for ONE failing command. Returns true when the ORIGINAL failure is fixed. */
  const debugLoop = async (failedCmd: CommandRecord, candidates: string[], stepId: string, label: string, rerunOriginal: () => Promise<CommandRecord> = () => runCheck(failedCmd.argv)): Promise<boolean> => {
    let cmd = failedCmd
    const rec = recordFailure(log, assignmentId, cmd, actor, clock())
    const attemptsNotes: string[] = []
    for (let attempt = 1; attempt <= Math.min(MAX_REPAIR_ATTEMPTS, Math.max(1, limits.maxRetries)); attempt++) {
      const b = boundary(); if (b.stop) throw Object.assign(new Error('STOP'), { stop: b.stop })
      const bs = budgetStop(); if (bs) throw Object.assign(new Error('STOP'), { stop: bs })
      const out = `${cmd.stdout}\n${cmd.stderr}`
      const evCmd = addEvidence(log, assignmentId, rec.failureId, { kind: /\.m?js$/.test(cmd.argv.at(-1) ?? '') && cmd.argv[1] === '--check' ? 'type_diagnostic' : 'test_result', ref: `${cmd.argv.join(' ')}#attempt${attempt}`, content: out, summary: `${label} failed (exit ${cmd.exitCode}): ${out.split('\n').filter((l) => /Error|not ok|✖|fail/i.test(l)).slice(0, 2).join(' | ').slice(0, 220) || 'see output'}` }, actor, clock())
      const cand = candidatesFromOutput(out, candidates.filter((c) => ws.exists(c)))
      const evFiles = cand.map((c) => addEvidence(log, assignmentId, rec.failureId, { kind: 'file_read', ref: c, content: ws.read(c), summary: `current content of ${c}` }, actor, clock()))
      const ar = await call(ANALYST_SYSTEM, analystPrompt({ failureOutput: out, candidates: cand.map((c) => ({ path: c, text: ws.read(c) })), prior: attemptsNotes }), true)
      noteTokens(ar)
      if (!ar.ok) { attemptsNotes.push(`analysis call failed: ${ar.detail}`); continue }
      let parsed: { hypothesis?: string; file?: string; differs?: string } = {}
      try { parsed = JSON.parse(ar.text) } catch { parsed = {} }
      const hypText = (parsed.hypothesis ?? '').trim()
      if (!hypText) { attemptsNotes.push('analysis returned no hypothesis'); continue }
      const file = cand.includes(parsed.file ?? '') ? parsed.file! : cand[0]
      const lastHyp = [...deriveLedger(log, assignmentId).hypotheses.entries()].filter(([, h]) => h.failureId === rec.failureId && h.status !== 'REFUTED').at(-1)
      const hid = proposeHypothesis(log, assignmentId, rec.failureId, { statement: hypText, supporting: [evCmd.id, ...evFiles.map((e) => e.id).slice(0, 2)], ...(lastHyp && attempt > 1 ? { revisionOf: lastHyp[0], whyRevised: `attempt ${attempt - 1} did not fix it; new failure output recorded as ${evCmd.id}` } : {}) }, actor, clock())
      const diff = attempt > 1 ? (parsed.differs && parsed.differs !== 'first attempt' ? parsed.differs : `attempt ${attempt} targets ${file} using the new failure output`) : null
      const gate = authorizeRepair(log, assignmentId, rec.failureId, { hypothesisId: hid, newEvidence: attempt > 1 ? [evCmd.id] : [], differsFromPrevious: diff, files: [file] })
      if (!gate.ok) { attemptsNotes.push(`repair blocked: ${gate.reason}`); markUndetermined(log, assignmentId, rec.failureId, gate.reason, actor, clock()); state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: ${gate.reason}; cause UNDETERMINED` }); return false }
      const keepR = keepExportsFor(file)
      const modeR = chooseMode(true, ws.read(file).split('\n').length, keepR)
      const rr = await call(modeR === 'edits' ? ENGINEER_SYSTEM : ENGINEER_REWRITE_SYSTEM, repairPrompt({ failureOutput: out, hypothesis: hypText, file, current: ws.read(file), related: relatedFor(file, [...changed]).slice(0, 3), request: req.request, lessons: deps.lessons?.({ plan, request: req.request }) ?? [], mode: modeR }))
      noteTokens(rr)
      if (!rr.ok) { attemptsNotes.push(`repair call failed: ${rr.detail}`); continue }
      const pr = parseEditReply(rr.text, ws.read(file))
      if (pr.kind !== 'code') { attemptsNotes.push(`repair reply unusable: ${pr.kind === 'invalid' ? pr.reason : 'NO_CHANGE'}`); continue }
      const compat = apiCompat(file, pr.content)
      if (compat) { attemptsNotes.push(`repair rejected: ${compat}`); continue }
      const beforeHash = ws.hash(file)
      await writeFile(stepId, file, pr.content)
      repairs += 1
      const newHash = ws.hash(file)!
      const repair = recordRepair(log, assignmentId, rec.failureId, { hypothesisId: hid, filesEdited: [{ path: file, afterHash: newHash }], rationale: hypText, differsFromPrevious: diff, newEvidence: attempt > 1 ? [evCmd.id] : [] }, actor, clock())
      attemptsNotes.push(`attempt ${attempt}: ${hypText.slice(0, 120)} (edited ${file}${beforeHash === newHash ? ', no effective change' : ''})`)
      const rerun = await rerunOriginal()
      const v = recordValidation(log, assignmentId, rec.failureId, repair.repairId, rerun, { changedFiles: [...changed], index: buildWorkspaceIndex(ws.root) }, actor, clock())
      state.validations.push({ stepId, command: rerun.argv.join(' '), status: v.outcome === 'ORIGINAL_FIXED' ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: rerun.outputHash, summary: v.note.slice(0, 200) })
      checkpoint()
      emit('REPAIR', `${label}: attempt ${attempt} -> ${v.outcome}`)
      if (v.outcome === 'ORIGINAL_FIXED') return true
      cmd = rerun
    }
    markUndetermined(log, assignmentId, rec.failureId, 'repair attempts exhausted without fixing the original failure', actor, clock())
    state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: ${MAX_REPAIR_ATTEMPTS} evidence-based repairs failed; cause UNDETERMINED` })
    return false
  }

  // ---- execute steps
  try {
    for (const step of state.steps) {
      if (step.status === 'DONE' || step.status === 'SKIPPED') continue
      const b0 = boundary(); if (b0.stop) { checkpoint(); return b0.stop }
      const bs0 = budgetStop(); if (bs0) { failAssignment(log, assignmentId, actor, bs0.reason, undefined, clock()); return bs0 }
      if (deps.crashAfterSteps !== undefined && stepsDone >= deps.crashAfterSteps) { checkpoint(); return result('CRASHED', `simulated process death after ${stepsDone} step(s)`) }
      state.currentStepId = step.id; step.status = 'ACTIVE'; checkpoint()
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
      const askFile = async (extra: string[]) => { const r = await call(mode === 'edits' ? ENGINEER_SYSTEM : ENGINEER_REWRITE_SYSTEM, featurePrompt({ request: req.request, acceptance: req.acceptance, plan, job, related: relatedFor(path, [...changed]), lessons, priorNotes: [...notes, ...extra], keepExports: keep, mode })); noteTokens(r); return r }
      let reply = await askFile([])
      let parsedReply: ReturnType<typeof parseEditReply> = reply.ok ? parseEditReply(reply.text, job.exists ? job.current : null) : { kind: 'invalid', reason: 'model call failed' }
      for (let rej = 0; rej < 2 && reply.ok; rej++) {
        const problem = parsedReply.kind === 'invalid' ? parsedReply.reason : parsedReply.kind === 'code' ? apiCompat(path, parsedReply.content) : null
        if (!problem) break
        feedback = problem
        emit('REJECT', `${path}: ${problem}`)
        state.doNotRepeat.push({ key: `reject:${path}:${rej}`, reason: problem })
        const bs = budgetStop(); if (bs) { failAssignment(log, assignmentId, actor, bs.reason, undefined, clock()); return bs }
        reply = await askFile([`YOUR PREVIOUS REPLY WAS REJECTED: ${problem}`])
        parsedReply = reply.ok ? parseEditReply(reply.text, job.exists ? job.current : null) : { kind: 'invalid', reason: 'model call failed' }
      }
      void feedback
      if (reply.ok) { const still = parsedReply.kind === 'code' ? apiCompat(path, parsedReply.content) : null; if (still) { step.status = 'FAILED'; step.note = `rejected: ${still}`; checkpoint(); failAssignment(log, assignmentId, actor, `the model repeatedly produced a ${path} that ${still}`, undefined, clock()); return result('FAILED', `${path}: incompatible rewrite after 2 rejections`) } }
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
          if (run.exitCode !== 0) stepOk = await debugLoop(run, [...changed].filter((f) => !/^test\//.test(f)).concat([path]), step.id, 'tests')
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
