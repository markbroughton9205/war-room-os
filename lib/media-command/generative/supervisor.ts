/**
 * Dedicated worker-process supervision. The heavy model (torch) only ever runs in this child process.
 * - spawn(python, [approvedScript]) with argv fixed by HVS (no shell, no request-supplied argv)
 * - typed JSON on stdin; `HVS_EVENT {json}` lines on stdout; bounded, secret-free stderr tail
 * - detached process group; cancel / timeout kill the whole group (SIGTERM, then SIGKILL) → no zombies
 * - minimal environment: no API keys, HF/Transformers offline flags
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { containsSecretValue } from '../secrets'
import { HVS_GENERATION_ERROR_CODES, type HvsGenerationError, type HvsGenerationErrorCode } from './types'

export type WorkerEvent =
  | { event: 'ready'; python?: string; torch?: string | null; cuda?: boolean; device?: string | null; fake?: boolean; attention?: string | null; wanImportMode?: string | null; hostRamLoad?: string | null; cudaRuntime?: string | null; oomScoreAdj?: number | null; hfOffline?: boolean; networkGuard?: boolean }
  | { event: 'state'; state: 'LOADING_MODEL' | 'GENERATING' | 'ENCODING' }
  | { event: 'progress'; step: number; total: number }
  | { event: 'vram'; allocatedMiB?: number; reservedMiB?: number; peakMiB?: number }
  | { event: 'result'; outputPath: string; frames: number; width: number; height: number; fps: number; seed: number; fake?: boolean; fixture?: boolean; actual?: Record<string, unknown> }
  | { event: 'error'; code: string; message: string }

export type SupervisorOutcome = {
  ok: boolean
  result: Extract<WorkerEvent, { event: 'result' }> | null
  ready: Extract<WorkerEvent, { event: 'ready' }> | null
  error: HvsGenerationError | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
  oomDetected: boolean
  lastState: string | null
  peakVramMiB: number | null
  stderrTail: string
  durationMs: number
  pid: number | null
  processGroupKilled: boolean
  processGroupGone: boolean | null
}

export type SupervisorOptions = {
  python: string
  script: string
  input: Record<string, unknown>
  /** Total wall-clock budget. Bounded 5 s .. 4 h. */
  timeoutMs: number
  /** Time allowed until the worker reports `ready` (imports done). */
  readyTimeoutMs?: number
  signal?: AbortSignal
  onEvent?: (event: WorkerEvent) => void
  extraEnv?: Record<string, string>
  killGraceMs?: number
}

export const STDERR_TAIL_BYTES = 8 * 1024
const OOM_PATTERN = /CUDA out of memory|OutOfMemoryError|CUBLAS_STATUS_ALLOC_FAILED|cudaErrorMemoryAllocation|HIP out of memory/i
const SECRET_LINE = /(api[_-]?key|token|secret|authorization|bearer|password)\s*[=:]/i

export function sanitizeLogTail(text: string, max = STDERR_TAIL_BYTES): string {
  const lines = text.split('\n').map(line => {
    if (SECRET_LINE.test(line)) return '[redacted line]'
    return line.split(/\s+/).some(token => containsSecretValue(token)) ? '[redacted line]' : line
  })
  const joined = lines.join('\n')
  return joined.length > max ? joined.slice(joined.length - max) : joined
}

/** Minimal worker environment. Nothing from .env.local / API keys is forwarded. */
export function workerEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: 'C.UTF-8',
    PYTHONUNBUFFERED: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_DATASETS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    TOKENIZERS_PARALLELISM: 'false',
  }
  if (process.env.CUDA_VISIBLE_DEVICES) env.CUDA_VISIBLE_DEVICES = process.env.CUDA_VISIBLE_DEVICES
  for (const [key, value] of Object.entries(extra)) {
    if (/^(HVS_|PYTORCH_CUDA_ALLOC_CONF$|IMAGEIO_FFMPEG_EXE$)/.test(key) && !containsSecretValue(value)) env[key] = value
  }
  return env as NodeJS.ProcessEnv
}

export function mapErrorCode(code: string | undefined): HvsGenerationErrorCode {
  return (HVS_GENERATION_ERROR_CODES as readonly string[]).includes(code ?? '') ? code as HvsGenerationErrorCode : 'GENERATION_FAILED'
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function runSupervisedWorker(options: SupervisorOptions): Promise<SupervisorOutcome> {
  const started = Date.now()
  const timeoutMs = Math.min(Math.max(options.timeoutMs, 5_000), 4 * 60 * 60 * 1000)
  const readyTimeoutMs = Math.min(options.readyTimeoutMs ?? 120_000, timeoutMs)
  const grace = options.killGraceMs ?? 5_000
  return new Promise(resolve => {
    const base: SupervisorOutcome = {
      ok: false, result: null, ready: null, error: null, exitCode: null, signal: null, timedOut: false, cancelled: false,
      oomDetected: false, lastState: null, peakVramMiB: null, stderrTail: '', durationMs: 0, pid: null,
      processGroupKilled: false, processGroupGone: null,
    }
    if (!existsSync(options.python)) {
      resolve({ ...base, error: { code: 'MODEL_NOT_INSTALLED', message: 'Worker Python runtime is not installed.' }, durationMs: 0 })
      return
    }
    if (!existsSync(options.script)) {
      resolve({ ...base, error: { code: 'GENERATION_FAILED', message: 'Worker script missing.' } })
      return
    }
    const child = spawn(options.python, [options.script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: workerEnvironment(options.extraEnv),
    })
    const outcome: SupervisorOutcome = { ...base, pid: child.pid ?? null }
    let stdoutBuf = ''
    let stderrAll = ''
    let workerError: HvsGenerationError | null = null
    let settled = false
    let killTimer: NodeJS.Timeout | null = null
    let timeoutKind: 'timeout' | 'ready-timeout' | null = null

    const killGroup = (why: 'timeout' | 'cancel' | 'ready-timeout') => {
      if (!child.pid || outcome.processGroupKilled) return
      outcome.processGroupKilled = true
      if (why === 'cancel') outcome.cancelled = true
      else {
        outcome.timedOut = true
        timeoutKind = why
      }
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
      killTimer = setTimeout(() => {
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
      }, grace)
    }

    const totalTimer = setTimeout(() => killGroup('timeout'), timeoutMs)
    const readyTimer = setTimeout(() => { if (!outcome.ready) killGroup('ready-timeout') }, readyTimeoutMs)
    const onAbort = () => killGroup('cancel')
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    const handleLine = (line: string) => {
      if (!line.startsWith('HVS_EVENT ')) return
      let evt: WorkerEvent
      try { evt = JSON.parse(line.slice(10)) as WorkerEvent } catch { return }
      if (!evt || typeof evt !== 'object' || typeof (evt as { event?: unknown }).event !== 'string') return
      if (evt.event === 'ready') outcome.ready = evt
      if (evt.event === 'state') outcome.lastState = evt.state
      if (evt.event === 'vram' && typeof evt.peakMiB === 'number') outcome.peakVramMiB = Math.max(outcome.peakVramMiB ?? 0, evt.peakMiB)
      if (evt.event === 'result') outcome.result = evt
      if (evt.event === 'error') workerError = { code: mapErrorCode(evt.code), message: String(evt.message ?? '').slice(0, 500) }
      try { options.onEvent?.(evt) } catch { /* observer errors never kill supervision */ }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
      if (stdoutBuf.length > 4 * 1024 * 1024) stdoutBuf = stdoutBuf.slice(-1024 * 1024)
      let idx: number
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim()
        stdoutBuf = stdoutBuf.slice(idx + 1)
        handleLine(line)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrAll += chunk.toString('utf8')
      if (stderrAll.length > 64 * 1024) stderrAll = stderrAll.slice(-32 * 1024)
      if (OOM_PATTERN.test(stderrAll)) outcome.oomDetected = true
      // Real tqdm step progress from the official sampler loop, e.g. " 12/50 [".
      const matches = [...chunk.toString('utf8').matchAll(/(\d{1,4})\/(\d{1,4}) \[/g)]
      const last = matches.at(-1)
      if (last && outcome.lastState === 'GENERATING') {
        try { options.onEvent?.({ event: 'progress', step: Number(last[1]), total: Number(last[2]) }) } catch { /* ignore */ }
      }
    })
    child.stdin.on('error', () => { /* worker may exit before reading */ })
    child.stdin.end(`${JSON.stringify(options.input)}\n`)

    const finish = (code: number | null, sig: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      if (stdoutBuf.trim()) handleLine(stdoutBuf.trim())
      clearTimeout(totalTimer)
      clearTimeout(readyTimer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', onAbort)
      // Belt and braces: make sure no grandchildren survive in the group.
      if (child.pid && groupAlive(child.pid)) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
        outcome.processGroupKilled = true
      }
      outcome.processGroupGone = child.pid ? !groupAlive(child.pid) : null
      outcome.exitCode = code
      outcome.signal = sig
      outcome.durationMs = Date.now() - started
      outcome.stderrTail = sanitizeLogTail(stderrAll)
      if (OOM_PATTERN.test(stderrAll)) outcome.oomDetected = true
      if (outcome.cancelled) {
        outcome.error = { code: 'CANCELLED', message: 'Generation cancelled; worker process group terminated.' }
      } else if (outcome.timedOut) {
        outcome.error = timeoutKind === 'ready-timeout'
          ? { code: 'MODEL_LOAD_FAILED', message: `Worker did not become ready within ${Math.round(readyTimeoutMs / 1000)} s; process group terminated.` }
          : { code: 'GENERATION_TIMEOUT', message: `Worker exceeded ${Math.round(timeoutMs / 1000)} s during ${outcome.lastState ?? 'startup'}; process group terminated.` }
      } else if (outcome.oomDetected || (workerError as HvsGenerationError | null)?.code === 'GPU_OUT_OF_MEMORY') {
        outcome.error = { code: 'GPU_OUT_OF_MEMORY', message: (workerError as HvsGenerationError | null)?.message || 'CUDA out of memory in worker.' }
      } else if (workerError) {
        outcome.error = workerError
      } else if (code === 0 && outcome.result) {
        outcome.ok = true
      } else if (code === 0) {
        outcome.error = { code: 'GENERATION_FAILED', message: 'Worker exited 0 without a result event.' }
      } else {
        const crashedDuringLoad = outcome.lastState === 'LOADING_MODEL'
        outcome.error = {
          code: crashedDuringLoad ? 'MODEL_LOAD_FAILED' : 'GENERATION_FAILED',
          message: `Worker crashed (exit ${code ?? 'null'}${sig ? `, signal ${sig}` : ''}) during ${outcome.lastState ?? 'startup'}.`,
        }
      }
      resolve(outcome)
    }
    child.on('error', err => {
      workerError = { code: 'GENERATION_FAILED', message: `Worker failed to start: ${err.message.slice(0, 200)}` }
      finish(null, null)
    })
    child.on('close', (code, sig) => finish(code, sig))
  })
}
