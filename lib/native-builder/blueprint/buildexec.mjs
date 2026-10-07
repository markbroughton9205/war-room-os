/** Durable, bounded BUILD/PACKAGE execution engine (isolated). Executes REAL host-owned recipes against an isolated fixture; never a live War Room build.
 *
 *  runs/<execId>.<stage>.<n>.json          mutable signed RUN STATE (PLANNED..PASSED, activity, pid+process token, cancel facts)
 *  runs/<execId>.<stage>.<n>/out|.bp-run   the run's OWN output dir + provenance marker (fresh per run; the only place the recipe may write)
 *  receipts/<execId>.<seq>.<KIND>.json     IMMUTABLE, hash-chained lineage receipts (SOURCE, DEPENDENCIES, BUILD, PACKAGE, VERIFICATION, INVALIDATION, RECONCILIATION, CANCELLATION)
 *  cancel/<execId>.json                    durable cancellation record (CANCEL_REQUESTED -> CANCEL_SIGNALLED -> CANCELLED | CANCEL_UNCONFIRMED)
 * History is never rewritten: "current" status is DERIVED by comparing a receipt's bound inputs with today's inputs. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { atomicWrite, canonical, createExclusive, hash, readJson, refuse } from './base.mjs'
import { buildManifest, scanOutputDir, verifyManifest } from './artifacts.mjs'
import { scrub } from './stages.mjs'

export const RUN_STATES = Object.freeze(['PLANNED', 'STARTING', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'UNKNOWN_AFTER_CRASH'])
export const RECEIPT_KINDS = Object.freeze(['SOURCE', 'DEPENDENCIES', 'BUILD', 'PACKAGE', 'VERIFICATION', 'INVALIDATION', 'RECONCILIATION', 'CANCELLATION'])
export const CLASSIFICATIONS = Object.freeze(['SAFE_TO_RETRY', 'ALREADY_PASSED', 'UNKNOWN_AFTER_CRASH', 'NEEDS_OPERATOR_REVIEW', 'STALE_INPUTS', 'IN_PROGRESS'])
/** Source-level inputs: a change means the VALIDATED SOURCE no longer matches => STALE (needs new validation). Build-level inputs: a change means REQUIRES_REBUILD under the same validation. */
export const STALE_GROUP = Object.freeze(['packageDigest', 'sourceHashes', 'inputTree', 'baseIdentityDigest', 'ownershipDigest', 'leaseHolder', 'checkBinding'])
export const REBUILD_GROUP = Object.freeze(['dependencyDigest', 'recipeDigest', 'stageCheckBinding', 'envDigest'])

// ------------------------------------------------------------------ process identity (Linux /proc: pid + start time; a bare pid is never authority)
export function procToken(pid) { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), f = s.slice(s.lastIndexOf(')') + 2).split(' '); return `${f[19]}` } catch { return null } }
export function procState(pid, token) {
  if (!Number.isInteger(pid) || !token) return 'UNKNOWN'
  if (!fs.existsSync('/proc/self/stat')) return 'UNKNOWN'
  let s; try { s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8') } catch { return 'DEAD' }
  const f = s.slice(s.lastIndexOf(')') + 2).split(' ')
  if (f[0] === 'Z' || f[0] === 'X') return 'DEAD'
  return `${f[19]}` === token ? 'ALIVE' : 'DEAD' // same pid, different start time => our process is gone (pid reuse)
}

// ------------------------------------------------------------------ structured error feedback contract (future Foundry / external-AI feedback; NOT transmitted by this slice)
const NEXT = { BUILD_FAILED: 'Revise the supplied source so the host build recipe passes, then submit a new package.', PACKAGE_FAILED: 'The build is valid; ask the host operator to inspect the package recipe failure.', STAGE_TIMEOUT: 'Reduce build work or ask the operator to review the recipe timeout.',
  BUILD_OUTPUT_MISSING: 'The recipe produced no declared artifact; revise the supplied source.', PACKAGE_OUTPUT_MISSING: 'The package recipe produced no declared artifact; operator review required.', UNEXPECTED_OUTPUT: 'The build wrote files outside its declared outputs; revise the source or recipe.',
  UNEXPECTED_EXECUTABLE: 'An output was executable; executables are not allowed artifact kinds.', ARTIFACT_PROVENANCE_UNKNOWN: 'The artifact cannot be proven to come from this run; rebuild.', SOURCE_CHANGED_DURING_STAGE: 'Inputs changed while the stage ran; re-validate the source and rebuild.',
  DEPENDENCY_NOT_USABLE: 'Provision the dependency through the host dependency process; blueprint execution never installs.', STAGE_CHECK_FAILED: 'A host stage check failed; revise the supplied source.', TOOL_DRIFT: 'A host recipe changed; the operator must re-approve.',
  HOST_AUTHORITY_STOPPED: 'The host mission/assignment stopped this work; wait for host authority to resume.', LEASE_LOST: 'The workspace lease was lost; operator review required.', CANCELLED: 'Cancelled by an operator; no retry unless re-requested.' }
const RETRYABLE = new Set(['STAGE_TIMEOUT', 'TOOL_UNAVAILABLE'])
const relOnly = f => (typeof f === 'string' && f.length <= 300 && !f.startsWith('/') && !/^[A-Za-z]:/.test(f) && !f.split(/[\\/]/).includes('..') ? f : '<redacted-path>')
export function structuredError({ stage, code, failedCheck = null, file = null, expected = null, observed = null, evidenceRef = null, retryable, needsApproval = false, nextAction }) {
  const bound = v => (v == null ? null : scrub(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 200))
  return Object.freeze({ stage, code: /^[A-Z_]{3,60}$/.test(code) ? code : 'UNKNOWN', failedCheck: failedCheck && /^[\w.-]{1,100}$/.test(failedCheck) ? failedCheck : null, file: file == null ? null : relOnly(file), expected: bound(expected), observed: bound(observed),
    evidenceRef: typeof evidenceRef === 'string' ? evidenceRef.slice(0, 120) : null, retryable: retryable ?? RETRYABLE.has(code), needsApproval, nextAction: nextAction ?? NEXT[code] ?? 'Operator review required.' })
}

export function diffComponents(a, b) { const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort(); return keys.filter(k => canonical(a?.[k] ?? null) !== canonical(b?.[k] ?? null)) }
export const inputDigestOf = components => hash(canonical(components))

export function createBuildEngine({ root, signer, now = Date.now, hooks = {}, tickMs = 100, activityFlushMs = 250 }) {
  const D = { runs: path.join(root, 'runs'), receipts: path.join(root, 'receipts'), cancel: path.join(root, 'cancel') }
  for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  const UUID = /^[0-9a-f-]{36}$/
  const need = id => { if (!UUID.test(String(id))) refuse('BROKER_STATE', 'build', 'Invalid execution id'); return id }
  const active = new Map() // execId -> {terminate()} for child processes owned by THIS process
  const inflight = new Set() // execIds whose stage run is currently DRIVEN by this engine (even after the child exited): their state is only ever written by that runner
  const fault = (p, stage) => hooks.fault?.(p, stage)

  // ---------------------------------------------------------------- immutable lineage receipts (append-only, hash-chained)
  const rfile = (execId, n, kind) => path.join(D.receipts, `${need(execId)}.${String(n).padStart(4, '0')}.${kind}.json`)
  function listReceipts(execId) {
    need(execId); const out = []
    for (const name of fs.readdirSync(D.receipts).filter(x => x.startsWith(`${execId}.`) && x.endsWith('.json')).sort()) {
      const m = /^[0-9a-f-]{36}\.(\d{4})\.([A-Z]+)\.json$/.exec(name); if (!m) continue
      let rec = null, broken = false; try { rec = signer.open(JSON.parse(fs.readFileSync(path.join(D.receipts, name), 'utf8'))) } catch { broken = true }
      out.push({ n: Number(m[1]), kind: m[2], id: `${m[2]}.${Number(m[1])}`, file: name, rec, broken })
    }
    return out.sort((a, b) => a.n - b.n)
  }
  function appendReceipt(execId, kind, body) {
    if (!RECEIPT_KINDS.includes(kind)) throw new Error('Invalid receipt kind')
    for (let tries = 0; tries < 20; tries++) {
      const list = listReceipts(execId), last = list.at(-1), n = (last?.n ?? 0) + 1
      if (!verifyChain(execId).ok) refuse('CONTROL_STORE_CORRUPT', 'build', 'Lineage chain is broken (tampered, missing or reordered receipt); operator review required') // any break, not only the newest receipt
      const core = { execId, seq: n, kind, at: now(), prev: last?.rec?.digest ?? null, body }, rec = { ...core, digest: hash(canonical(core)) }
      if (createExclusive(rfile(execId, n, kind), JSON.stringify(signer.seal(rec)))) return { id: `${kind}.${n}`, ...rec }
    }
    refuse('CONTROL_STORE_CORRUPT', 'build', 'Could not append a lineage receipt')
  }
  function verifyChain(execId) {
    const list = listReceipts(execId), problems = []; let prev = null
    list.forEach((r, i) => {
      if (r.broken) { problems.push({ id: r.id, code: 'RECEIPT_TAMPERED' }); return }
      if (r.n !== i + 1) problems.push({ id: r.id, code: 'RECEIPT_GAP' })
      const { digest, ...core } = r.rec
      if (hash(canonical(core)) !== digest) problems.push({ id: r.id, code: 'RECEIPT_TAMPERED' }); if ((r.rec.prev ?? null) !== prev) problems.push({ id: r.id, code: 'CHAIN_BROKEN' }); prev = r.rec.digest
    })
    return { ok: problems.length === 0, problems, count: list.length }
  }
  const receipts = (execId, kind) => listReceipts(execId).filter(r => !r.broken && (!kind || r.kind === kind))

  // ---------------------------------------------------------------- mutable run state
  const runFile = (execId, stage, n) => path.join(D.runs, `${need(execId)}.${stage}.${n}.json`)
  const runDir = (execId, stage, n) => path.join(D.runs, `${need(execId)}.${stage}.${n}`)
  const loadRunFile = f => { const r = readJson(f); return r ? signer.open(r) : null }
  function runsFor(execId, stage) {
    need(execId); const out = []
    for (const name of fs.readdirSync(D.runs).filter(x => x.startsWith(`${execId}.${stage}.`) && /\.\d+\.json$/.test(x))) { try { out.push(loadRunFile(path.join(D.runs, name))) } catch { out.push({ broken: true, file: name, state: 'UNKNOWN_AFTER_CRASH', attempt: Number(/\.(\d+)\.json$/.exec(name)[1]), inputDigest: null }) } }
    return out.sort((a, b) => a.attempt - b.attempt)
  }
  function saveRun(rec, patch = {}, event) {
    const cur = readJson(runFile(rec.execId, rec.stage, rec.attempt)); if (cur && signer.open(cur).seq !== rec.seq) refuse('CONTROL_STORE_CORRUPT', 'build', 'Concurrent run-state update')
    const next = { ...rec, ...patch, seq: rec.seq + 1, history: event ? [...rec.history, { at: now(), state: patch.state ?? rec.state, event }].slice(-60) : rec.history }
    atomicWrite(runFile(rec.execId, rec.stage, rec.attempt), JSON.stringify(signer.seal(next)), 0o600); return next
  }
  function createRun(base) {
    for (let attempt = (runsFor(base.execId, base.stage).at(-1)?.attempt ?? 0) + 1; attempt < 50; attempt++) {
      const rec = { ...base, attempt, seq: 0, history: [{ at: now(), state: 'PLANNED', event: 'PLANNED' }] }
      if (createExclusive(runFile(base.execId, base.stage, attempt), JSON.stringify(signer.seal(rec)))) return rec
    }
    refuse('CONTROL_STORE_CORRUPT', 'build', 'Could not create a run record')
  }
  const outDirOf = r => path.join(runDir(r.execId, r.stage, r.attempt), 'out')

  // ---------------------------------------------------------------- cancellation record
  const cfile = execId => path.join(D.cancel, `${need(execId)}.json`)
  const loadCancel = execId => { const r = readJson(cfile(execId)); return r ? signer.open(r) : null }
  function saveCancel(c, patch, event) { const next = { ...c, ...patch, seq: c.seq + 1, history: [...c.history, { at: now(), state: patch.state ?? c.state, event }] }; atomicWrite(cfile(c.execId), JSON.stringify(signer.seal(next)), 0o600); return next }
  const cancelState = execId => loadCancel(execId)?.state ?? null

  /** The run's output dir must still be the very directory the run created (not a symlink, not a swapped/recreated copy): content equality alone is not provenance. */
  function outDirIntact(run) {
    try { const rdd = runDir(run.execId, run.stage, run.attempt), a = fs.lstatSync(rdd), o = fs.lstatSync(path.join(rdd, 'out')); return !a.isSymbolicLink() && !o.isSymbolicLink() && o.isDirectory() && (run.outDirIno == null || fs.statSync(path.join(rdd, 'out'), { bigint: true }).ino.toString() === run.outDirIno) } catch { return false }
  }
  function artifactsOk(execId, stage, run) {
    const rc = receipts(execId, stage === 'build' ? 'BUILD' : 'PACKAGE').find(r => r.id === run.receiptId); if (!rc?.rec.body.manifest) return false
    return outDirIntact(run) && verifyManifest(rc.rec.body.manifest, outDirOf(run), {}).ok && scanOutputDir(outDirOf(run), rc.rec.body.manifest.entries.map(e => e.path)).problems.length === 0
  }
  // ---------------------------------------------------------------- effect decision (idempotency + duplicate prevention)
  const reconDecisionFor = (execId, stage, attempt) => receipts(execId, 'RECONCILIATION').map(r => r.rec.body).filter(b => b.stage === stage && b.attempt === attempt).at(-1)?.decision ?? null
  function markUnknown(run) { return saveRun(run, { state: 'UNKNOWN_AFTER_CRASH', unknownAt: now(), outputs: describeOutputs(run) }, 'MARKED_UNKNOWN_AFTER_CRASH') }
  function describeOutputs(run) { try { const f = scanOutputDir(outDirOf(run), []).found; return f.length ? 'PRESENT_PROVENANCE_UNKNOWN' : 'NONE' } catch { return 'NONE' } }
  function decide({ execId, stage, inputDigest, recipe }) {
    const all = runsFor(execId, stage), same = all.filter(r => r.inputDigest === inputDigest)
    const passed = same.filter(r => r.state === 'PASSED').at(-1)
    if (passed) { if (artifactsOk(execId, stage, passed)) return { action: 'ALREADY_PASSED', run: passed }; if (reconDecisionFor(execId, stage, passed.attempt) !== 'RETRY') refuse('RECONCILIATION_REQUIRED', 'build', 'The artifacts of the previously PASSED attempt no longer verify; an operator must reconcile (RETRY) before a rebuild', { observed: { stage, attempt: passed.attempt } }) }
    for (const r of all) if (['STARTING', 'RUNNING'].includes(r.state)) { // ANY live run of this stage (even for other inputs) forbids a duplicate
      if (procState(r.pid, r.procToken) === 'ALIVE') refuse('WORKSPACE_BUSY', 'build', `A ${stage} process for this execution is still running (pid known, start time verified); no duplicate is started`, { observed: { stage, attempt: r.attempt } })
      markUnknown(r)
    }
    const fresh = runsFor(execId, stage), latest = fresh.filter(r => r.inputDigest === inputDigest).at(-1)
    if (latest) {
      if (latest.state === 'PLANNED') saveRun(latest, { state: 'INTERRUPTED', failureCode: 'NEVER_LAUNCHED' }, 'NEVER_LAUNCHED') // nothing was launched: safe to start again
      else if (latest.state === 'UNKNOWN_AFTER_CRASH') { if (reconDecisionFor(execId, stage, latest.attempt) !== 'RETRY') refuse('RECONCILIATION_REQUIRED', 'build', 'A previous attempt has an unknown outcome after a crash; reconcile (RETRY/ABANDON) before any rerun', { observed: { stage, attempt: latest.attempt, outputs: latest.outputs ?? null } }) }
      else if (latest.state === 'FAILED') { const ok = RETRYABLE.has(latest.failureCode) && same.length < recipe.maxAttempts; if (!ok && reconDecisionFor(execId, stage, latest.attempt) !== 'RETRY') refuse('RECONCILIATION_REQUIRED', 'build', 'The previous attempt failed and policy does not allow an automatic retry', { observed: { stage, attempt: latest.attempt, code: latest.failureCode } }) }
      else if (latest.state === 'CANCELLED') refuse('CANCELLED', 'build', 'This stage was cancelled')
    }
    if (same.length >= 3) refuse('RECONCILIATION_REQUIRED', 'build', 'Retry cap reached for these inputs')
    return { action: 'RUN' }
  }

  // ---------------------------------------------------------------- termination helper (works for our child or a foreign pid after restart)
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  async function terminatePid(pid, token, graceMs, { cancellable = true } = {}) {
    if (!cancellable) return { signalled: null, exited: procState(pid, token) !== 'ALIVE', escalated: false, ack: 'UNCONFIRMED' }
    if (procState(pid, token) !== 'ALIVE') return { signalled: null, exited: true, escalated: false, ack: 'ALREADY_EXITED' }
    try { process.kill(pid, 'SIGTERM') } catch { return { signalled: null, exited: procState(pid, token) !== 'ALIVE', escalated: false, ack: 'UNCONFIRMED' } }
    const until = now() + graceMs; while (now() < until && procState(pid, token) === 'ALIVE') await sleep(20)
    if (procState(pid, token) !== 'ALIVE') return { signalled: 'SIGTERM', exited: true, escalated: false, ack: 'EXITED_AFTER_SIGTERM' }
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } const u2 = now() + 1500; while (now() < u2 && procState(pid, token) === 'ALIVE') await sleep(20)
    const dead = procState(pid, token) !== 'ALIVE'; return { signalled: 'SIGKILL', exited: dead, escalated: true, ack: dead ? 'EXITED_AFTER_SIGKILL' : 'UNCONFIRMED' }
  }

  // ---------------------------------------------------------------- run one stage
  /** ctx: {execId, stage, recipe, input{digest,components}, workspaceRoot, inDir?, inputNow(), binds, upstream?, stageChecks[], runCheck(id,{root,manifest,signal,stage}), poll(), toolVersion?} */
  async function runStage(ctx) {
    if (inflight.has(ctx.execId)) refuse('WORKSPACE_BUSY', 'build', 'A stage is already being driven for this execution')
    inflight.add(ctx.execId); try { return await runStageInner(ctx) } finally { inflight.delete(ctx.execId) }
  }
  async function runStageInner(ctx) {
    const { execId, stage, recipe, input } = ctx
    if (cancelState(execId)) refuse('CANCELLED', 'build', 'Build/package work was cancelled for this execution')
    const dec = decide({ execId, stage, inputDigest: input.digest, recipe }); if (dec.action === 'ALREADY_PASSED') return { reused: true, run: dec.run, receipt: receipts(execId, stage === 'build' ? 'BUILD' : 'PACKAGE').find(r => r.id === dec.run.receiptId) ?? null }
    const effectId = `eff-${hash(`${execId}|${stage}|${input.digest}`).slice(0, 24)}`, runId = randomUUID()
    let run = createRun({ execId, stage, effectId, state: 'PLANNED', inputDigest: input.digest, components: input.components, recipe: { id: recipe.id, version: recipe.version, digest: recipe.digest }, runId, plannedAt: now(), expectedOutputs: recipe.outputs.map(o => o.relPath), cancellable: recipe.cancellable, graceMs: recipe.graceMs })
    fault('after-plan', stage)
    // drift of the recipe script is re-checked at the last moment
    if (recipe.currentScriptDigest() !== recipe.scriptDigest) { run = saveRun(run, { state: 'FAILED', failureCode: 'TOOL_DRIFT', finishedAt: now() }, 'TOOL_DRIFT'); return finish(ctx, run, { status: 'REFUSED', failureCode: 'TOOL_DRIFT', evidence: 'recipe script changed since registration' }) }
    const rd = runDir(execId, stage, run.attempt), outDir = path.join(rd, 'out')
    fs.rmSync(rd, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
    const startedAt = now(), nonce = randomBytes(12).toString('hex')
    fs.writeFileSync(path.join(rd, '.bp-run.json'), JSON.stringify(signer.seal({ runId, execId, stage, attempt: run.attempt, inputDigest: input.digest, nonce, startedAt })), { mode: 0o600 })
    const pre = scanOutputDir(outDir, []); const ino = fs.statSync(outDir, { bigint: true }).ino.toString()
    run = saveRun(run, { state: 'STARTING', startedAt, lastActivityAt: startedAt, outDirIno: ino, preInventory: pre.found.length }, 'STARTING')
    fault('before-launch', stage)
    const flags = ['--permission', `--allow-fs-read=${recipe.scriptPath}`, `--allow-fs-write=${outDir}`]
    const readDirs = []; if (recipe.readScopes.includes('workspace')) readDirs.push(ctx.workspaceRoot); if (recipe.readScopes.includes('input') && ctx.inDir) readDirs.push(ctx.inDir)
    for (const d of readDirs) flags.push(`--allow-fs-read=${d}`)
    const env = { PATH: process.env.PATH ?? '', LC_ALL: 'C', BP_OUT: outDir, BP_RUN_ID: runId, BP_INPUT_DIGEST: input.digest, BP_STAGE: stage, ...(ctx.inDir ? { BP_IN: ctx.inDir } : {}), ...recipe.envFixed }
    for (const n of recipe.envNames) if (process.env[n] !== undefined) env[n] = process.env[n]
    const cwd = recipe.workdir === 'input' && ctx.inDir ? ctx.inDir : ctx.workspaceRoot
    let child, lastOut = startedAt, tail = '', progress = null, killedBy = null, spawnErr = false
    try { child = spawn(recipe.cmd, [...flags, recipe.scriptPath, ...recipe.args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env }) } catch { spawnErr = true }
    if (spawnErr || !child) { run = saveRun(run, { state: 'FAILED', failureCode: 'TOOL_UNAVAILABLE', finishedAt: now() }, 'SPAWN_FAILED'); return finish(ctx, run, { status: 'FAIL', failureCode: 'TOOL_UNAVAILABLE', evidence: 'tool could not be started' }) }
    child.on('error', () => { spawnErr = true })
    const exited = new Promise(res => child.on('exit', (code, sig) => res({ code, sig })))
    run = saveRun(run, { state: 'RUNNING', pid: child.pid, procToken: procToken(child.pid), launchedAt: now() }, 'LAUNCHED')
    fault('after-launch', stage)
    const onData = d => { lastOut = now(); const t = String(d); tail = (tail + t).slice(-4000); if (recipe.progress === 'bp-json') for (const line of t.split('\n')) if (line.startsWith('BP_PROGRESS ')) { try { const p = JSON.parse(line.slice(12)); progress = { step: Number.isInteger(p.step) ? p.step : null, total: Number.isInteger(p.total) ? p.total : null, note: typeof p.note === 'string' ? scrub(p.note).slice(0, 120) : null } } catch { /* ignore malformed */ } } }
    child.stdout.on('data', onData); child.stderr.on('data', onData)
    const t0 = now(); let lastFlush = 0
    const stopWith = async why => { if (killedBy) return; killedBy = why; await terminatePid(child.pid, run.procToken, why === 'cancel' ? recipe.graceMs : 0) }
    active.set(execId, { terminate: async () => { killedBy ??= 'cancel'; const r = await terminatePid(child.pid, run.procToken, recipe.graceMs, { cancellable: recipe.cancellable }); return r } })
    const timer = setInterval(() => {
      try {
        if (now() - t0 > recipe.timeoutMs && !killedBy) { killedBy = 'timeout'; try { child.kill('SIGKILL') } catch { /* gone */ } }
        if (!killedBy && cancelState(execId)) stopWith('cancel')
        if (!killedBy) { const p = ctx.poll?.(); if (p) { killedBy = `authority:${String(p).slice(0, 40)}`; try { child.kill('SIGKILL') } catch { /* gone */ } } }
        // activity = observed output; heartbeat = the process was still alive; neither is a progress claim
        if (now() - lastFlush >= activityFlushMs) { lastFlush = now(); run = saveRun(run, { lastActivityAt: lastOut, lastHeartbeatAt: now(), lastOutputAt: lastOut, progress, elapsedMs: now() - startedAt }, undefined) }
      } catch { /* best effort heartbeat; a lost record is detected by classification */ }
    }, tickMs)
    const { code, sig } = await exited; clearInterval(timer); active.delete(execId)
    const finishedAt = now(), evidence = scrub(tail.trim() || (code === 0 ? 'ok' : `exit ${code ?? sig}`), [ctx.workspaceRoot, outDir, rd])
    const base = { finishedAt, exitCode: code ?? null, lastActivityAt: lastOut, lastHeartbeatAt: finishedAt, lastOutputAt: lastOut, progress, elapsedMs: finishedAt - startedAt }
    if (cancelState(execId) || killedBy === 'cancel') { run = saveRun(run, { ...base, state: 'CANCELLED', failureCode: 'CANCELLED' }, 'CANCELLED'); return finish(ctx, run, { status: 'CANCELLED', failureCode: 'CANCELLED', evidence }) }
    if (killedBy?.startsWith('authority')) { run = saveRun(run, { ...base, state: 'INTERRUPTED', failureCode: 'HOST_AUTHORITY_STOPPED' }, 'INTERRUPTED'); return finish(ctx, run, { status: 'REFUSED', failureCode: 'HOST_AUTHORITY_STOPPED', evidence: `stopped: ${killedBy.slice(10)}` }) }
    const fail = (failureCode, ev, extra = {}) => { const r = saveRun(run, { ...base, state: 'FAILED', failureCode }, 'FAILED'); return finish(ctx, r, { status: 'FAIL', failureCode, evidence: ev ?? evidence, ...extra }) }
    if (killedBy === 'timeout') return fail('STAGE_TIMEOUT')
    if (code !== 0) return fail(stage === 'build' ? 'BUILD_FAILED' : 'PACKAGE_FAILED')
    // ---- post-run verification: inventory, provenance, manifest, input stability, host stage checks
    const scan = scanOutputDir(outDir, recipe.outputs.map(o => o.relPath)); if (scan.problems.length) return fail(scan.problems[0].code, `unexpected output state: ${scan.problems.map(p => `${p.code}:${p.path}`).slice(0, 5).join(', ')}`, { file: scan.problems[0].path })
    const missing = recipe.outputs.filter(o => !scan.found.includes(o.relPath)); if (missing.length) return fail(stage === 'build' ? 'BUILD_OUTPUT_MISSING' : 'PACKAGE_OUTPUT_MISSING', `missing declared output(s): ${missing.map(m => m.logicalName).join(', ')}`)
    let markerOk = false; try { const m = signer.open(JSON.parse(fs.readFileSync(path.join(rd, '.bp-run.json'), 'utf8'))); markerOk = m.runId === runId && m.nonce === nonce && fs.statSync(outDir, { bigint: true }).ino.toString() === ino } catch { markerOk = false }
    if (!markerOk) return fail('ARTIFACT_PROVENANCE_UNKNOWN', 'run marker or output directory identity does not match this run')
    let manifest; try { manifest = buildManifest({ root: outDir, refs: recipe.outputs, stage, binds: { ...ctx.binds, runId }, notBeforeMs: startedAt, now }) } catch (e) { return fail(e.code === 'ARTIFACT_MISMATCH' && /predates/.test(e.message) ? 'ARTIFACT_PROVENANCE_UNKNOWN' : 'ARTIFACT_MISMATCH', e.message ?? 'artifact manifest failed', { file: e.path }) }
    const nowIn = await ctx.inputNow(); if (nowIn.digest !== input.digest) return fail('SOURCE_CHANGED_DURING_STAGE', `bound inputs changed while the stage ran: ${diffComponents(input.components, nowIn.components).join(', ')}`)
    for (const id of ctx.stageChecks ?? []) { let r; try { r = await ctx.runCheck(id, { root: outDir, manifest, stage }) } catch { r = { status: 'ERROR' } } if (r?.status !== 'PASS') return fail('STAGE_CHECK_FAILED', `host stage check ${id} did not pass`, { failedCheck: id }) }
    if (cancelState(execId)) { run = saveRun(run, { ...base, state: 'CANCELLED', failureCode: 'CANCELLED' }, 'CANCELLED'); return finish(ctx, run, { status: 'CANCELLED', failureCode: 'CANCELLED', evidence }) } // cancellation observed late still never becomes success
    run = saveRun(run, { ...base }, 'POST_VERIFIED') // exit facts are durable BEFORE the receipt; the state stays RUNNING until the receipt exists (a crash here is UNKNOWN_AFTER_CRASH)
    fault('before-receipt', stage)
    const done = finish(ctx, run, { status: 'PASS', evidence, manifest, base }); fault('after-receipt', stage); return done
  }

  /** Every terminal outcome becomes an IMMUTABLE receipt (history is never overwritten); the run state is then closed with the receipt id. */
  function finish(ctx, run, r) {
    const { stage, recipe, input } = ctx, kind = stage === 'build' ? 'BUILD' : 'PACKAGE', terminal = r.status === 'PASS' ? 'PASSED' : r.status === 'CANCELLED' ? 'CANCELLED' : r.status === 'REFUSED' ? (run.state === 'INTERRUPTED' ? 'INTERRUPTED' : 'FAILED') : 'FAILED'
    const failure = r.status === 'PASS' ? null : structuredError({ stage, code: r.failureCode ?? 'UNKNOWN', file: r.file ?? null, failedCheck: r.failedCheck ?? null, observed: r.evidence, evidenceRef: null })
    const rec = appendReceipt(ctx.execId, kind, { stage, status: terminal, runId: run.runId, attempt: run.attempt, effectId: run.effectId, inputDigest: input.digest, components: input.components, recipe: { id: recipe.id, version: recipe.version, digest: recipe.digest },
      toolIdentity: `node:${recipe.id}@${recipe.version}:${recipe.scriptDigest.slice(0, 12)}`, toolVersion: process.version, startedAt: run.startedAt ?? run.plannedAt, finishedAt: run.finishedAt ?? now(), lastActivityAt: run.lastActivityAt ?? null, exitCode: run.exitCode ?? null, progress: run.progress ?? null,
      evidence: r.evidence ?? '', manifest: r.manifest ?? null, verification: r.manifest ? r.manifest.entries.map(e => ({ logicalName: e.logicalName, status: 'VERIFIED' })) : [], upstream: ctx.upstream ?? null, failure, scope: ctx.scopeLabel ?? 'ISOLATED_FIXTURE' })
    const closed = saveRun(run, { state: terminal, receiptId: rec.id, ...(r.base ?? {}) }, 'RECEIPT_WRITTEN')
    return { reused: false, run: closed, receipt: rec }
  }

  // ---------------------------------------------------------------- cancellation
  async function cancel({ execId, actor, reason = '' }) {
    need(execId); let c = loadCancel(execId)
    if (!c) { c = { execId, state: 'CANCEL_REQUESTED', requestedBy: String(actor ?? 'unknown').slice(0, 120), reason: scrub(reason).slice(0, 200), requestedAt: now(), seq: 0, history: [{ at: now(), state: 'CANCEL_REQUESTED', event: 'REQUESTED' }], targets: [], ack: null }; if (!createExclusive(cfile(execId), JSON.stringify(signer.seal(c)))) c = loadCancel(execId) }
    if (['CANCELLED', 'CANCEL_UNCONFIRMED'].includes(c.state)) return c
    const local = active.get(execId); let res = null, unprovable = false
    if (inflight.has(execId) && !local) { /* the runner is past the process (post-run checks): it observes the cancel record itself */ }
    else if (local) { c = saveCancel(c, { state: 'CANCEL_SIGNALLED', signalledAt: now() }, 'SIGNALLED_LOCAL'); res = await local.terminate() }
    else {
      for (const r of runsFor(execId, 'build').concat(runsFor(execId, 'package'))) {
        if (['STARTING', 'RUNNING'].includes(r.state) && !r.pid) { unprovable = true; continue } // launched? unknowable: never claim a clean stop
        if (!['STARTING', 'RUNNING'].includes(r.state)) continue
        if (procState(r.pid, r.procToken) !== 'ALIVE') { markUnknown(r); continue }
        c = saveCancel(c, { state: 'CANCEL_SIGNALLED', signalledAt: now(), targets: [...c.targets, { stage: r.stage, attempt: r.attempt, pid: r.pid }] }, 'SIGNALLED_FOREIGN')
        res = await terminatePid(r.pid, r.procToken, (r.recipe && r.graceMs) || 1000, { cancellable: r.cancellable !== false })
        if (res.exited) saveRun(runsFor(execId, r.stage).find(x => x.attempt === r.attempt), { state: 'CANCELLED', failureCode: 'CANCELLED', finishedAt: now() }, 'CANCELLED_BY_SIGNAL')
      }
    }
    const confirmed = (!res || res.exited) && !unprovable
    c = saveCancel(c, { state: confirmed ? 'CANCELLED' : 'CANCEL_UNCONFIRMED', finalAt: now(), ack: res ? { signal: res.signalled, ack: res.ack, escalated: res.escalated } : { signal: null, ack: unprovable ? 'UNPROVABLE_PROCESS_STATE' : 'NO_RUNNING_PROCESS', escalated: false } }, confirmed ? 'CANCELLED' : 'UNCONFIRMED')
    appendReceipt(execId, 'CANCELLATION', { state: c.state, requestedBy: c.requestedBy, reason: c.reason, ack: c.ack })
    return c
  }

  // ---------------------------------------------------------------- reconciliation (explicit operator decision about an UNKNOWN/FAILED attempt)
  function reconcile({ execId, stage, actor, decision, reason = '' }) {
    if (!['RETRY', 'ABANDON'].includes(decision)) refuse('BROKER_STATE', 'build', 'Decision must be RETRY or ABANDON')
    if (cancelState(execId)) refuse('CANCELLED', 'build', 'Work was cancelled for this execution')
    let latest = runsFor(execId, stage).at(-1); if (!latest) refuse('BROKER_STATE', 'build', 'No attempt to reconcile')
    if (['STARTING', 'RUNNING'].includes(latest.state)) { if (procState(latest.pid, latest.procToken) === 'ALIVE') refuse('WORKSPACE_BUSY', 'build', 'The process is still alive; it cannot be reconciled'); latest = markUnknown(latest) }
    if (!(['UNKNOWN_AFTER_CRASH', 'FAILED'].includes(latest.state) || (latest.state === 'PASSED' && !artifactsOk(execId, stage, latest)))) refuse('BROKER_STATE', 'build', `Attempt is ${latest.state}; nothing to reconcile`)
    return appendReceipt(execId, 'RECONCILIATION', { stage, attempt: latest.attempt, decision, actor: String(actor).slice(0, 120), reason: scrub(reason).slice(0, 200), stateAtDecision: latest.state, outputs: latest.outputs ?? describeOutputs(latest), note: 'outputs of an unknown run are never adopted (ARTIFACT_PROVENANCE_UNKNOWN)' })
  }

  // ---------------------------------------------------------------- classification (read-only)
  function classify({ execId, stage, inputDigest, recipe }) {
    const all = runsFor(execId, stage); const latest = all.at(-1)
    if (!latest) return { classification: 'SAFE_TO_RETRY', reasons: ['NOT_STARTED'] }
    const same = all.filter(r => r.inputDigest === inputDigest), passed = same.find(r => r.state === 'PASSED')
    if (passed) return artifactsOk(execId, stage, passed) ? { classification: 'ALREADY_PASSED', attempt: passed.attempt, reasons: [] } : { classification: reconDecisionFor(execId, stage, passed.attempt) === 'RETRY' ? 'SAFE_TO_RETRY' : 'NEEDS_OPERATOR_REVIEW', attempt: passed.attempt, reasons: ['PASSED_ARTIFACTS_NO_LONGER_VERIFY'] }
    if (all.some(r => r.state === 'PASSED')) return { classification: 'STALE_INPUTS', attempt: latest.attempt, reasons: ['PASSED_FOR_DIFFERENT_INPUTS'] }
    if (['STARTING', 'RUNNING'].includes(latest.state)) { const ps = procState(latest.pid, latest.procToken); if (ps === 'ALIVE') return { classification: 'IN_PROGRESS', attempt: latest.attempt, reasons: ['PROCESS_ALIVE'], lastActivityAt: latest.lastActivityAt }; return { classification: 'UNKNOWN_AFTER_CRASH', attempt: latest.attempt, reasons: [ps === 'UNKNOWN' ? 'PROCESS_STATE_UNPROVABLE' : 'PROCESS_GONE_NO_RECEIPT'], outputs: describeOutputs(latest) } }
    if (latest.state === 'PLANNED') return { classification: 'SAFE_TO_RETRY', attempt: latest.attempt, reasons: ['NEVER_LAUNCHED'] }
    if (latest.state === 'UNKNOWN_AFTER_CRASH') { const d = reconDecisionFor(execId, stage, latest.attempt); return d === 'RETRY' ? { classification: 'SAFE_TO_RETRY', attempt: latest.attempt, reasons: ['OPERATOR_DECIDED_RETRY'] } : { classification: d === 'ABANDON' ? 'NEEDS_OPERATOR_REVIEW' : 'UNKNOWN_AFTER_CRASH', attempt: latest.attempt, reasons: [d ? 'OPERATOR_ABANDONED' : 'RECONCILIATION_REQUIRED'], outputs: latest.outputs ?? null } }
    if (latest.state === 'FAILED') return { classification: RETRYABLE.has(latest.failureCode) && same.length < (recipe?.maxAttempts ?? 1) ? 'SAFE_TO_RETRY' : 'NEEDS_OPERATOR_REVIEW', attempt: latest.attempt, reasons: [latest.failureCode ?? 'FAILED'] }
    return { classification: 'NEEDS_OPERATOR_REVIEW', attempt: latest.attempt, reasons: [latest.state] }
  }

  // ---------------------------------------------------------------- current lineage projection (history untouched; invalidations are APPENDED once per observation)
  /** now = {build:{components,digest}, package:{components,digest}, dependencies:{digest}, source:{components}} */
  function current(execId, nowIn, { record = false } = {}) {
    const latestOf = kind => receipts(execId, kind).at(-1) ?? null, out = {}
    const src = latestOf('SOURCE'); out.source = src ? (c => (c.length ? { status: 'STALE', receiptId: src.id, changed: c } : { status: 'CURRENT', receiptId: src.id }))(diffComponents(src.rec.body.components, nowIn.source.components)) : { status: 'NOT_RUN' }
    const dep = latestOf('DEPENDENCIES'); out.dependencies = dep ? { status: dep.rec.body.digest === nowIn.dependencies.digest ? (dep.rec.body.allUsable ? 'CURRENT' : 'NOT_USABLE') : 'STALE', receiptId: dep.id, digest: dep.rec.body.digest } : { status: 'NOT_RUN' }
    out.build = stageStatus(execId, 'BUILD', nowIn.build); const b = out.build
    out.package = stageStatus(execId, 'PACKAGE', nowIn.package)
    if (out.package.status === 'CURRENT' && b.status !== 'CURRENT') out.package = { ...out.package, status: b.status === 'REQUIRES_REBUILD' ? 'REQUIRES_REBUILD' : b.status === 'UNUSABLE' ? 'UNUSABLE' : 'STALE', changed: ['BUILD_NOT_CURRENT'], reason: 'BUILD_NOT_CURRENT' }
    if (out.package.status === 'CURRENT' && out.package.upstreamBuildReceiptId !== b.receiptId) out.package = { ...out.package, status: 'STALE', changed: ['BUILD_RECEIPT_REPLACED'], reason: 'BUILD_RECEIPT_REPLACED' }
    const ver = latestOf('VERIFICATION')?.rec.body
    for (const [k, st] of [['build', 'BUILD'], ['package', 'PACKAGE']]) if (out[k].status === 'CURRENT' && ver && ver.at > (receipts(execId, st).at(-1)?.rec.at ?? 0) && ver[k] && !ver[k].ok) out[k] = { ...out[k], status: 'UNUSABLE', reason: 'ARTIFACT_VERIFICATION_FAILED', problems: ver[k].problems.slice(0, 5) }
    if (out.build.status === 'UNUSABLE' && out.package.status === 'CURRENT') out.package = { ...out.package, status: 'UNUSABLE', reason: 'BUILD_UNUSABLE' }
    // append-only invalidation observations (idempotent per receipt + observed inputs)
    const have = new Set(receipts(execId, 'INVALIDATION').map(r => `${r.rec.body.receiptId}|${r.rec.body.nowDigest}|${r.rec.body.status}`))
    if (record) for (const [stage, st] of Object.entries(out)) if (['STALE', 'REQUIRES_REBUILD', 'UNUSABLE'].includes(st.status) && st.receiptId) { const nd = (nowIn[stage]?.digest ?? nowIn.dependencies?.digest) ?? null; const key = `${st.receiptId}|${nd}|${st.status}`; if (!have.has(key)) { appendReceipt(execId, 'INVALIDATION', { stage, receiptId: st.receiptId, status: st.status, changed: st.changed ?? [], reason: st.reason ?? (st.changed ?? []).join(','), nowDigest: nd }); have.add(key) } }
    return out
  }
  function stageStatus(execId, kind, nowStage) {
    const list = receipts(execId, kind); if (!list.length) return { status: 'NOT_RUN' }
    const last = list.at(-1), body = last.rec.body
    if (body.status !== 'PASSED') return { status: body.status, receiptId: last.id, failureCode: body.failure?.code ?? null }
    const changed = diffComponents(body.components, nowStage.components), stale = changed.filter(k => STALE_GROUP.includes(k))
    const upstreamBuildReceiptId = body.upstream?.buildReceiptId ?? null
    if (kind === 'BUILD' ? stale.length : false) return { status: 'STALE', receiptId: last.id, changed, upstreamBuildReceiptId }
    if (changed.length) return { status: kind === 'BUILD' ? 'REQUIRES_REBUILD' : 'REQUIRES_REBUILD', receiptId: last.id, changed, upstreamBuildReceiptId }
    return { status: 'CURRENT', receiptId: last.id, upstreamBuildReceiptId, manifestDigest: body.manifest?.manifestDigest ?? null }
  }

  /** Re-verify the artifacts of the newest PASSED build/package receipts against disk (read-only on artifacts; appends one VERIFICATION receipt per distinct result). */
  function verifyArtifacts(execId, { expected = {} } = {}) {
    const res = {}
    for (const [k, kind] of [['build', 'BUILD'], ['package', 'PACKAGE']]) {
      const last = receipts(execId, kind).filter(r => r.rec.body.status === 'PASSED').at(-1); if (!last) { res[k] = null; continue }
      const run = runsFor(execId, k).find(r => r.runId === last.rec.body.runId)
      const v = run ? verifyManifest(last.rec.body.manifest, outDirOf(run), expected[k] ?? {}) : { ok: false, problems: [{ code: 'RUN_RECORD_MISSING' }] }
      let provenance = 'VERIFIED'; try { const m = signer.open(JSON.parse(fs.readFileSync(path.join(runDir(execId, k, run.attempt), '.bp-run.json'), 'utf8'))); if (m.runId !== last.rec.body.runId || m.inputDigest !== last.rec.body.inputDigest) provenance = 'ARTIFACT_PROVENANCE_UNKNOWN' } catch { provenance = 'ARTIFACT_PROVENANCE_UNKNOWN' }
      const scan = run ? scanOutputDir(outDirOf(run), last.rec.body.manifest.entries.map(e => e.path)) : { problems: [] }
      const problems = [...v.problems, ...scan.problems, ...(provenance === 'VERIFIED' ? [] : [{ code: provenance }]), ...(run && !outDirIntact(run) ? [{ code: 'ARTIFACT_PROVENANCE_UNKNOWN', detail: 'OUTPUT_DIR_REPLACED' }] : [])]
      res[k] = { ok: problems.length === 0, receiptId: last.id, problems }
    }
    const sig = hash(canonical(res)), prev = receipts(execId, 'VERIFICATION').at(-1)
    const rec = prev && prev.rec.body.sig === sig ? prev : appendReceipt(execId, 'VERIFICATION', { sig, at: now(), build: res.build, package: res.package })
    return { ...res, receiptId: rec.id }
  }
  return Object.freeze({ root, receipts, listReceipts, appendReceipt, verifyChain, runsFor, runStage, cancel, cancelState, reconcile, classify, current, verifyArtifacts, decide, outDirOf, runDir, loadCancel, isRunning: execId => active.has(execId) })
}
