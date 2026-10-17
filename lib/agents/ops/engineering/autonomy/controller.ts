import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentOpsLog } from '../../log'
import { resolveBin, runTool } from '../missions/toolchain'
import { deriveAssignments, interruptAssignment, pauseAssignment } from '../assignments'
import { assessLiveness } from '../missions/liveness'
import { realFacts, reconcileMissions, resumability } from '../missions/reconcile'
import { cancelMission, resumeMission, MissionError } from '../missions/runner'
import { ACTIVE_STATES, type MissionRecord } from '../missions/types'
import { missionView, startFromApi, type MissionView } from '../missions/service'
import type { RunnerDeps } from '../missions/runner'
import { haltAllActivity, activitySnapshot, releaseActivityHold } from '../runtime/activity'
import { probeCapabilities, type Capability } from './capabilities'
import { clearEmergencyStop, isEmergencyStopped, readConfig, readEmergencyStop, setPaused, updateConfig, writeEmergencyStop, type AutonomyConfig, type ConfigPatch, type EmergencyStop } from './config'
import { interpret, type InterpretDeps } from './interpret'
import { findSsrHazards, ssrAdvice } from './ssr'
import { judgeResources, readResources, type ResourceVerdict } from './resources'
import { CommandStore, isCommandId } from './store'
import { applyRung, diagnose, nextRung, splitSubtask, type MissionFacts } from './strategy'
import { TERMINAL_COMMAND_STATES, type CommandOrigin, type CommandRecord, type CommandState, type CommandStep, type DeliveryLadder, type Diagnosis, type Rung, type Subtask } from './types'

export class ControllerError extends Error {
  constructor(public readonly code: 'AUTONOMY_OFF' | 'STOPPED' | 'NO_REPO' | 'INVALID' | 'NOT_FOUND' | 'ILLEGAL' | 'BUSY', msg: string) { super(msg) }
}

export type UiProofResult = { passed: boolean; steps: { label: string; ok: boolean; detail: string }[]; dir: string; error?: string }
export type PromoteResult = { ok: boolean; detail: string; launcher?: string; previousTarget?: string; backup?: string }

export type ControllerDeps = {
  log: AgentOpsLog
  runner: RunnerDeps
  adir: string
  repo: () => string | null
  /** local model JSON drafting for wording only (null when no model is warm) */
  draftJson?: InterpretDeps['draftJson']
  /** replaces the interpreter (tests only) */
  planner?: (text: string, deps: InterpretDeps) => ReturnType<typeof interpret>
  resources?: (builder: string | null) => Promise<ResourceVerdict>
  proveUi?: (input: { command: CommandRecord; installPath: string; outDir: string }) => Promise<UiProofResult>
  promote?: (input: { command: CommandRecord; installPath: string }) => Promise<PromoteResult>
  /** writes a message into the originating conversation; returns its id */
  post?: (origin: CommandOrigin, family: string, content: string, metadata: Record<string, unknown>) => string | null
  now?: () => Date
}

const MUTEX = Symbol.for('war-room.autonomy.advance')
const PROVING = Symbol.for('war-room.autonomy.proving')
const g = globalThis as unknown as Record<symbol, Promise<void> | Set<string> | undefined>
const proving = (): Set<string> => (g[PROVING] ??= new Set<string>()) as Set<string>

const ADVANCE_STALL_MS = 5 * 60_000
const MAX_RESOURCE_WAIT_MS = 15 * 60_000
const MAX_INFRA_RETRIES = 3

export type CommandView = CommandRecord & {
  mission: MissionView | null
  missionCount: number
  controls: ('pause' | 'resume' | 'cancel')[]
}

export type AutonomyStatus = {
  generatedAt: string
  config: AutonomyConfig
  emergencyStop: EmergencyStop | null
  capabilities: Capability[]
  resources: ResourceVerdict | null
  activity: ReturnType<typeof activitySnapshot>
  active: CommandView[]
  recent: CommandView[]
  workers: { missionId: string; workerId: string; pid: number; heartbeatAgeSec: number; progressAgeSec: number; note: string; builder: string }[]
}

export class AutonomyController {
  readonly commands: CommandStore
  private capCache: { at: number; rows: Capability[] } | null = null
  constructor(readonly deps: ControllerDeps) { this.commands = new CommandStore(deps.log, deps.adir) }
  private now() { return (this.deps.now ?? (() => new Date()))() }
  private cfg() { return readConfig(this.deps.adir) }

  // ------------------------------------------------------------------ commands
  /** One sentence in; a tracked mission out. Interpretation is local and fast; the mission id exists before this returns unless another mission holds the single builder. */
  async submit(text: string, origin: CommandOrigin, actor: string): Promise<{ commandId: string; missionId: string | null; state: CommandState; reason: string }> {
    if (isEmergencyStopped(this.deps.adir)) throw new ControllerError('STOPPED', 'Emergency Stop is active. Clear it (Commander) before Foundry accepts work.')
    const cfg = this.cfg()
    if (!cfg.fullAutonomy) throw new ControllerError('AUTONOMY_OFF', 'Full Autonomy is off. Turn it on once in the Autonomy Control Center and Foundry will take plain-language commands.')
    const repo = this.deps.repo()
    if (!repo) throw new ControllerError('NO_REPO', 'No engineering repository is configured on this machine (WAR_ROOM_ENGINEERING_REPO or engineering-config.json).')
    let planned
    try { planned = await (this.deps.planner ?? interpret)(text, { repo, draftJson: this.deps.draftJson }) } catch (e) { throw new ControllerError('INVALID', e instanceof Error ? e.message : String(e)) }
    const { interpretation: ip, verifyScripts } = planned
    const now = this.now()
    const id = this.commands.newId(now)
    const steps: CommandStep[] = ip.subtasks.map((s, i) => ({ n: i + 1, title: s.title, subtask: { ...s, ...(verifyScripts[s.n] ? { verifyKey: s.n } : {}) }, missions: [], state: 'PENDING', autoResumes: 0 }))
    const { subtasks, ...ipRest } = ip
    const rec: CommandRecord = {
      schema: 1, id, text: ip.commandText, origin, createdAt: now.toISOString(), createdBy: actor, state: 'QUEUED', stateReason: 'interpreted; waiting to start', stateAt: now.toISOString(),
      interpretation: { ...ipRest, subtaskTitles: subtasks.map((s) => s.title) }, steps, currentStep: 0,
      ladder: { codeGenerated: false, testsPassed: false, verificationPassed: false, buildCreated: false, installed: false, running: false, uiProof: ip.uiProof ? 'PENDING' : 'NOT_APPLICABLE', promoted: false },
      evidence: {}, diagnoses: {}, timeline: [{ at: now.toISOString(), kind: 'COMMAND', detail: `received: ${ip.commandText.slice(0, 200)}` }, { at: now.toISOString(), kind: 'INTERPRETED', detail: `${ip.kind}, ${ip.complexity}; ${steps.length} step(s); ${ip.interpretedBy}${ip.notes.length ? '; ' + ip.notes.join('; ') : ''}` }], posted: [],
    }
    this.commands.create(rec)
    for (const [n, script] of Object.entries(verifyScripts)) this.commands.writeVerify(id, Number(n), script)
    await this.advance()
    const cur = this.commands.read(id)!
    const last = cur.steps[cur.currentStep]?.missions.at(-1)
    return { commandId: id, missionId: last?.id ?? null, state: cur.state, reason: cur.stateReason }
  }

  // ------------------------------------------------------------------ the loop
  /** Advance every open command by at most one transition. Single-flight inside this process; every write is a locked read-modify-write, so another process cannot corrupt it. */
  advance(): Promise<void> {
    const prev = (g[MUTEX] as Promise<void> | undefined) ?? Promise.resolve()
    // a pass that never finishes must not freeze the controller forever: after 5 minutes later callers go ahead (every step is a guarded read-modify-write, so a late straggler is harmless) and the stall is recorded
    const wait = Promise.race([prev.catch(() => undefined), new Promise<void>((r) => { const t = setTimeout(() => { this.noteStall(); r() }, ADVANCE_STALL_MS); t.unref?.() })])
    const next = wait.then(() => this.advanceOnce())
    g[MUTEX] = next.catch(() => undefined)
    return next
  }

  private noteStall() { for (const c of this.openCommands()) this.commands.note(c.id, 'CONTROLLER_STALL', 'a previous controller pass did not finish within 5 minutes; continuing') }

  private async advanceOnce(): Promise<void> {
    if (isEmergencyStopped(this.deps.adir)) { this.markStopped(); return }
    const { log, runner } = this.deps
    reconcileMissions(log, runner.store)
    let startedThisPass = false
    for (const cmd of this.commands.list().reverse()) {
      if (TERMINAL_COMMAND_STATES.includes(cmd.state) || cmd.state === 'STOPPED') continue
      try { startedThisPass = (await this.advanceCommand(cmd, startedThisPass)) || startedThisPass } catch (e) {
        this.commands.note(cmd.id, 'CONTROLLER_ERROR', e instanceof Error ? e.message : String(e))
      }
    }
  }

  private setState(id: string, state: CommandState, reason: string, patch: (c: CommandRecord) => void = () => {}): CommandRecord {
    const at = this.now().toISOString()
    return this.commands.update(id, (c) => {
      if (TERMINAL_COMMAND_STATES.includes(c.state) && c.state !== state) return null
      const changed = c.state !== state || c.stateReason !== reason
      c.state = state; c.stateReason = reason; if (changed) { c.stateAt = at; c.timeline.push({ at, kind: state, detail: reason.slice(0, 400) }) }
      patch(c); return c
    })
  }

  private missionOf(step: CommandStep): MissionRecord | null { const id = step.missions.at(-1)?.id; return id ? this.deps.runner.store.read(id) : null }
  private anyActiveMission(exceptId?: string): MissionRecord | null {
    const f = realFacts()
    return this.deps.runner.store.list().find((m) => m.id !== exceptId && ACTIVE_STATES.includes(m.state) && assessLiveness(m, f).verdict !== 'DEAD') ?? null
  }

  /** Returns true when this pass started a mission (only one builder exists). */
  private async advanceCommand(cmd: CommandRecord, alreadyStarted: boolean): Promise<boolean> {
    const cfg = this.cfg()
    const step = cmd.steps[cmd.currentStep]
    if (!step) { this.setState(cmd.id, 'FAILED', 'the command has no step to run'); return false }
    if (cmd.state === 'PROVING') { this.ensureProof(cmd); return false }
    if (step.pendingRung) {
      if (step.retryNotBefore && Date.parse(step.retryNotBefore) > this.now().getTime()) { this.setState(cmd.id, 'WAITING_RESOURCES', `${cmd.stateReason.replace(/^waiting for the machine: /, 'waiting for the machine: ')}`.slice(0, 300)); return false }
      return this.tryStart(cmd, step, alreadyStarted, step.pendingRung)
    }
    const m = this.missionOf(step)
    if (!m) return this.tryStart(cmd, step, alreadyStarted, 'initial')
    this.mirrorProgress(cmd, step, m)
    if (ACTIVE_STATES.includes(m.state)) {
      const live = assessLiveness(m, realFacts())
      if (cfg.paused && m.state === 'RUNNING') this.setState(cmd.id, 'RUNNING', `pause requested; the mission stops at its next safe boundary (${m.stateReason})`)
      else this.setState(cmd.id, 'RUNNING', live.verdict === 'STALLED' ? `mission ${m.id} is alive but has made no progress for a while (${live.reason})` : `mission ${m.id} ${m.state.toLowerCase()}: ${m.stateReason}`.slice(0, 300))
      return false
    }
    if (m.state === 'INTERRUPTED') return this.handleInterrupted(cmd, step, m, cfg)
    if (m.state === 'COMPLETED') { await this.handleCompleted(cmd, step, m); return false }
    if (m.state === 'FAILED') return await this.handleFailed(cmd, step, m, alreadyStarted)
    if (m.state === 'CANCELLED') { this.setState(cmd.id, 'CANCELLED', `mission ${m.id} was cancelled: ${m.stateReason}`); return false }
    return false
  }

  private mirrorProgress(cmd: CommandRecord, step: CommandStep, m: MissionRecord) {
    const last = step.missions.at(-1)
    if (last && last.endState !== m.state && !ACTIVE_STATES.includes(m.state)) this.commands.update(cmd.id, (c) => { const s = c.steps[c.currentStep]; const l = s.missions.at(-1); if (l) l.endState = m.state; return c })
  }

  // ------------------------------------------------------------------ starting
  private async tryStart(cmd: CommandRecord, step: CommandStep, alreadyStarted: boolean, rung: Rung): Promise<boolean> {
    const cfg = this.cfg()
    if (!cfg.fullAutonomy) { this.setState(cmd.id, 'AWAITING_AUTHORITY', 'Full Autonomy was switched off; waiting for the Commander'); return false }
    if (cfg.paused) { this.setState(cmd.id, 'QUEUED', 'Foundry is paused; this command starts when it is resumed'); return false }
    const busy = this.anyActiveMission()
    if (busy || alreadyStarted) { this.setState(cmd.id, 'QUEUED', `waiting for mission ${busy?.id ?? 'in progress'}: one builder, one mission at a time`); return false }
    const repo = this.deps.repo()
    if (!repo) { this.setState(cmd.id, 'BLOCKED', 'the engineering repository is no longer configured'); return false }
    const builder = this.lineupBuilder()
    const verdict = await (this.deps.resources ?? ((b: string | null) => readResources().then((r) => judgeResources(r, b))))(builder)
    if (!verdict.ok) {
      const since = cmd.timeline.find((t) => t.kind === 'WAITING_RESOURCES')?.at
      if (since && this.now().getTime() - Date.parse(since) > MAX_RESOURCE_WAIT_MS) { this.setState(cmd.id, 'BLOCKED', `resources stayed unavailable for ${Math.round(MAX_RESOURCE_WAIT_MS / 60000)} minutes: ${verdict.reason}`); return false }
      this.setState(cmd.id, 'WAITING_RESOURCES', verdict.reason); return false
    }
    if (TERMINAL_COMMAND_STATES.includes(this.commands.read(cmd.id)?.state ?? 'CANCELLED')) return false
    const sub = applyRung(rung, step.subtask, cmd.diagnoses[String(step.n)] ?? [])
    const isLast = cmd.currentStep === cmd.steps.length - 1
    const prev = cmd.steps[cmd.currentStep - 1]
    const ref = prev?.integratedCommit
    const install = isLast && cmd.interpretation.needsInstall && cfg.autoInstall
    const paths = ref ? await this.pathsAtRef(repo, ref, [...sub.scope.paths, ...prev!.subtask.scope.write]) : sub.scope.paths
    const body: Record<string, unknown> = {
      action: 'start', title: sub.title, request: sub.request, acceptance: sub.acceptance, hints: sub.hints, targets: sub.targets,
      scope: { paths, write: sub.scope.write, ...(ref ? { ref } : {}) }, install, ...(sub.verifyKey !== undefined ? { verifyScript: this.commands.readVerify(cmd.id, sub.verifyKey) } : {}),
      ...(sub.reverseFirst && !ref ? { reverseFirst: true } : {}),
    }
    if (body.verifyScript === undefined) delete body.verifyScript
    try {
      const rec = await startFromApi(this.deps.runner, body, cmd.createdBy)
      this.commands.update(cmd.id, (c) => { const s = c.steps[c.currentStep]; s.state = 'RUNNING'; delete s.pendingRung; delete s.retryNotBefore; s.missions.push({ id: rec.id, strategy: rung, startedAt: this.now().toISOString() }); return c })
      this.setState(cmd.id, 'RUNNING', `mission ${rec.id} started (${rung})`, (c) => { c.timeline.push({ at: this.now().toISOString(), kind: 'MISSION_STARTED', detail: `${rec.id} · step ${step.n}/${cmd.steps.length} · ${rung} · builder ${rec.config.builder}` }) })
      this.postMilestone(cmd.id, `mission-${rec.id}`, `Foundry started mission ${rec.id}${cmd.steps.length > 1 ? ` (step ${step.n} of ${cmd.steps.length})` : ''}: ${sub.title}.`)
      return true
    } catch (e) {
      if (e instanceof MissionError && e.code === 'BUSY') { this.setState(cmd.id, 'QUEUED', e.message); return false }
      if (e instanceof MissionError && e.code === 'ILLEGAL') { this.setState(cmd.id, 'QUEUED', e.message); return false }
      if (e instanceof MissionError && e.code === 'NO_BUILDER') return this.infraRetry(cmd, step, e.message)
      const msg = e instanceof Error ? e.message : String(e)
      this.setState(cmd.id, 'BLOCKED', `Foundry could not start the mission: ${msg}`.slice(0, 400)); return false
    }
  }

  private lineupBuilder(): string | null { try { const m = this.deps.runner.store.list()[0]; return m?.config.builder ?? null } catch { return null } }

  private async pathsAtRef(repo: string, ref: string, wanted: string[]): Promise<string[]> {
    const { spawnSync } = await import('node:child_process')
    return [...new Set(wanted)].filter((p) => spawnSync('git', ['-C', repo, '--literal-pathspecs', 'cat-file', '-e', `${ref}:${p}`], { timeout: 15_000 }).status === 0)
  }

  // ------------------------------------------------------------------ outcomes
  private handleInterrupted(cmd: CommandRecord, step: CommandStep, m: MissionRecord, cfg: AutonomyConfig): boolean {
    const why = m.stateReason
    if (/emergency stop/i.test(why)) { this.setState(cmd.id, 'STOPPED', why.slice(0, 300)); return false }
    if (/paused by the commander|paused/i.test(why) && !/worker died/i.test(why)) {
      if (cfg.paused) { this.setState(cmd.id, 'PAUSED', `paused; mission ${m.id} is checkpointed and resumes from the checkpoint`); return false }
      try { resumeMission(this.deps.runner, m.id, cmd.createdBy); this.setState(cmd.id, 'RUNNING', `resumed mission ${m.id} from its checkpoint`); return true } catch (e) { this.commands.note(cmd.id, 'RESUME_REFUSED', e instanceof Error ? e.message : String(e)); return false }
    }
    // the worker is gone (restart, crash, lost lease): recover from the checkpoint without asking
    const rec = m.recoveries.at(-1)
    if (cfg.autoRecover && step.autoResumes < cfg.maxAutoResumes && rec?.resumable !== false && !cfg.paused) {
      if (this.anyActiveMission(m.id)) return false
      try {
        resumeMission(this.deps.runner, m.id, cmd.createdBy)
        this.commands.update(cmd.id, (c) => { c.steps[c.currentStep].autoResumes += 1; return c })
        this.setState(cmd.id, 'RUNNING', `recovered mission ${m.id} from checkpoint ${rec?.checkpointSeq ?? 'NONE'} after: ${rec?.reason ?? why}`.slice(0, 300), (c) => { c.timeline.push({ at: this.now().toISOString(), kind: 'RECOVERED', detail: `${m.id}: ${rec?.reason ?? why}; ${rec?.filesPreserved.length ?? 0} file(s) preserved` }) })
        this.postMilestone(cmd.id, `recovered-${m.id}-${step.autoResumes + 1}`, `Foundry recovered mission ${m.id} after the worker was lost and continues from its checkpoint (${rec?.filesPreserved.length ?? 0} file(s) preserved).`)
        return true
      } catch (e) {
        if (e instanceof MissionError && e.code === 'BUSY') return false
        this.commands.note(cmd.id, 'RESUME_REFUSED', e instanceof Error ? e.message : String(e))
      }
    }
    if (cfg.paused) { this.setState(cmd.id, 'PAUSED', `paused; mission ${m.id} is interrupted and recoverable`); return false }
    // not recoverable: the interruption itself is the failure to diagnose
    this.recordFailure(cmd, step, m, { cls: 'INFRA', summary: 'the worker was lost and the mission cannot be resumed', detail: why, fingerprint: 'interrupted', retriable: true })
    return false
  }

  private async handleCompleted(cmd: CommandRecord, step: CommandStep, m: MissionRecord): Promise<void> {
    const view = missionView(this.deps.runner, m, true)
    const r = view.receipt
    const evidenceOk = view.result?.status === 'COMPLETED' && !!r && r.verifier.exitCode === 0 && view.receiptCheck !== 'NO_RECEIPT' && view.receiptCheck.ok
    if (!evidenceOk) { this.recordFailure(cmd, step, m, { cls: 'ENGINE', summary: 'the mission reported COMPLETED but its own records do not support it', detail: `result=${view.result?.status}; verifier=${r?.verifier.exitCode}; receipt=${JSON.stringify(view.receiptCheck).slice(0, 160)}`, fingerprint: 'unsupported-completion', retriable: true }); return }
    // every test file the plan promised must really have been written (the engine verifies before it authors tests, so this is where a missing one is caught)
    const missingTests = step.subtask.targets.filter((t) => t.action === 'create' && /^test\//.test(t.path) && !r.filesCreated.some((f) => f.path === t.path)).map((t) => t.path)
    if (missingTests.length) { this.recordFailure(cmd, step, m, { cls: 'TESTS', summary: `the planned test file was never written: ${missingTests.join(', ')}`, detail: `The change must include its tests: create ${missingTests.join(', ')} with node:test tests for every exported function.`, fingerprint: 'missing-tests', retriable: true }); return }
    const integration = r.integration
    const isLast = cmd.currentStep === cmd.steps.length - 1
    const tests = r.testsAdded.length + r.testsChanged.length > 0
    let stale = false
    this.commands.update(cmd.id, (c) => {
      const s = c.steps[c.currentStep]
      if (s.n !== step.n || s.missions.at(-1)?.id !== m.id || s.state === 'COMPLETED') { stale = true; return null } // another pass already handled this completion
      s.state = 'COMPLETED'; if (integration.commit) s.integratedCommit = integration.commit; if (integration.branch) s.integratedBranch = integration.branch
      const l = s.missions.at(-1); if (l) l.endState = 'COMPLETED'
      c.ladder.codeGenerated = true; c.ladder.testsPassed = c.ladder.testsPassed || tests; c.ladder.verificationPassed = true
      return c
    })
    if (stale) return
    this.postMilestone(cmd.id, `done-${m.id}`, `Mission ${m.id} passed independent verification${integration.commit ? ` and is integrated as ${integration.commit.slice(0, 8)} on ${integration.branch}` : ''}${tests ? ` (${r.testsAdded.length} test file(s) added)` : ''}.`)
    if (!isLast) { this.commands.update(cmd.id, (c) => (c.currentStep === step.n - 1 ? (c.currentStep += 1, c) : null)); this.setState(cmd.id, 'QUEUED', `step ${step.n} done; step ${step.n + 1} of ${cmd.steps.length} is next`); await this.advanceOnce(); return }
    // final step: the delivery ladder
    const inst = r.install
    if (inst.state === 'INSTALLED' && inst.path) {
      this.commands.update(cmd.id, (c) => { c.ladder.buildCreated = true; c.ladder.installed = true; c.evidence.install = { path: inst.path!, ...(inst.stamp ? { stamp: inst.stamp } : {}), ...(integration.commit ? { commit: integration.commit } : {}) }; return c })
      this.commands.note(cmd.id, 'INSTALLED', `versioned installation ${inst.path} (${inst.detail ?? ''})`)
      this.postMilestone(cmd.id, `installed-${m.id}`, `Built and installed a new versioned installation: ${inst.path}. It is installed, not yet proven running.`)
    }
    const spec = cmd.interpretation.uiProof
    if (spec && inst.state === 'INSTALLED' && inst.path) { this.setState(cmd.id, 'PROVING', 'driving the installed build with real pointer input'); this.ensureProof(this.commands.read(cmd.id)!); return }
    if (spec && inst.state !== 'INSTALLED') this.commands.update(cmd.id, (c) => { c.ladder.uiProof = 'UNAVAILABLE'; return c })
    await this.finalize(cmd.id)
  }

  private ensureProof(cmd: CommandRecord) {
    if (proving().has(cmd.id)) return
    const install = cmd.evidence.install?.path
    if (!install || !this.deps.proveUi) { this.commands.update(cmd.id, (c) => { c.ladder.uiProof = 'UNAVAILABLE'; return c }); void this.finalize(cmd.id); return }
    proving().add(cmd.id)
    const outDir = this.commands.dir(cmd.id) + '/ui-proof'
    void this.deps.proveUi({ command: cmd, installPath: install, outDir }).then(async (res) => {
      this.commands.update(cmd.id, (c) => {
        c.evidence.uiProof = { dir: res.dir, passed: res.passed, steps: res.steps, at: this.now().toISOString() }
        c.ladder.uiProof = res.error ? 'UNAVAILABLE' : res.passed ? 'PASSED' : 'FAILED'
        c.ladder.running = res.passed && !res.error && !!c.interpretation.uiProof?.steps.some((x) => x.do === 'click-xy' || x.do === 'click-selector')
        c.timeline.push({ at: this.now().toISOString(), kind: 'UI_PROOF', detail: res.error ? `could not run: ${res.error}` : `${res.steps.filter((s) => s.ok).length}/${res.steps.length} checks passed` })
        return c
      })
      if (!res.error && !res.passed) { await this.repairAfterProof(cmd.id, res); return }
      await this.finalize(cmd.id)
    }).catch((e) => { this.commands.update(cmd.id, (c) => { c.ladder.uiProof = 'UNAVAILABLE'; c.timeline.push({ at: this.now().toISOString(), kind: 'UI_PROOF', detail: `could not run: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }); return c }); return this.finalize(cmd.id) }).finally(() => { proving().delete(cmd.id) })
  }

  /** The delivered build misbehaves under real input: the failed checks go back to the builder as a chained repair step (bounded), never silently accepted. */
  private async repairAfterProof(id: string, res: UiProofResult) {
    const failed = res.steps.filter((s) => !s.ok)
    await this.queueRepair(id, 'UI proof', failed.map((f) => `- ${f.label}: ${f.detail}`).join('\n').slice(0, 1500), 'The delivered build was tested with real pointer input and these checks FAILED:', failed.map((f) => f.label).join('; '), true)
  }

  /** A repair is a new mission chained on the last integrated commit, shown the exact failure; bounded by the strategy budget. */
  private async queueRepair(id: string, kind: 'UI proof' | 'build', evidence: string, lead: string, short: string, kick: boolean) {
    const cmd = this.commands.read(id)!
    const cfg = this.cfg()
    const repairs = cmd.steps.filter((s) => s.title.startsWith('Repair after')).length
    const last = cmd.steps[cmd.steps.length - 1]
    if (repairs >= Math.max(1, cfg.maxStrategyAttempts - 1) || !last.integratedCommit) {
      this.setState(id, 'BLOCKED', `${kind === 'UI proof' ? 'UI proof failed' : 'The installation build failed'} (${short.slice(0, 240)}) and the repair budget is used up. ${cmd.evidence.install?.path ? `The installed build is at ${cmd.evidence.install.path}.` : `The verified change is on ${last.integratedBranch ?? 'its foundry branch'}.`}`); return
    }
    const title = kind === 'UI proof' ? `Repair after UI proof ${repairs + 1}` : `Repair after build failure ${repairs + 1}`
    const sub: Subtask = {
      ...last.subtask, n: cmd.steps.length + 1, title,
      request: `${last.subtask.request}\n\n${lead}\n${evidence}\nFix the cause in the existing files (modify them); keep everything that already works. Code in this application is also executed on the server while the production build prerenders pages: never touch window, document, localStorage or matchMedia while rendering (only inside useEffect or event handlers).`,
      targets: last.subtask.targets.map((t) => ({ path: t.path, action: 'modify' as const })), reverseFirst: false,
    }
    this.commands.update(id, (c) => { c.steps.push({ n: c.steps.length + 1, title, subtask: sub, missions: [], state: 'PENDING', autoResumes: 0 }); c.currentStep = c.steps.length - 1; c.ladder.uiProof = c.interpretation.uiProof ? 'PENDING' : c.ladder.uiProof; return c })
    this.setState(id, 'QUEUED', `${kind} failed; repairing: ${short.slice(0, 200)}`)
    this.postMilestone(id, `repair-${repairs + 1}`, `${kind === 'UI proof' ? 'Real-pointer testing of the installed build failed' : 'The production build of the verified change failed'} (${short.slice(0, 200)}). Foundry is repairing it.`)
    // called from inside a controller pass (build failure) the next pass starts the repair; awaiting a new pass from here would wait on the pass that is calling us
    if (kick) await this.advance()
  }

  private async finalize(id: string): Promise<void> {
    const cmd = this.commands.read(id)!
    if (TERMINAL_COMMAND_STATES.includes(cmd.state) || cmd.state === 'STOPPED') return
    if (isEmergencyStopped(this.deps.adir)) { this.markStopped(); return }
    const cfg = this.cfg()
    if (cfg.paused) { this.setState(id, 'PAUSED', 'paused before the result was delivered; resume to finish'); return }
    let promotedNote = ''
    const installPath = cmd.evidence.install?.path
    const proofOk = cmd.ladder.running && cmd.ladder.uiProof === 'PASSED'
    if (cfg.deploymentAuthority && installPath && proofOk && cmd.ladder.verificationPassed && this.deps.promote) {
      if (isEmergencyStopped(this.deps.adir) || this.cfg().paused) { this.markStopped(); return }
      const p = await this.deps.promote({ command: cmd, installPath })
      if (p.ok) { this.commands.update(id, (c) => { c.ladder.promoted = true; c.evidence.promotion = { at: this.now().toISOString(), launcher: p.launcher ?? '', previousTarget: p.previousTarget ?? '', backup: p.backup ?? '' }; return c }); promotedNote = ` Promoted: ${p.detail}` }
      else promotedNote = ` Not promoted: ${p.detail}`
    } else if (installPath) promotedNote = cfg.deploymentAuthority ? ' Not promoted: the build was not driven with real input, so it is not proven running.' : ' Not promoted (deployment authority is off): the canonical launcher is unchanged.'
    const l = this.commands.read(id)!.ladder
    const summary = deliverySummary(l, installPath)
    const blocked = l.uiProof === 'FAILED'
    this.setState(id, blocked ? 'BLOCKED' : 'DELIVERED', `${summary}${promotedNote}`.slice(0, 600))
    this.postMilestone(id, 'final', `${blocked ? 'Foundry could not deliver this.' : 'Foundry delivered this.'} ${summary}${promotedNote}`)
  }

  /** The engine reports a failed final verification only as UNDETERMINED. Re-run the (hidden) verifier on the failed workspace, sandboxed, to learn WHICH contract lines failed, so the retry is told the real cause. */
  /** For a build that died while prerendering: read the changed client components from the mission workspace and name the exact lines that touch browser globals while rendering. */
  private ssrEvidence(m: MissionRecord, receipt: MissionView['receipt']): string {
    try {
      if (!receipt || !/window is not defined|document is not defined|localStorage is not defined|navigator is not defined|prerender/i.test(receipt.install.detail ?? '')) return ''
      const paths = [...receipt.filesCreated, ...receipt.filesModified].map((f) => f.path).filter((p) => /\.(tsx|jsx)$/.test(p))
      return ssrAdvice(findSsrHazards(paths.map((p) => ({ path: p, text: readFileSync(path.join(m.workspace.root, p), 'utf8') }))))
    } catch { return '' }
  }

  private async verifierFailures(m: MissionRecord): Promise<string[]> {
    try {
      const script = path.join(this.deps.runner.store.dir(m.id), 'verifier', 'verify.mjs')
      if (!existsSync(script) || !existsSync(m.workspace.root)) return []
      const r = await runTool([resolveBin('node'), script, m.workspace.root], m.workspace.root, { timeoutMs: 120_000, sandbox: { rw: [m.workspace.root] } })
      return (r.stdout + '\n' + r.stderr).split('\n').filter((l) => /^not ok/.test(l.trim())).map((l) => l.trim().slice(0, 300)).slice(0, 10)
    } catch { return [] }
  }

  private async handleFailed(cmd: CommandRecord, step: CommandStep, m: MissionRecord, alreadyStarted: boolean): Promise<boolean> {
    const view = missionView(this.deps.runner, m, true)
    const verifierLines = /independent verification|verifier/i.test(m.stateReason) && !view.receipt ? await this.verifierFailures(m) : []
    const facts: MissionFacts = { state: m.state, stateReason: m.stateReason, result: m.result ? { status: m.result.status, reason: m.result.reason } : null, receipt: view.receipt ? { verifier: view.receipt.verifier, integration: view.receipt.integration, install: view.receipt.install } : null, events: view.events.map((e) => ({ kind: e.kind, detail: e.detail })), ...(verifierLines.length ? { verifierLines } : {}) }
    const d = diagnose(facts)
    if (d.cls === 'INSTALL' && view.receipt?.integration.state === 'APPLIED' && view.receipt.integration.commit) {
      // the change passed verification and is integrated; only the production build broke: keep the verified work and repair on top of it
      const integ = view.receipt.integration
      this.commands.update(cmd.id, (c) => { const s = c.steps[c.currentStep]; if (s.n !== step.n || s.missions.at(-1)?.id !== m.id || s.state === 'COMPLETED') return null; s.state = 'COMPLETED'; s.integratedCommit = integ.commit; s.integratedBranch = integ.branch; const l = s.missions.at(-1); if (l) { l.endState = 'FAILED'; l.fingerprint = d.fingerprint }; (c.diagnoses[String(s.n)] ??= []).push(d); c.ladder.codeGenerated = true; c.ladder.verificationPassed = true; c.timeline.push({ at: this.now().toISOString(), kind: 'DIAGNOSIS', detail: `${m.id}: INSTALL — ${d.summary}`.slice(0, 400) }); return c })
      if (this.commands.read(cmd.id)!.steps[cmd.currentStep]?.integratedCommit === integ.commit) await this.queueRepair(cmd.id, 'build', (d.detail.slice(-1100) + '\n' + this.ssrEvidence(m, view.receipt)).slice(0, 2600), 'The production build (next build) of this change FAILED with:', d.summary, false)
      return false
    }
    this.recordFailure(cmd, step, m, d)
    void alreadyStarted
    return false
  }

  /** Record the diagnosis, then either retry with a CHANGED strategy or report BLOCKED. The same strategy is never used twice for one step, so an identical failure cannot loop. */
  private recordFailure(cmd: CommandRecord, step: CommandStep, m: MissionRecord, d: Diagnosis) {
    const cfg = this.cfg()
    const tried = step.missions.map((x) => x.strategy as Rung)
    const repeated = step.missions.some((x) => x.fingerprint === d.fingerprint)
    let stale = false
    this.commands.update(cmd.id, (c) => {
      const s = c.steps[c.currentStep]; if (s.n !== step.n || s.missions.at(-1)?.id !== m.id || s.missions.at(-1)?.fingerprint !== undefined || s.pendingRung) { stale = true; return null }
      const l = s.missions.at(-1); if (l) { l.endState = m.state; l.fingerprint = d.fingerprint }
      ;(c.diagnoses[String(s.n)] ??= []).push(d)
      c.timeline.push({ at: this.now().toISOString(), kind: 'DIAGNOSIS', detail: `${m.id}: ${d.cls} — ${d.summary}${repeated ? ' (same failure as an earlier attempt)' : ''}`.slice(0, 400) })
      return c
    })
    if (stale) return
    this.postMilestone(cmd.id, `fail-${m.id}`, `Mission ${m.id} did not pass: ${d.summary}. ${d.cls === 'INFRA' ? 'Retrying when the machine is ready.' : 'Foundry will change its approach.'}`)
    if (d.cls === 'INFRA') { this.infraRetry(cmd, step, d.summary); return }
    if (!d.retriable) { this.setState(cmd.id, 'BLOCKED', `${d.summary}. This kind of failure is not repaired by rewriting the code; the integrated change is on ${step.integratedBranch ?? 'its foundry branch'}.`.slice(0, 500)); return }
    if (step.missions.length >= cfg.maxStrategyAttempts) { this.setState(cmd.id, 'BLOCKED', this.blockedSummary(cmd.id, step.n)); return }
    let rung = nextRung(tried, step.subtask)
    if (rung === 'split') {
      // a plan change, not a prompt change: two smaller steps, the second built on the first one's commit
      const parts = splitSubtask(step.subtask)
      if (parts) {
        this.commands.update(cmd.id, (c) => {
          const at = c.currentStep
          const mk = (sub: Subtask): CommandStep => ({ n: 0, title: sub.title, subtask: sub, missions: [], state: 'PENDING', autoResumes: 0 })
          const failedStep = c.steps[at]
          c.steps.splice(at, 1, mk(parts[0]), mk(parts[1])); c.steps.forEach((s, i) => { s.n = i + 1 })
          c.diagnoses[String(at + 1)] = failedStep.missions.length ? (c.diagnoses[String(failedStep.n)] ?? []) : []
          c.timeline.push({ at: this.now().toISOString(), kind: 'STRATEGY', detail: 'split the work into logic/tests and interface/wiring, built one after the other' })
          return c
        })
        this.setState(cmd.id, 'QUEUED', 'changed strategy: splitting the work into smaller parts, built one after the other')
        return
      }
      rung = nextRung([...tried, 'split'], step.subtask)
    }
    if (!rung) { this.setState(cmd.id, 'BLOCKED', this.blockedSummary(cmd.id, step.n)); return }
    this.commands.update(cmd.id, (c) => { c.timeline.push({ at: this.now().toISOString(), kind: 'STRATEGY', detail: `next attempt uses "${rung}" (tried: ${tried.join(', ')})` }); c.steps[c.currentStep].pendingRung = rung!; return c })
    this.setState(cmd.id, 'QUEUED', `changed strategy: ${rung}`)
  }

  private blockedSummary(id: string, n: number): string {
    const ds = this.commands.read(id)!.diagnoses[String(n)] ?? []
    return `Foundry tried ${ds.length} time(s) with different approaches and is stopping honestly. ${ds.map((d, i) => `#${i + 1} ${d.cls}: ${d.summary}`).join(' | ')}`.slice(0, 600)
  }

  /** The machine or the model runtime was the problem, not the code: wait with back-off and repeat the SAME strategy (bounded). */
  private infraRetry(cmd: CommandRecord, step: CommandStep, why: string): boolean {
    const infra = cmd.timeline.filter((t) => t.kind === 'INFRA_RETRY').length
    if (infra >= MAX_INFRA_RETRIES) { this.setState(cmd.id, 'BLOCKED', `the local model runtime or machine stayed unavailable after ${infra} retries: ${why}`.slice(0, 400)); return false }
    const wait = 30_000 * (infra + 1)
    this.commands.update(cmd.id, (c) => {
      c.timeline.push({ at: this.now().toISOString(), kind: 'INFRA_RETRY', detail: `${why.slice(0, 260)}; retrying in ${wait / 1000} s` })
      const s = c.steps[c.currentStep]; s.pendingRung = (s.missions.at(-1)?.strategy as Rung | undefined) ?? 'initial'; s.retryNotBefore = new Date(this.now().getTime() + wait).toISOString(); return c
    })
    this.setState(cmd.id, 'WAITING_RESOURCES', `waiting for the machine: ${why}`.slice(0, 300))
    return false
  }

  // ------------------------------------------------------------------ Commander controls
  pause(actor: string): AutonomyConfig {
    const cfg = setPaused(this.deps.adir, true, actor)
    for (const m of this.deps.runner.store.list()) {
      if (!ACTIVE_STATES.includes(m.state) || !this.isOurs(m.id)) continue
      const a = deriveAssignments(this.deps.log).assignments.get(m.assignmentId)
      if (a?.state === 'RUNNING') { try { pauseAssignment(this.deps.log, m.assignmentId, actor, 'paused by the Commander (Autonomy Control Center)') } catch { /* already paused */ } }
    }
    for (const c of this.openCommands()) this.commands.note(c.id, 'PAUSE', `paused by ${actor}`)
    return cfg
  }

  async resume(actor: string): Promise<AutonomyConfig> {
    if (isEmergencyStopped(this.deps.adir)) throw new ControllerError('STOPPED', 'Emergency Stop is active; clear it first.')
    const cfg = setPaused(this.deps.adir, false, actor)
    for (const c of this.openCommands()) this.commands.note(c.id, 'RESUME', `resumed by ${actor}`)
    await this.advance()
    return cfg
  }

  async cancel(commandId: string, actor: string, reason: string): Promise<CommandRecord> {
    if (!isCommandId(commandId)) throw new ControllerError('INVALID', 'invalid command id')
    const cmd = this.commands.read(commandId)
    if (!cmd) throw new ControllerError('NOT_FOUND', 'unknown command')
    if (TERMINAL_COMMAND_STATES.includes(cmd.state)) throw new ControllerError('ILLEGAL', `the command is already ${cmd.state}`)
    const cancelled = this.setState(commandId, 'CANCELLED', `cancelled by ${actor}: ${reason || 'no reason given'}`) // first, so no concurrent pass starts another mission
    for (const s of cmd.steps) for (const x of s.missions) {
      const m = this.deps.runner.store.read(x.id)
      if (m && (ACTIVE_STATES.includes(m.state) || m.state === 'INTERRUPTED')) { try { cancelMission(this.deps.runner, m.id, actor, reason || 'Commander cancelled') } catch { /* already ending */ } }
    }
    return cancelled
  }

  /** Emergency Stop: no further execution. Order matters: the stop file first (every entry point is refused from that instant), then every process and model call is terminated, then missions and commands are marked. */
  emergencyStop(actor: string, reason: string): EmergencyStop {
    const at = this.now().toISOString()
    const stop: EmergencyStop = { active: true, at, by: actor, reason: reason || 'Emergency Stop', killedProcesses: [], abortedModelCalls: 0, missions: [] }
    writeEmergencyStop(this.deps.adir, stop)
    const halted = haltAllActivity(true)
    stop.killedProcesses = halted.killed; stop.abortedModelCalls = halted.aborted
    const { log, runner } = this.deps
    for (const m of runner.store.list()) {
      if (!ACTIVE_STATES.includes(m.state)) continue
      stop.missions.push(m.id)
      try {
        runner.store.update(m.id, (x) => {
          if (!ACTIVE_STATES.includes(x.state)) return null
          const r = resumability(log, x)
          x.recoveries.push({ at, detectedBy: 'system:emergency-stop', reason: `Emergency Stop by ${actor}: ${reason}`, fromState: x.state, attempt: x.attempts.length, checkpointSeq: r.checkpointSeq, resumable: r.resumable, resumableWhy: r.why, filesPreserved: r.files })
          const last = x.attempts.at(-1); if (last && !last.endedAt) { last.endedAt = at; last.endState = 'INTERRUPTED'; last.endReason = 'Emergency Stop' }
          x.state = 'INTERRUPTED'; x.stateAt = at; x.stateReason = `Emergency Stop by ${actor}: ${reason}. ${r.resumable ? 'Resumable: ' : 'Not resumable: '}${r.why}`
          return x
        })
        runner.store.retireLease(m.id, 'estop')
        runner.store.event(m.id, { kind: 'EMERGENCY_STOP', detail: `${actor}: ${reason}`, attempt: m.attempts.length })
        const a = deriveAssignments(log).assignments.get(m.assignmentId)
        if (a && ['RUNNING', 'STOPPING', 'CANCEL_REQUESTED'].includes(a.state)) interruptAssignment(log, m.assignmentId, 'system:recovery', `Emergency Stop by ${actor}`)
      } catch { /* the mission vanished */ }
    }
    writeEmergencyStop(this.deps.adir, stop)
    this.markStopped()
    return stop
  }

  private markStopped() {
    for (const c of this.openCommands()) if (c.state !== 'STOPPED') this.setState(c.id, 'STOPPED', `Emergency Stop: ${readEmergencyStop(this.deps.adir)?.reason ?? 'stopped'}`)
  }

  /** Clearing is deliberate. Stopped commands do not restart by themselves: `restartStopped` puts them back in the queue (mission resumes from its checkpoint). */
  clearStop(actor: string): boolean { const ok = clearEmergencyStop(this.deps.adir, actor); if (ok) releaseActivityHold(); return ok }
  async restartStopped(commandId: string, actor: string): Promise<CommandRecord> {
    if (isEmergencyStopped(this.deps.adir)) throw new ControllerError('STOPPED', 'Emergency Stop is active; clear it first.')
    const cmd = this.commands.read(commandId)
    if (!cmd || cmd.state !== 'STOPPED') throw new ControllerError('ILLEGAL', 'only a STOPPED command can be restarted')
    const step = cmd.steps[cmd.currentStep]; const m = this.missionOf(step)
    this.setState(commandId, 'QUEUED', `restarted by ${actor}`)
    if (m?.state === 'INTERRUPTED') { try { resumeMission(this.deps.runner, m.id, cmd.createdBy) } catch (e) { this.commands.note(commandId, 'RESUME_REFUSED', e instanceof Error ? e.message : String(e)) } }
    await this.advance()
    return this.commands.read(commandId)!
  }

  /** Continue a BLOCKED/FAILED command from where it stopped: the same command, its verified work and its integrated commit are kept; the last failure is diagnosed again and handled (repair on top of the integrated commit, or a changed strategy). No duplicate command or mission is created for work that already exists. */
  async reopen(commandId: string, actor: string): Promise<CommandRecord> {
    if (isEmergencyStopped(this.deps.adir)) throw new ControllerError('STOPPED', 'Emergency Stop is active; clear it first.')
    const cmd = this.commands.read(commandId)
    if (!cmd) throw new ControllerError('NOT_FOUND', 'unknown command')
    if (cmd.state !== 'BLOCKED' && cmd.state !== 'FAILED') throw new ControllerError('ILLEGAL', `only a BLOCKED or FAILED command can be continued (this one is ${cmd.state})`)
    // the work is verified and installed and only the real-input proof failed or could not run (for example the proof environment was wrong): prove again, do not rebuild or re-ask the builder
    const lastStep = cmd.steps[cmd.currentStep]
    if (lastStep?.state === 'COMPLETED' && cmd.evidence.install?.path && cmd.interpretation.uiProof && cmd.ladder.uiProof !== 'PASSED' && existsSync(cmd.evidence.install.path)) {
      this.commands.update(commandId, (c) => { c.ladder.uiProof = 'PENDING'; delete c.evidence.uiProof; c.timeline.push({ at: this.now().toISOString(), kind: 'REOPENED', detail: `${actor} asked for the installed build to be proven again (no new mission: the verified work and the installation are kept)` }); return c })
      const at2 = this.now().toISOString()
      this.commands.update(commandId, (c) => { c.state = 'PROVING'; c.stateReason = 'driving the installed build with real pointer input again'; c.stateAt = at2; c.timeline.push({ at: at2, kind: 'PROVING', detail: c.stateReason }); return c }) // an explicit Commander reopen is the one way out of a terminal state
      this.ensureProof(this.commands.read(commandId)!)
      return this.commands.read(commandId)!
    }
    const at = this.now().toISOString()
    this.commands.update(commandId, (c) => {
      c.state = 'QUEUED'; c.stateReason = `continued by ${actor} from the last checkpoint (${cmd.stateReason.slice(0, 160)})`; c.stateAt = at
      c.timeline.push({ at, kind: 'REOPENED', detail: `${actor} continued this command; verified work and integrated commits are kept` })
      // a continued command gets one fresh attempt at the current step even when the strategy budget was used up (the Commander asked for it); the new mission sees the code as it is now
      const s = c.steps[c.currentStep]; if (s) { s.pendingRung = 'initial'; delete s.retryNotBefore }
      return c
    })
    await this.advance()
    return this.commands.read(commandId)!
  }

  setSettings(patch: ConfigPatch, actor: string): AutonomyConfig { return updateConfig(this.deps.adir, patch, actor) }

  private isOurs(missionId: string): boolean { return this.commands.list().some((c) => c.steps.some((s) => s.missions.some((x) => x.id === missionId))) }
  private openCommands(): CommandRecord[] { return this.commands.list().filter((c) => !TERMINAL_COMMAND_STATES.includes(c.state)) }

  // ------------------------------------------------------------------ read model
  commandView(c: CommandRecord, detail = false): CommandView {
    const step = c.steps[c.currentStep]; const last = step?.missions.at(-1)
    const m = last ? this.deps.runner.store.read(last.id) : null
    const controls: CommandView['controls'] = []
    if (!TERMINAL_COMMAND_STATES.includes(c.state) && c.state !== 'STOPPED') controls.push('cancel')
    return { ...c, mission: m ? missionView(this.deps.runner, m, detail) : null, missionCount: c.steps.reduce((n, s) => n + s.missions.length, 0), controls }
  }

  async status(opts: { capabilities?: boolean } = {}): Promise<AutonomyStatus> {
    const cfg = this.cfg()
    const all = this.commands.list()
    const open = all.filter((c) => !TERMINAL_COMMAND_STATES.includes(c.state))
    const f = realFacts()
    const workers = this.deps.runner.store.list().filter((m) => ACTIVE_STATES.includes(m.state) && m.lease && assessLiveness(m, f).verdict !== 'DEAD').map((m) => ({ missionId: m.id, workerId: m.lease!.workerId, pid: m.lease!.pid, heartbeatAgeSec: Math.round((f.now.getTime() - Date.parse(m.lease!.heartbeatAt)) / 1000), progressAgeSec: Math.round((f.now.getTime() - Date.parse(m.lease!.progressAt)) / 1000), note: m.lease!.progressNote, builder: m.config.builder }))
    let capabilities: Capability[] = this.capCache?.rows ?? []
    if (opts.capabilities !== false && (!this.capCache || Date.now() - this.capCache.at > 30_000)) { capabilities = await probeCapabilities({ repo: this.deps.repo(), config: cfg }); this.capCache = { at: Date.now(), rows: capabilities } }
    const resources = await (this.deps.resources ?? ((b: string | null) => readResources().then((r) => judgeResources(r, b))))(this.lineupBuilder()).catch(() => null)
    return { generatedAt: this.now().toISOString(), config: cfg, emergencyStop: readEmergencyStop(this.deps.adir), capabilities, resources, activity: activitySnapshot(), active: open.map((c) => this.commandView(c)), recent: all.filter((c) => TERMINAL_COMMAND_STATES.includes(c.state) || c.state === 'STOPPED').slice(0, 20).map((c) => this.commandView(c)), workers }
  }

  getCommand(id: string): CommandView | null { const c = isCommandId(id) ? this.commands.read(id) : null; return c ? this.commandView(c, true) : null }

  // ------------------------------------------------------------------ conversation
  private postMilestone(id: string, key: string, text: string) {
    const cmd = this.commands.read(id)
    if (!cmd || cmd.posted.includes(key)) return
    this.commands.update(id, (c) => { if (!c.posted.includes(key)) c.posted.push(key); return c })
    const origin = cmd.origin
    if (origin.kind !== 'council' || !this.deps.post) return
    try { this.deps.post(origin, key === 'final' ? 'FOUNDRY' : 'FOUNDRY', text, { foundryCommand: { commandId: id, key }, roundRequestId: `foundry-command-${id}-${key}` }) } catch { /* posting is a view; never fatal */ }
  }
}

export function deliverySummary(l: DeliveryLadder, installPath?: string): string {
  const parts = [
    `code generated: ${l.codeGenerated ? 'yes' : 'no'}`,
    `tests passed: ${l.testsPassed ? 'yes' : 'none were part of this change'}`,
    `independent verification: ${l.verificationPassed ? 'passed' : 'not passed'}`,
    `build created: ${l.buildCreated ? 'yes' : 'no'}`,
    `installed: ${l.installed ? `yes (${installPath})` : 'no'}`,
    `running: ${l.running ? 'yes (driven with real input)' : 'not shown'}`,
    ...(l.uiProof === 'NOT_APPLICABLE' ? [] : [`pointer/UI proof: ${l.uiProof.toLowerCase()}`]),
  ]
  return parts.join(' · ')
}
