/**
 * Typed validation/terminal operation executor. Every operation is a fixed, pre-defined argv
 * array — never a user-supplied shell string. File/script parameters are validated against the
 * repo-containment check (repositoryInspector.resolveRepoRelativePath) and, for validation
 * scripts, an explicit on-disk existence + naming-pattern check, before being placed into the
 * argv array. No command chaining, pipes, redirection, or shell metacharacters are possible
 * because args are always passed as an array, never interpolated into a command string.
 *
 * Two execution paths share the SAME argv mapping (resolveOperationArgv):
 *   1. runValidationOperation() — the original promisified-execFile capture API. Unchanged default
 *      for compatibility (output captured after exit, truncated to 20KB, redacted).
 *   2. runValidationOperationStreaming() — spawn-based: stdout/stderr chunks are redacted and
 *      pushed to a listener AND to the per-repair ring buffer (commandOutput.ts) as they arrive,
 *      the child is registered in processRegistry.ts (so a Commander cancel can kill the whole
 *      process tree), and the final captured result is identical in shape to path 1.
 *
 * All stored/streamed output passes through outputRedaction.ts BEFORE it is persisted or emitted —
 * a secret printed by a build tool must never land in .war-room/ persistence or an SSE frame.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { constants as FsConstants } from 'node:fs'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getRepoStatus } from '@/lib/repo/status'
import { previewDiff } from '@/lib/repo/diff'
import { resolveRepoRelativePath } from './repositoryInspector'
import { redactSecretsFromOutput } from './outputRedaction'
import { appendCommandOutput } from './commandOutput'
import {
  isRepairCancellationRequested,
  killProcessesForRepair,
  registerActiveProcess,
  unregisterActiveProcess,
} from './processRegistry'
import type { NativeValidationOperation, NativeValidationResult } from './types'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const BUILD_TIMEOUT_MS = 400_000
const CAPTURE_LIMIT = 20_000

/** pnpm on Windows resolves via a .cmd shim, which execFile/spawn need shell:true to locate — args
 * stay an array either way, so this never introduces a string-concatenation injection surface. */
async function runExecFile(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      timeout: opts.timeoutMs,
      shell: process.platform === 'win32',
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? (err instanceof Error ? err.message : String(err)),
      exitCode: typeof err.code === 'number' ? err.code : 1,
    }
  }
}

export type CommandOutputListener = (event: {
  operationId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}) => void

export type StreamingRunOptions = {
  /** When present, the child is registered for process-tree cancellation and output is appended
   * to the per-repair ring buffer the SSE stream route reads. */
  repairId?: string
  onOutput?: CommandOutputListener
}

/** Spawn-based execution with live, redacted, bounded output streaming. Captures the same final
 * stdout/stderr/exitCode shape runExecFile returns so callers can treat the two paths as
 * interchangeable. POSIX children are detached (process-group leaders) so processRegistry can kill
 * the whole tree with a negative-pid signal; Windows trees are killed via taskkill there instead. */
function runSpawnedStreaming(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; operationId: string; streaming?: StreamingRunOptions },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise(resolve => {
    const emit = (stream: 'stdout' | 'stderr' | 'system', text: string) => {
      const safe = redactSecretsFromOutput(text)
      if (!safe) return
      if (opts.streaming?.repairId) appendCommandOutput(opts.streaming.repairId, opts.operationId, stream, safe)
      opts.streaming?.onOutput?.({ operationId: opts.operationId, stream, text: safe })
    }

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
    })

    if (opts.streaming?.repairId) registerActiveProcess(opts.streaming.repairId, child, `${cmd} ${args.join(' ')}`)

    let stdout = ''
    let stderr = ''
    let finished = false
    const finish = (exitCode: number | null) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (opts.streaming?.repairId) unregisterActiveProcess(opts.streaming.repairId, child)
      resolve({ stdout, stderr, exitCode })
    }

    const timer = setTimeout(() => {
      emit('system', `[timeout] exceeded ${opts.timeoutMs}ms — killing process tree.`)
      if (opts.streaming?.repairId) {
        void killProcessesForRepair(opts.streaming.repairId).then(() => finish(null))
      } else {
        child.kill('SIGKILL')
        finish(null)
      }
    }, opts.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout = (stdout + text).slice(-CAPTURE_LIMIT)
      emit('stdout', text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr = (stderr + text).slice(-CAPTURE_LIMIT)
      emit('stderr', text)
    })
    child.on('error', error => {
      stderr += String(error)
      emit('stderr', String(error))
      finish(1)
    })
    child.on('exit', code => finish(code))
  })
}

const VALIDATION_SCRIPT_PATTERN = /^scripts\/run-[a-z0-9-]+\.mjs$/

async function isRegisteredValidationScript(relPath: string): Promise<boolean> {
  if (!VALIDATION_SCRIPT_PATTERN.test(relPath)) return false
  try {
    const abs = resolveRepoRelativePath(relPath)
    await access(abs, FsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function validateTargetFiles(targets: string[] | undefined): string[] {
  if (!targets?.length) return []
  const out: string[] = []
  for (const t of targets) {
    // throws RepoAccessDeniedError (propagates) if the target escapes the repo or hits a denylisted path
    resolveRepoRelativePath(t)
    out.push(t)
  }
  return out
}

type ResolvedArgv = { cmd: string; args: string[]; timeoutMs: number }

/** The single op -> argv mapping both execution paths share. Returns an error result (never
 * throws except repo-containment violations, which propagate by design) for unusable input. */
async function resolveOperationArgv(
  op: NativeValidationOperation,
): Promise<{ ok: true; argv: ResolvedArgv } | { ok: false; error: string }> {
  switch (op.id) {
    case 'typecheck':
      return { ok: true, argv: { cmd: 'pnpm', args: ['exec', 'tsc', '--noEmit'], timeoutMs: DEFAULT_TIMEOUT_MS } }

    case 'eslint_targeted': {
      const files = validateTargetFiles(op.targets)
      if (!files.length) return { ok: false, error: 'eslint_targeted requires at least one target file.' }
      return { ok: true, argv: { cmd: 'pnpm', args: ['exec', 'eslint', ...files, '--max-warnings=0'], timeoutMs: DEFAULT_TIMEOUT_MS } }
    }

    case 'build':
      return { ok: true, argv: { cmd: 'pnpm', args: ['run', 'build'], timeoutMs: BUILD_TIMEOUT_MS } }

    case 'git_diff_check':
      return { ok: true, argv: { cmd: 'git', args: ['diff', '--check'], timeoutMs: DEFAULT_TIMEOUT_MS } }

    case 'validation_script': {
      const script = op.targets?.[0]
      if (!script) return { ok: false, error: 'validation_script requires exactly one target script path.' }
      const registered = await isRegisteredValidationScript(script)
      if (!registered) {
        return { ok: false, error: `"${script}" is not a registered validation script (must match scripts/run-*.mjs and exist on disk).` }
      }
      return { ok: true, argv: { cmd: 'node', args: [script], timeoutMs: DEFAULT_TIMEOUT_MS } }
    }

    default:
      return { ok: false, error: `Unsupported validation operation: ${op.id}` }
  }
}

function toResult(op: NativeValidationOperation, captured: { stdout: string; stderr: string; exitCode: number | null }, startedAt: number): NativeValidationResult {
  return {
    operation: op,
    ok: captured.exitCode === 0,
    exitCode: captured.exitCode,
    stdout: redactSecretsFromOutput(captured.stdout).slice(0, CAPTURE_LIMIT),
    stderr: redactSecretsFromOutput(captured.stderr).slice(0, CAPTURE_LIMIT),
    durationMs: Date.now() - startedAt,
    ranAt: new Date().toISOString(),
  }
}

/** The original capture-only API — unchanged semantics, output now secret-redacted before storage. */
export async function runValidationOperation(op: NativeValidationOperation): Promise<NativeValidationResult> {
  const repoRoot = resolveRepoRoot()
  const startedAt = Date.now()
  const resolved = await resolveOperationArgv(op)
  if (!resolved.ok) {
    return toResult(op, { stdout: '', stderr: resolved.error, exitCode: 1 }, startedAt)
  }
  const captured = await runExecFile(resolved.argv.cmd, resolved.argv.args, { cwd: repoRoot, timeoutMs: resolved.argv.timeoutMs })
  return toResult(op, captured, startedAt)
}

/** Live-streaming variant: identical result shape, but output chunks are redacted and emitted to
 * the listener/ring buffer as they arrive, and the child is cancellable via processRegistry. */
export async function runValidationOperationStreaming(
  op: NativeValidationOperation,
  streaming: StreamingRunOptions = {},
): Promise<NativeValidationResult> {
  const repoRoot = resolveRepoRoot()
  const startedAt = Date.now()
  const resolved = await resolveOperationArgv(op)
  if (!resolved.ok) {
    return toResult(op, { stdout: '', stderr: resolved.error, exitCode: 1 }, startedAt)
  }
  streaming.onOutput?.({ operationId: op.id, stream: 'system', text: `[run] ${resolved.argv.cmd} ${resolved.argv.args.join(' ')}` })
  if (streaming.repairId) appendCommandOutput(streaming.repairId, op.id, 'system', `[run] ${resolved.argv.cmd} ${resolved.argv.args.join(' ')}`)
  const captured = await runSpawnedStreaming(resolved.argv.cmd, resolved.argv.args, {
    cwd: repoRoot,
    timeoutMs: resolved.argv.timeoutMs,
    operationId: op.id,
    streaming,
  })
  return toResult(op, captured, startedAt)
}

/** Sequential runner. When a repairId is supplied, runs the streaming path and honors
 * cancellation: a repair marked cancelled (processRegistry.markRepairCancelled) skips every
 * remaining operation with an honest `cancelled before start` record instead of launching it. */
export async function runValidationOperations(
  ops: NativeValidationOperation[],
  opts: { repairId?: string; onOutput?: CommandOutputListener } = {},
): Promise<NativeValidationResult[]> {
  const results: NativeValidationResult[] = []
  for (const op of ops) {
    if (opts.repairId && isRepairCancellationRequested(opts.repairId)) {
      results.push({
        operation: op,
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: 'cancelled before start — Commander cancelled this repair while an earlier operation was running.',
        durationMs: 0,
        ranAt: new Date().toISOString(),
      })
      continue
    }
    results.push(opts.repairId ? await runValidationOperationStreaming(op, opts) : await runValidationOperation(op))
  }
  return results
}

// --- Non-validation terminal operations (repo_status / repo_diff / dev_server_status) ---------

export async function terminalRepoStatus() {
  return getRepoStatus()
}

export async function terminalRepoDiff(paths?: string[]) {
  return previewDiff({ paths, maxBytes: 96 * 1024 })
}

export async function terminalDevServerStatus(): Promise<{ running: boolean; detail: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)
    const res = await fetch('http://localhost:3000', { signal: controller.signal, method: 'HEAD' }).catch(() =>
      fetch('http://localhost:3000', { signal: controller.signal, method: 'GET' }),
    )
    clearTimeout(timeout)
    return { running: res.ok || res.status < 500, detail: `HTTP ${res.status}` }
  } catch (error) {
    return { running: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Registered script existence check, exposed for the API layer / UI to list what's runnable. */
export { isRegisteredValidationScript }
export const NATIVE_BUILDER_VALIDATION_SCRIPT_PATTERN = VALIDATION_SCRIPT_PATTERN
