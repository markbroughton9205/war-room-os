/**
 * Bounded local subprocess execution for real tokenizer training (Part 9 + Commander fix-packet
 * Defect 2). `spawn` only, a fixed executable + argv array — never `shell: true`, `exec()`,
 * `eval()`, `Function()`, a client-supplied executable/output path, or generic Python execution.
 *
 * Exclusivity is enforced by a filesystem-backed lock (.war-room/sovereign-model-lab/tokenizer-jobs/
 * .lock) acquired via an OS-backed exclusive-create (`open(path, 'wx')`), not by a storage scan —
 * a scan-then-write sequence is exactly the TOCTOU race the fix packet identified. The entire
 * critical section (re-reading the tokenizer experiment, verifying the approval is unused,
 * rechecking plan/corpus freshness, consuming the approval, persisting the initial job record, and
 * spawning) runs while the lock is held. The lock is only released when the job actually
 * terminates (completion/failure/timeout/cancellation) or when the critical section itself fails
 * before ever spawning — never merely after the setup step succeeds.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { readCorpusManifest } from './corpusBuilder'
import { getTokenizerExperiment, getTokenizerJobStatus, saveTokenizerExperiment, saveTokenizerJobStatus, tokenizerJobLockPath } from './storage'
import { assertFreshBeforeSpawn, consumeApproval } from './tokenizerApproval'
import type { TokenizerJobStatus } from './types'

const MAX_STDIO_BUFFER_CHARS = 20_000
const STDIO_TAIL_CHARS = 2_000
const CORPUS_ID = 'WRM-001'

export class TokenizerJobAlreadyRunningError extends Error {
  constructor(jobId: string) {
    super(`A tokenizer job is already running (${jobId}). Only one tokenizer job may run at a time.`)
    this.name = 'TokenizerJobAlreadyRunningError'
  }
}

export class TokenizerApprovalInvalidError extends Error {
  constructor(reason: string, detail: string) {
    super(`Tokenizer training approval is invalid (${reason}): ${detail}`)
    this.name = 'TokenizerApprovalInvalidError'
  }
}

const activeProcesses = new Map<string, ChildProcess>()
const terminationReason = new Map<string, 'cancelled' | 'timed_out'>()

/** Fire-and-forget writes (progress persistence, lock release) must never become unhandled
 * promise rejections — Node treats those as fatal by default. A transient Windows EPERM/EBUSY on
 * the underlying rename-based atomic write (storage.ts, pre-existing, not touched by this fix)
 * must be logged, not allowed to crash the server mid-training-job. */
function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch(error => {
    console.error(`[sovereign-model-lab] tokenizerRuntime: ${context} failed`, error instanceof Error ? error.message : error)
  })
}

function buildFixedEnv(): NodeJS.ProcessEnv {
  const allowlist = process.platform === 'win32' ? ['PATH', 'SystemRoot', 'TEMP', 'TMP'] : ['PATH']
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'production' }
  for (const key of allowlist) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/** Best-effort cleanup so a spawned job cannot outlive this server process. Registered once. Only
 * hooks the natural `exit` event — SIGINT/SIGTERM are deliberately left unhooked so this module
 * never interferes with the Next.js dev server's own reload/shutdown signal handling. Honest
 * limitation: on Windows, a hard kill of the parent (not a graceful exit) can still leave an
 * orphaned child — this is a known gap, not a guarantee. The lock file itself is the durable
 * record that survives a crash; a later process re-acquiring it performs the stale-lock check. */
let cleanupRegistered = false
function ensureCleanupRegistered(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.on('exit', () => {
    for (const [jobId, child] of activeProcesses) {
      terminationReason.set(jobId, 'cancelled')
      child.kill()
    }
  })
}

// ---------------------------------------------------------------------------
// Exclusive tokenizer-job lock (Defect 2)
// ---------------------------------------------------------------------------

type TokenizerJobLock = {
  jobId: string
  pid: number
  acquiredAt: string
  programId: string
  planId: string
  approvalId: string
}

async function readLockFile(lockPath: string): Promise<TokenizerJobLock | null> {
  try {
    const raw = await readFile(lockPath, 'utf8')
    return JSON.parse(raw) as TokenizerJobLock
  } catch {
    return null
  }
}

/** `process.kill(pid, 0)` sends no signal — it only probes whether the OS still recognizes the
 * pid. Only a confirmed ESRCH ("no such process") counts as proof of absence; anything else
 * (including EPERM, meaning the process exists but we lack permission to signal it) is treated as
 * "cannot prove absent" and must NOT be reclaimed. */
function isConfirmedDead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

async function writeLockFile(lockPath: string, payload: TokenizerJobLock, flag: 'wx' | 'w'): Promise<void> {
  const handle = await open(lockPath, flag)
  try {
    await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8')
  } finally {
    await handle.close()
  }
}

class TokenizerJobLockHandle {
  constructor(private readonly lockPath: string) {}
  async updateMetadata(patch: Partial<TokenizerJobLock>, current: TokenizerJobLock): Promise<void> {
    await writeLockFile(this.lockPath, { ...current, ...patch }, 'w')
  }
  async release(): Promise<void> {
    await rm(this.lockPath, { force: true })
  }
}

/**
 * Atomically acquires the single global tokenizer-job lock. A second concurrent caller fails
 * immediately (before touching the tokenizer experiment, before consuming any approval, before
 * spawning anything) unless the existing lock's owning process can be POSITIVELY confirmed dead —
 * an old/aged lock is never treated as stale on age alone.
 */
async function acquireTokenizerJobLock(seed: { jobId: string; programId: string }): Promise<TokenizerJobLockHandle> {
  const lockPath = tokenizerJobLockPath()
  await mkdir(path.dirname(lockPath), { recursive: true })
  const payload: TokenizerJobLock = {
    jobId: seed.jobId,
    programId: seed.programId,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    planId: 'pending',
    approvalId: 'pending',
  }

  const tryCreate = async (): Promise<boolean> => {
    try {
      await writeLockFile(lockPath, payload, 'wx')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  }

  if (await tryCreate()) return new TokenizerJobLockHandle(lockPath)

  // Lock already held. Never delete merely because it looks old — only reclaim if the recorded
  // owner process can be positively proven gone.
  const existing = await readLockFile(lockPath)
  if (existing && isConfirmedDead(existing.pid)) {
    await logWarRoomRepoAudit('sovereign-model-lab: stale tokenizer job lock recovered', {
      staleJobId: existing.jobId,
      staleOwnerPid: existing.pid,
      staleAcquiredAt: existing.acquiredAt,
      recoveredByPid: process.pid,
    })
    const staleStatus = await getTokenizerJobStatus(existing.jobId)
    if (staleStatus?.status === 'running') {
      await saveTokenizerJobStatus({
        ...staleStatus,
        status: 'failed',
        endedAt: new Date().toISOString(),
        stderrTail: `${staleStatus.stderrTail}\n[stale-lock recovery] Owning process ${existing.pid} was confirmed no longer running; job marked failed.`.slice(-STDIO_TAIL_CHARS),
      })
    }
    await rm(lockPath, { force: true })
    if (await tryCreate()) return new TokenizerJobLockHandle(lockPath)
    // Another request won the lock in the instant between our reclaim and retry — fail closed,
    // do not loop indefinitely.
    const raceWinner = await readLockFile(lockPath)
    throw new TokenizerJobAlreadyRunningError(raceWinner?.jobId ?? 'unknown')
  }

  // Cannot prove the existing owner is absent — fail closed.
  throw new TokenizerJobAlreadyRunningError(existing?.jobId ?? 'unknown')
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

/**
 * The entire flow — checking for a running job, re-reading the tokenizer experiment fresh,
 * verifying the approval is unused, rechecking plan/corpus freshness, consuming the approval,
 * persisting the initial running job record, and spawning — happens while the lock is held. If
 * any step fails, the lock is released immediately and no process is ever spawned.
 */
export async function startTokenizerTraining(args: {
  programId: string
  tokenizerExperimentId: string
}): Promise<{ jobId: string }> {
  const jobId = randomUUID()
  const lock = await acquireTokenizerJobLock({ jobId, programId: args.programId })

  try {
    const experiment = await getTokenizerExperiment(args.tokenizerExperimentId)
    if (!experiment?.plan || !experiment.approval) {
      throw new TokenizerApprovalInvalidError('approval_plan_mismatch', 'No approved tokenizer plan exists for this program (re-read fresh under lock).')
    }
    if (experiment.approval.consumedAt) {
      throw new TokenizerApprovalInvalidError('approval_already_consumed', `Approval ${experiment.approval.approvalId} was already consumed at ${experiment.approval.consumedAt}.`)
    }

    const currentCorpusManifest = await readCorpusManifest(CORPUS_ID, experiment.plan.corpusVersion)
    if (!currentCorpusManifest) {
      throw new TokenizerApprovalInvalidError('corpus_manifest_hash_mismatch', 'The corpus version referenced by this plan no longer exists on disk.')
    }
    const freshness = assertFreshBeforeSpawn({ plan: experiment.plan, approval: experiment.approval, currentCorpusManifest })
    if (!freshness.ok) throw new TokenizerApprovalInvalidError(freshness.reason, freshness.detail)

    await lock.updateMetadata(
      { planId: experiment.plan.planId, approvalId: experiment.approval.approvalId },
      { jobId, programId: args.programId, pid: process.pid, acquiredAt: new Date().toISOString(), planId: 'pending', approvalId: 'pending' },
    )

    // Consume the approval as part of the same locked transaction — no other request can observe
    // or reuse this approval once this line completes, because no other request can be inside
    // this critical section concurrently.
    const consumedApproval = consumeApproval(experiment.approval)
    await saveTokenizerExperiment({ ...experiment, jobId, approval: consumedApproval, updatedAt: new Date().toISOString() })

    ensureCleanupRegistered()

    const startedAt = new Date().toISOString()
    let jobStatus: TokenizerJobStatus = {
      jobId,
      planId: experiment.plan.planId,
      approvalId: experiment.approval.approvalId,
      startedAt,
      endedAt: null,
      status: 'running',
      exitCode: null,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutTail: '',
      stderrTail: '',
      lastProgressAt: startedAt,
    }
    await saveTokenizerJobStatus(jobStatus)

    const child = spawn(experiment.plan.executablePath, experiment.plan.argv, {
      env: buildFixedEnv(),
      windowsHide: true,
    })
    activeProcesses.set(jobId, child)

    let stdoutBuf = ''
    let stderrBuf = ''

    const persistProgress = () => {
      jobStatus = {
        ...jobStatus,
        stdoutTail: stdoutBuf.slice(-STDIO_TAIL_CHARS),
        stderrTail: stderrBuf.slice(-STDIO_TAIL_CHARS),
        lastProgressAt: new Date().toISOString(),
      }
      fireAndForget(saveTokenizerJobStatus(jobStatus), 'persist tokenizer job progress')
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
      if (stdoutBuf.length > MAX_STDIO_BUFFER_CHARS) {
        stdoutBuf = stdoutBuf.slice(-MAX_STDIO_BUFFER_CHARS)
        jobStatus.stdoutTruncated = true
      }
      persistProgress()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
      if (stderrBuf.length > MAX_STDIO_BUFFER_CHARS) {
        stderrBuf = stderrBuf.slice(-MAX_STDIO_BUFFER_CHARS)
        jobStatus.stderrTruncated = true
      }
      persistProgress()
    })

    const timeoutHandle = setTimeout(() => {
      terminationReason.set(jobId, 'timed_out')
      child.kill()
    }, experiment.plan.maxRuntimeMs)

    // Centralized, exactly-once terminal handler. Node can emit 'error' (spawn itself never
    // launched — ENOENT/EACCES/etc.) and/or 'close' for the same child depending on the failure
    // mode; this guard ensures cleanup (lock release, job-status persistence, activeProcesses/
    // termination bookkeeping) runs exactly once no matter which event(s) fire or in what order.
    let terminalHandled = false
    const finalizeJob = (status: TokenizerJobStatus['status'], exitCode: number | null, extraDetail?: string) => {
      if (terminalHandled) return
      terminalHandled = true
      clearTimeout(timeoutHandle)
      activeProcesses.delete(jobId)
      terminationReason.delete(jobId)
      const stderrWithDetail = extraDetail
        ? `${stderrBuf}\n${extraDetail}`.slice(-STDIO_TAIL_CHARS)
        : stderrBuf.slice(-STDIO_TAIL_CHARS)
      jobStatus = {
        ...jobStatus,
        endedAt: new Date().toISOString(),
        exitCode,
        status,
        stdoutTail: stdoutBuf.slice(-STDIO_TAIL_CHARS),
        stderrTail: stderrWithDetail,
      }
      fireAndForget(saveTokenizerJobStatus(jobStatus), 'persist final tokenizer job status')
      // Job has definitively terminated (completed/failed/timed_out/cancelled) — release the
      // exclusive lock so the next tokenizer job may be started. Never retried, never restarted,
      // never re-consumes the approval (already consumed once, before spawn).
      fireAndForget(lock.release(), 'release tokenizer job lock')
    }

    // spawn() itself failing to launch the executable (removed binary, uninstalled Python,
    // permissions denied, invalid path, ENOENT, EACCES, ...) emits this asynchronously — Node's
    // default behavior for an EventEmitter 'error' with zero listeners is to throw and crash the
    // whole process. This handler keeps the failure isolated to the tokenizer job: War Room itself
    // must keep running. Marked 'failed' (never 'completed', never any state that could lead to
    // tokenizer_ready) with a message that clearly identifies it as a spawn failure, distinct from
    // a runtime failure (real nonzero exit code), a timeout, or a cancellation.
    child.on('error', (err: NodeJS.ErrnoException) => {
      finalizeJob('failed', null, `Spawn failed (${err.code ?? 'unknown'}): ${err.message}`)
    })

    child.on('close', (code) => {
      const reason = terminationReason.get(jobId)
      const status: TokenizerJobStatus['status'] =
        reason === 'cancelled' ? 'cancelled'
          : reason === 'timed_out' ? 'timed_out'
            : code === 0 ? 'completed' : 'failed'
      finalizeJob(status, code)
    })

    return { jobId }
  } catch (error) {
    // Any failure before/without a successfully spawned+tracked child releases the lock
    // immediately — no job is actually running, so nothing should hold the slot.
    await lock.release()
    throw error
  }
}

export async function cancelTokenizerTraining(jobId: string): Promise<boolean> {
  const child = activeProcesses.get(jobId)
  if (!child) {
    const existing = await getTokenizerJobStatus(jobId)
    return existing?.status === 'running' ? false : Boolean(existing)
  }
  terminationReason.set(jobId, 'cancelled')
  child.kill()
  return true
}

export { getTokenizerJobStatus } from './storage'
