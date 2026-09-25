/**
 * runtime.health / runtime.verify / runtime.launch / runtime.stop / runtime.launch_installed /
 * runtime.stop_installed.
 *
 * health/verify are strictly READ-ONLY diagnostics — they never spawn or kill anything, so they
 * are safe to call against the user's actual, possibly-running, installed War Room app. They
 * reuse the same lock-file convention the Electron desktop app writes
 * (desktop/src/serverLifecycle.cjs, via the shared resolveLocalAppDataPaths() in
 * lib/sovereign-runtime/local-ownership/paths.ts) to distinguish three ownership classes rather
 * than trusting an open port alone:
 *   INSTALLED_RUNTIME — a live process whose runtimeRoot is under the real ~/.local/opt install
 *                        root (PASS 002: what a Commander's desktop shortcut actually launches).
 *   PACKAGED_RUNTIME   — a live process running a built desktop/runtime bundle directly from the
 *                        source checkout (built, but never installed).
 *   DEV_RUNTIME        — e.g. someone ran `next start --port 3848` by hand from the checkout.
 *
 * runtime.launch/runtime.stop are thin wrappers over terminalSession.ts and are only ever used by
 * Foundry's own acceptance proof to run a throwaway local fixture — cwd is always the repo root
 * (never the real installed app's directory), so they can never launch or replace the user's
 * actual installed application.
 *
 * runtime.launch_installed/runtime.stop_installed (PASS 002) are the deliberately separate,
 * narrowly-scoped pair that CAN start/stop the real installed application:
 *   - launch is idempotent-safe: if an installed runtime is already live (very likely true on a
 *     shared machine — see the PASS 002 report), it reports alreadyRunning and starts nothing.
 *   - it resolves the executable read-only, via the same launcher shim
 *     (~/.local/bin/war-room-os-user) the user's own desktop shortcut uses, so it never guesses
 *     at a competing "which version" answer.
 *   - it bypasses the generic commandPolicy.classifyArgv allowlist entirely (that allowlist is
 *     for dev-toolchain commands, and would reject "war-room-os" as unrecognized) in favor of its
 *     own narrow check: the executable must resolve inside the real install root and have a
 *     sibling INSTALL_STAMP.json — never an arbitrary caller-supplied path.
 *   - stop only ever affects a pid THIS process itself spawned via launch_installed — it can
 *     structurally never touch a pid it did not start, so it can never kill another agent's or
 *     the Commander's own already-running session.
 */
import path from 'node:path'
import { installedAppTreeDir } from './installLayout'
import { existsSync, readFileSync, readlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { LOCAL_CORE_ORIGIN, LOCAL_CORE_PORT, LOCAL_UI_ORIGIN, LOCAL_UI_PORT } from '@/lib/sovereign-runtime/constants'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { openTerminalSession, closeTerminalSession, type OpenSessionResult } from './terminalSession'
import { classifyArgv } from './commandPolicy'
import { installerActiveStatus, normalizeInstallStamp, realInstallOptRoot } from './installerTool'
import { electronLaunchFlags, helperBesideExecutable, inspectLinuxElectronSandboxCapability } from './linuxElectronSandboxCapability'

const require = createRequire(import.meta.url)
const serverLifecycle = require('../../desktop/src/serverLifecycle.cjs') as {
  findPidOwningPort: (port: number) => number | null
  isWarRoomRuntime: (pid: number) => { verified: boolean; runtimeRoot: string | null }
  terminateVerifiedStaleRuntime: (pid: number, options?: { termTimeoutMs?: number; killTimeoutMs?: number }) => Promise<boolean>
}

const HEALTH_TIMEOUT_MS = 2_500

export type PortHealth = {
  running: boolean
  origin: string
  port: number
  httpStatus?: number
  detail: string
}

export async function probeHttpPort(origin: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<{ ok: boolean; status?: number; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(origin, { signal: controller.signal })
    return { ok: true, status: response.status, detail: `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

async function probePort(origin: string, port: number): Promise<PortHealth> {
  const probe = await probeHttpPort(origin)
  return {
    running: probe.ok,
    origin,
    port,
    httpStatus: probe.status,
    detail: probe.ok ? `Reachable: ${probe.detail}` : `Not reachable: ${probe.detail}`,
  }
}

/** Backward-compatible alias — UI-port health only. Prefer runtimeHealthDetailed() for the full
 * core+UI picture. */
export type RuntimeHealthResult = PortHealth
export async function runtimeHealth(): Promise<RuntimeHealthResult> {
  return probePort(LOCAL_UI_ORIGIN, LOCAL_UI_PORT)
}

type LockFilePayload = { pid: number; port: number; runtimeRoot: string; sourceCommit?: string | null; startedAt?: string; adopted?: boolean }

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

async function readLockFile(port: number): Promise<LockFilePayload | null> {
  try {
    const runtimeDir = resolveLocalAppDataPaths().runtime
    const raw = await readFile(path.join(runtimeDir, `server-lifecycle-${port}.lock.json`), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LockFilePayload>
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number' || typeof parsed.runtimeRoot !== 'string') return null
    return parsed as LockFilePayload
  } catch {
    return null
  }
}

export type RuntimeOwnership = 'INSTALLED_RUNTIME' | 'PACKAGED_RUNTIME' | 'DEV_RUNTIME' | 'UNKNOWN_OWNER' | 'NOT_RUNNING'

type RuntimeManifestLike = { source_commit?: string | null; git_short?: string | null; built_at?: string | null; prepared_at?: string }

export type RuntimeIdentity = {
  installId: string | null
  version: string | null
  gitShort: string | null
  builtAt: string | null
}

export type RuntimeVerifyResult = {
  ownership: RuntimeOwnership
  health: RuntimeHealthResult
  corePort: PortHealth
  lock: LockFilePayload | null
  lockPidAlive: boolean | null
  executablePath: string | null
  identity: RuntimeIdentity | null
  detail: string
  /** PASS 003 — exact-build identity, answering "is the RUNNING install the ACTIVE install",
   * never just "is something listening on 3848". activeInstallId is read from the canonical
   * launcher shim (installer.active_status), independent of whatever happens to be running. */
  activeInstallId: string | null
  runningInstallId: string | null
  identityMatch: boolean | null
}

async function readInstalledIdentity(installDir: string): Promise<RuntimeIdentity | null> {
  try {
    const stamp = normalizeInstallStamp(JSON.parse(await readFile(path.join(installDir, 'INSTALL_STAMP.json'), 'utf8')), path.basename(installDir), installDir)
    if (!stamp) return null
    return { installId: stamp.install_id, version: stamp.install_id.match(/^war-room-os-([^-]+)-/)?.[1] ?? null, gitShort: stamp.gitShort || null, builtAt: stamp.builtAt || null }
  } catch {
    return null
  }
}

async function readPackagedIdentity(runtimeRoot: string): Promise<RuntimeIdentity | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(runtimeRoot, 'RUNTIME_MANIFEST.json'), 'utf8')) as RuntimeManifestLike
    return { installId: null, version: null, gitShort: manifest.git_short ?? null, builtAt: manifest.built_at ?? null }
  } catch {
    return null
  }
}

/** Read-only. Never spawns anything. Reports both War Room ports (3847 core / 3848 UI) — the UI
 * port is what ownership classification keys off, matching the desktop app's own lock-file
 * convention, which only the UI process writes. */
export async function runtimeHealthDetailed(): Promise<{ ui: PortHealth; core: PortHealth }> {
  const [ui, core] = await Promise.all([probePort(LOCAL_UI_ORIGIN, LOCAL_UI_PORT), probePort(LOCAL_CORE_ORIGIN, LOCAL_CORE_PORT)])
  return { ui, core }
}

/** Read-only. Never spawns or kills anything — cross-checks the health probe against the
 * lock-file ownership record without trusting either signal alone. Also answers the PASS 003
 * exact-identity question: is the RUNNING install the same one the canonical launcher considers
 * ACTIVE, using real evidence (lock runtimeRoot -> install dir -> INSTALL_STAMP.json), not just
 * "something responded on 3848". */
export async function runtimeVerify(): Promise<RuntimeVerifyResult> {
  const [health, corePort, activeStatus] = await Promise.all([runtimeHealth(), probePort(LOCAL_CORE_ORIGIN, LOCAL_CORE_PORT), installerActiveStatus()])
  const activeInstallId = activeStatus.valid ? activeStatus.activeInstallId : null
  const lock = await readLockFile(LOCAL_UI_PORT)
  if (!health.running) {
    return { ownership: 'NOT_RUNNING', health, corePort, lock, lockPidAlive: lock ? isProcessAlive(lock.pid) : null, executablePath: null, identity: null, detail: 'No response on the installed UI port.', activeInstallId, runningInstallId: null, identityMatch: null }
  }
  if (!lock) {
    return { ownership: 'UNKNOWN_OWNER', health, corePort, lock: null, lockPidAlive: null, executablePath: null, identity: null, detail: 'Port is responding but no lock file was found — not launched via the desktop app lifecycle.', activeInstallId, runningInstallId: null, identityMatch: activeInstallId ? false : null }
  }
  const alive = isProcessAlive(lock.pid)
  if (!alive) {
    return { ownership: 'UNKNOWN_OWNER', health, corePort, lock, lockPidAlive: false, executablePath: null, identity: null, detail: 'Port is responding but the lock file PID is not alive (stale lock).', activeInstallId, runningInstallId: null, identityMatch: activeInstallId ? false : null }
  }
  const repoRoot = path.resolve(resolveRepoRoot())
  const optRoot = path.resolve(realInstallOptRoot())
  const runtimeRoot = path.resolve(lock.runtimeRoot)
  const relToOpt = path.relative(optRoot, runtimeRoot)
  const relToRepo = path.relative(repoRoot, runtimeRoot)

  if (!relToOpt.startsWith('..') && !path.isAbsolute(relToOpt)) {
    const runningInstallId = relToOpt.split(path.sep)[0]
    const installDir = path.join(optRoot, runningInstallId)
    const identity = await readInstalledIdentity(installDir)
    const executablePath = path.join(installedAppTreeDir(installDir), 'war-room-os')
    return {
      ownership: 'INSTALLED_RUNTIME',
      health,
      corePort,
      lock,
      lockPidAlive: true,
      executablePath: existsSync(executablePath) ? executablePath : null,
      identity,
      detail: `Owned by a live process (pid ${lock.pid}) running from an installed location: ${lock.runtimeRoot}`,
      activeInstallId,
      runningInstallId,
      identityMatch: activeInstallId !== null && runningInstallId === activeInstallId,
    }
  }
  if (!relToRepo.startsWith('..') && !path.isAbsolute(relToRepo) && relToRepo.split(path.sep)[0] === 'desktop') {
    const identity = await readPackagedIdentity(runtimeRoot)
    return {
      ownership: 'PACKAGED_RUNTIME',
      health,
      corePort,
      lock,
      lockPidAlive: true,
      executablePath: null,
      identity,
      detail: `Owned by a live process (pid ${lock.pid}) running a built desktop/runtime bundle directly from the source checkout, not installed.`,
      activeInstallId,
      runningInstallId: null,
      identityMatch: activeInstallId ? false : null,
    }
  }
  const isDevCheckout = runtimeRoot === repoRoot || (!relToRepo.startsWith('..') && !path.isAbsolute(relToRepo))
  return {
    ownership: isDevCheckout ? 'DEV_RUNTIME' : 'UNKNOWN_OWNER',
    health,
    corePort,
    lock,
    lockPidAlive: true,
    executablePath: null,
    identity: null,
    detail: isDevCheckout
      ? `Owned by a live process (pid ${lock.pid}) running from the source checkout.`
      : `Owned by a live process (pid ${lock.pid}) from an unrecognized location: ${lock.runtimeRoot}`,
    activeInstallId,
    runningInstallId: null,
    identityMatch: activeInstallId ? false : null,
  }
}

export type RuntimeLaunchInput = { cmd: string; args: string[]; label?: string; repairId: string }

/** Only ever intended for a throwaway local fixture (see foundryBrokerExtension.proof.ts) — cwd
 * is always the repo root via terminalSession/classifyArgv, so this cannot target the real
 * installed application directory. */
export async function runtimeLaunch(input: RuntimeLaunchInput): Promise<OpenSessionResult> {
  const policy = classifyArgv(input.cmd, input.args)
  if (policy.policyClass !== 'SAFE_LOCAL') return { ok: false, error: policy.reason }
  return openTerminalSession({ repairId: input.repairId, cmd: input.cmd, args: input.args, label: input.label ?? 'runtime.launch fixture' })
}

export async function runtimeStop(sessionId: string): Promise<{ ok: boolean; killed: boolean }> {
  return closeTerminalSession(sessionId)
}

// ---------------------------------------------------------------------------
// PASS 002 — installed-runtime launch/stop (see module docstring for the safety model).
// ---------------------------------------------------------------------------

const installedLaunchesThisProcess = new Set<number>()

export type RuntimeLaunchInstalledResult =
  | { ok: true; alreadyRunning: true; verify: RuntimeVerifyResult }
  | { ok: true; alreadyRunning: false; pid: number; installId: string; executablePath: string }
  | { ok: false; conflict: true; activeInstallId: string; runningInstallId: string | null; verify: RuntimeVerifyResult; error: string }
  | { ok: false; conflict: false; error: string }

/** PASS 003: no more "most recently modified install" fallback — this only ever launches the
 * CANONICAL ACTIVE install (installer.active_status), and fails closed if there isn't a valid one.
 * Idempotent: if an installed runtime is already live, it does not spawn a second instance —
 * instead it reports alreadyRunning=true when the live one IS the active install, or a structured
 * conflict when a DIFFERENT install is what's actually running (never silently treated as
 * success just because *an* installed War Room happens to be up). */
export async function runtimeLaunchInstalled(): Promise<RuntimeLaunchInstalledResult> {
  const activeStatus = await installerActiveStatus()
  if (!activeStatus.valid || !activeStatus.activeInstallId || !activeStatus.activeExecutable) {
    return { ok: false, conflict: false, error: `No valid canonical active install to launch (failing closed): ${activeStatus.reason ?? 'unknown reason'}.` }
  }

  const verify = await runtimeVerify()
  if (verify.health.running) {
    if (verify.identityMatch) {
      return { ok: true, alreadyRunning: true, verify }
    }
    return {
      ok: false,
      conflict: true,
      activeInstallId: activeStatus.activeInstallId,
      runningInstallId: verify.runningInstallId,
      verify,
      error: `A different installed War Room is already running: ACTIVE_INSTALL=${activeStatus.activeInstallId}, RUNNING_INSTALL=${verify.runningInstallId ?? verify.ownership}. Not treating this as success — use runtime.transition_to_active to replace it.`,
    }
  }

  const launcherPath = activeStatus.launcherPath && existsSync(activeStatus.launcherPath)
    ? activeStatus.launcherPath
    : null
  const launchPath = launcherPath ?? activeStatus.activeExecutable
  const launchArgs = launcherPath
    ? []
    : electronLaunchFlags(inspectLinuxElectronSandboxCapability(helperBesideExecutable(activeStatus.activeExecutable)))
  const child = spawn(launchPath, launchArgs, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, GDK_BACKEND: 'x11', ELECTRON_OZONE_PLATFORM_HINT: 'x11' },
  })
  child.unref()
  if (!child.pid) return { ok: false, conflict: false, error: 'Failed to spawn the active installed application (no pid returned).' }
  installedLaunchesThisProcess.add(child.pid)
  await logWarRoomRepoAudit('engineer: runtime.launch_installed', { pid: child.pid, installId: activeStatus.activeInstallId, executablePath: launchPath, viaLauncher: Boolean(launcherPath) })
  return { ok: true, alreadyRunning: false, pid: child.pid, installId: activeStatus.activeInstallId, executablePath: activeStatus.activeExecutable }
}

/** Can only ever stop a pid THIS process itself started via runtimeLaunchInstalled — structurally
 * incapable of touching a pid it did not spawn, so it can never kill someone else's live session
 * (the Commander's, or another agent's). */
export async function runtimeStopInstalled(pid: number): Promise<{ ok: boolean; killed: boolean; error?: string }> {
  if (!installedLaunchesThisProcess.has(pid)) {
    return { ok: false, killed: false, error: 'Refusing to stop a pid Foundry did not itself start via runtime.launch_installed in this process.' }
  }
  try {
    process.kill(pid, 'SIGTERM')
    installedLaunchesThisProcess.delete(pid)
    await logWarRoomRepoAudit('engineer: runtime.stop_installed', { pid })
    return { ok: true, killed: true }
  } catch (error) {
    return { ok: false, killed: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ---------------------------------------------------------------------------
// PASS 003 Step 8 — controlled installed-runtime transition.
//
// The narrow, mission-gated operation that can move War Room from whatever is currently the
// running install to the canonical active install. It never kills a process by name or PID
// guess: it only ever signals the exact pid recorded in the desktop app's own lock file, and only
// when that lock file identifies the process as a real INSTALLED_RUNTIME (never a DEV_RUNTIME or
// an UNKNOWN_OWNER process, which this refuses to touch and reports instead).
// ---------------------------------------------------------------------------

export type RuntimeTransitionStep =
  | { step: 'already_matches'; detail: string }
  | { step: 'nothing_running'; detail: string }
  | { step: 'stopped_previous'; pid: number; installId: string | null; graceful: boolean; detail: string }
  | { step: 'refused_to_stop_unrecognized_owner'; ownership: RuntimeOwnership; detail: string }
  | { step: 'launched_active'; pid: number; installId: string; detail: string }
  | { step: 'wait_timed_out'; detail: string }

export type RuntimeTransitionResult =
  | { ok: true; steps: RuntimeTransitionStep[]; finalVerify: RuntimeVerifyResult }
  | { ok: false; steps: RuntimeTransitionStep[]; finalVerify: RuntimeVerifyResult | null; error: string }

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

async function bothPortsClosed(): Promise<boolean> {
  const [ui, core] = await Promise.all([probeHttpPort(LOCAL_UI_ORIGIN), probeHttpPort(LOCAL_CORE_ORIGIN)])
  return !ui.ok && !core.ok
}

async function bothPortsHealthy(): Promise<boolean> {
  const [ui, core] = await Promise.all([probeHttpPort(LOCAL_UI_ORIGIN), probeHttpPort(LOCAL_CORE_ORIGIN)])
  return ui.ok && core.ok
}

type VerifiedPortOwner = { port: number; pid: number; runtimeRoot: string; installId: string | null }

function installIdFromRuntimeRoot(runtimeRoot: string): string | null {
  const optRoot = path.resolve(realInstallOptRoot())
  const rel = path.relative(optRoot, path.resolve(runtimeRoot))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep)[0] ?? null
}

function readProcExe(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '')
  } catch {
    return null
  }
}

/**
 * Electron's main process (core 3847) keeps cwd at the original launch directory — often the
 * source checkout — so cwd+RUNTIME_MANIFEST cannot verify it. The detached Next UI child (3848)
 * does chdir into `<runtimeRoot>/ui` and verifies that way. Prove the parent instead via the
 * exact installed executable + INSTALL_STAMP, still fail-closed: never kill-by-name, never
 * touch an exe outside the canonical user install root.
 */
function ownerFromInstalledExecutable(pid: number, port: number): VerifiedPortOwner | { reason: string } {
  const exe = readProcExe(pid)
  if (!exe) return { reason: 'port owner /proc/exe unreadable' }
  const optRoot = path.resolve(realInstallOptRoot())
  const relExe = path.relative(optRoot, path.resolve(exe))
  if (relExe.startsWith('..') || path.isAbsolute(relExe)) {
    return { reason: `port owner exe is outside the install root: ${exe}` }
  }
  const installId = relExe.split(path.sep)[0]
  if (!installId) return { reason: 'could not derive install id from exe path' }
  const installDir = path.join(optRoot, installId)
  const stampPath = path.join(installDir, 'INSTALL_STAMP.json')
  if (!existsSync(stampPath)) return { reason: `no INSTALL_STAMP.json under ${installDir}` }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(stampPath, 'utf8'))
  } catch {
    return { reason: `INSTALL_STAMP.json unreadable under ${installDir}` }
  }
  const stamp = normalizeInstallStamp(raw, installId, installDir)
  if (!stamp) return { reason: `INSTALL_STAMP.json failed validation under ${installDir}` }
  if (!stamp.executable || path.resolve(exe) !== path.resolve(stamp.executable)) {
    return { reason: `exe ${exe} is not the stamped executable ${stamp.executable}` }
  }
  const runtimeRoot = path.join(installedAppTreeDir(installDir), 'resources', 'runtime')
  return { port, pid, runtimeRoot: existsSync(runtimeRoot) ? runtimeRoot : installDir, installId }
}

/** Identify the exact War Room processes holding 3847/3848. Prefer the desktop app's own
 * cwd+RUNTIME_MANIFEST verifier; fall back to /proc/exe + INSTALL_STAMP for the Electron
 * parent that holds 3847 without chdiring into the packaged runtime. Never kill-by-name. */
function listVerifiedInstalledPortOwners(): { owners: VerifiedPortOwner[]; unrecognized: { port: number; pid: number | null; reason: string }[] } {
  const owners: VerifiedPortOwner[] = []
  const unrecognized: { port: number; pid: number | null; reason: string }[] = []
  const optRoot = path.resolve(realInstallOptRoot())
  for (const port of [LOCAL_UI_PORT, LOCAL_CORE_PORT]) {
    const pid = serverLifecycle.findPidOwningPort(port)
    if (pid == null) continue
    const identity = serverLifecycle.isWarRoomRuntime(pid)
    if (identity.verified && identity.runtimeRoot) {
      const rel = path.relative(optRoot, path.resolve(identity.runtimeRoot))
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        unrecognized.push({ port, pid, reason: `verified War Room runtime is not under the install root: ${identity.runtimeRoot}` })
        continue
      }
      owners.push({ port, pid, runtimeRoot: identity.runtimeRoot, installId: installIdFromRuntimeRoot(identity.runtimeRoot) })
      continue
    }
    const fromExe = ownerFromInstalledExecutable(pid, port)
    if ('reason' in fromExe) {
      unrecognized.push({ port, pid, reason: fromExe.reason })
      continue
    }
    owners.push(fromExe)
  }
  return { owners, unrecognized }
}

async function stopVerifiedOwners(owners: VerifiedPortOwner[], graceMs: number): Promise<{ graceful: boolean; pids: number[] }> {
  const uniquePids = [...new Set(owners.map(o => o.pid))]
  for (const pid of uniquePids) {
    await serverLifecycle.terminateVerifiedStaleRuntime(pid, { termTimeoutMs: Math.min(graceMs, 8_000), killTimeoutMs: 4_000 })
  }
  const closed = await waitUntil(bothPortsClosed, graceMs + 6_000, 400)
  return { graceful: closed, pids: uniquePids }
}

/** Requires explicit Commander confirmation — this can stop a live, working War Room instance.
 * Sequence: verify current state -> stop the exact verified port-owner PIDs for 3847 AND 3848
 * (Electron parent plus the detached Next UI/core children the desktop lifecycle documents) ->
 * wait for both ports to close -> launch the canonical active install -> wait for both ports
 * plus identity match. Never kill-by-name. */
export async function runtimeTransitionToActive(input: {
  commanderConfirmed?: boolean
  graceMs?: number
  bootTimeoutMs?: number
  missionId?: string | null
  installId?: string | null
  allowHistoricalRollback?: boolean
  commanderExplicitRollback?: boolean
  activationMode?: 'MISSION' | 'MAINTENANCE_ROLLBACK' | 'RELAUNCH_CURRENT'
  forceRelaunch?: boolean
}): Promise<RuntimeTransitionResult> {
  if (input.commanderConfirmed !== true) {
    return { ok: false, steps: [], finalVerify: null, error: 'runtime.transition_to_active requires explicit Commander confirmation (commanderConfirmed: true) — it can stop a live installed runtime.' }
  }
  const steps: RuntimeTransitionStep[] = []
  const activeStatus = await installerActiveStatus()
  if (!activeStatus.valid || !activeStatus.activeInstallId) {
    return { ok: false, steps, finalVerify: null, error: `No valid canonical active install (failing closed): ${activeStatus.reason ?? 'unknown reason'}.` }
  }
  const { loadMission } = await import('./foundryMissionStore')
  const mission = input.missionId ? await loadMission(input.missionId) : null
  const missionInstallId = mission?.installState.installId ?? null
  if (mission) {
    if (input.installId && missionInstallId && input.installId !== missionInstallId) {
      return {
        ok: false,
        steps,
        finalVerify: null,
        error: [
          'REFUSED_FOREIGN_INSTALL',
          `MISSION_ID=${mission.missionId}`,
          `MISSION_INSTALL_ID=${missionInstallId}`,
          `REQUESTED_INSTALL_ID=${input.installId}`,
          `CURRENT_ACTIVE_INSTALL_ID=${activeStatus.activeInstallId}`,
        ].join('\n'),
      }
    }
    if (missionInstallId && activeStatus.activeInstallId !== missionInstallId) {
      return {
        ok: false,
        steps,
        finalVerify: null,
        error: `REFUSED_TRANSITION_BEFORE_ACTIVATE: installer.activate(${missionInstallId}) must PASS before runtime.transition_to_active. CURRENT_ACTIVE_INSTALL_ID=${activeStatus.activeInstallId}`,
      }
    }
  }
  const authorizeInstallId = missionInstallId ?? input.installId ?? activeStatus.activeInstallId
  const { authorizeProductionActivation } = await import('./foundryProductionOwnership')
  const allowed = await authorizeProductionActivation({
    missionId: input.missionId,
    installId: authorizeInstallId,
    commanderConfirmed: true,
    commanderExplicitRollback: input.commanderExplicitRollback === true,
    activationMode: input.activationMode ?? (input.missionId ? 'MISSION' : 'RELAUNCH_CURRENT'),
    allowHistoricalRollback: input.allowHistoricalRollback === true,
  })
  if (!allowed.ok) {
    return { ok: false, steps, finalVerify: null, error: allowed.error }
  }

  let verify = await runtimeVerify()
  if (verify.identityMatch && verify.health.running && input.forceRelaunch !== true) {
    steps.push({ step: 'already_matches', detail: `Running install already equals the active install (${activeStatus.activeInstallId}) — no transition needed.` })
    return { ok: true, steps, finalVerify: verify }
  }

  const { owners, unrecognized } = listVerifiedInstalledPortOwners()
  if (unrecognized.length) {
    steps.push({ step: 'refused_to_stop_unrecognized_owner', ownership: verify.ownership, detail: `Refusing to stop an unproven port owner: ${JSON.stringify(unrecognized)}` })
    return { ok: false, steps, finalVerify: verify, error: 'Refused to stop an unrecognized/unproven-ownership process.' }
  }

  if (!owners.length) {
    steps.push({ step: 'nothing_running', detail: 'No verified installed runtime currently owns 3847/3848.' })
  } else {
    const priorInstallId = owners.map(o => o.installId).find(Boolean) ?? verify.runningInstallId
    const stopped = await stopVerifiedOwners(owners, input.graceMs ?? 12_000)
    steps.push({
      step: 'stopped_previous',
      pid: stopped.pids[0] ?? -1,
      installId: priorInstallId,
      graceful: stopped.graceful,
      detail: `Stopped verified port owners pids=${stopped.pids.join(',')} ports=3847,3848 graceful=${stopped.graceful}`,
    })
    if (!stopped.graceful) {
      verify = await runtimeVerify()
      return { ok: false, steps, finalVerify: verify, error: 'Verified War Room port owners did not release 3847/3848 within the grace period.' }
    }
  }

  const launched = await runtimeLaunchInstalled()
  if (!launched.ok) {
    verify = await runtimeVerify()
    return { ok: false, steps, finalVerify: verify, error: `Failed to launch the active install after stopping the previous one: ${'error' in launched ? launched.error : 'unknown error'}` }
  }
  if (!launched.alreadyRunning) {
    steps.push({ step: 'launched_active', pid: launched.pid, installId: launched.installId, detail: `Launched active install ${launched.installId} (pid ${launched.pid}).` })
  }

  const booted = await waitUntil(async () => {
    if (!(await bothPortsHealthy())) return false
    const current = await runtimeVerify()
    return current.identityMatch === true
  }, input.bootTimeoutMs ?? 180_000, 2_000)
  if (!booted) {
    steps.push({ step: 'wait_timed_out', detail: 'Active install did not report healthy+identity-matched within the boot timeout.' })
    verify = await runtimeVerify()
    return { ok: false, steps, finalVerify: verify, error: 'Timed out waiting for the newly launched active install to become healthy.' }
  }

  verify = await runtimeVerify()
  if (!verify.identityMatch) {
    return { ok: false, steps, finalVerify: verify, error: `Post-transition identity mismatch: ACTIVE_INSTALL=${activeStatus.activeInstallId}, RUNNING_INSTALL=${verify.runningInstallId ?? 'unknown'}.` }
  }
  return { ok: true, steps, finalVerify: verify }
}

export { LOCAL_CORE_PORT, LOCAL_UI_PORT, LOCAL_UI_ORIGIN, LOCAL_CORE_ORIGIN }
