/**
 * Typed validation/terminal operation executor. Every operation is a fixed, pre-defined argv
 * array — never a user-supplied shell string. File/script parameters are validated against the
 * repo-containment check (repositoryInspector.resolveRepoRelativePath) and, for validation
 * scripts, an explicit on-disk existence + naming-pattern check, before being placed into the
 * argv array. No command chaining, pipes, redirection, or shell metacharacters are possible
 * because args are always passed as an array, never interpolated into a command string.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { constants as FsConstants } from 'node:fs'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getRepoStatus } from '@/lib/repo/status'
import { previewDiff } from '@/lib/repo/diff'
import { resolveRepoRelativePath } from './repositoryInspector'
import type { NativeValidationOperation, NativeValidationResult } from './types'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const BUILD_TIMEOUT_MS = 400_000

/** pnpm on Windows resolves via a .cmd shim, which execFile needs shell:true to locate — args stay
 * an array either way, so this never introduces a string-concatenation injection surface. */
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

async function runOperation(op: NativeValidationOperation, repoRoot: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  switch (op.id) {
    case 'typecheck':
      return runExecFile('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: repoRoot, timeoutMs: DEFAULT_TIMEOUT_MS })

    case 'eslint_targeted': {
      const files = validateTargetFiles(op.targets)
      if (!files.length) return { stdout: '', stderr: 'eslint_targeted requires at least one target file.', exitCode: 1 }
      return runExecFile('pnpm', ['exec', 'eslint', ...files, '--max-warnings=0'], { cwd: repoRoot, timeoutMs: DEFAULT_TIMEOUT_MS })
    }

    case 'build':
      return runExecFile('pnpm', ['run', 'build'], { cwd: repoRoot, timeoutMs: BUILD_TIMEOUT_MS })

    case 'git_diff_check':
      return runExecFile('git', ['diff', '--check'], { cwd: repoRoot, timeoutMs: DEFAULT_TIMEOUT_MS })

    case 'validation_script': {
      const script = op.targets?.[0]
      if (!script) return { stdout: '', stderr: 'validation_script requires exactly one target script path.', exitCode: 1 }
      const registered = await isRegisteredValidationScript(script)
      if (!registered) {
        return { stdout: '', stderr: `"${script}" is not a registered validation script (must match scripts/run-*.mjs and exist on disk).`, exitCode: 1 }
      }
      return runExecFile('node', [script], { cwd: repoRoot, timeoutMs: DEFAULT_TIMEOUT_MS })
    }

    default:
      return { stdout: '', stderr: `Unsupported validation operation: ${op.id}`, exitCode: 1 }
  }
}

export async function runValidationOperation(op: NativeValidationOperation): Promise<NativeValidationResult> {
  const repoRoot = resolveRepoRoot()
  const startedAt = Date.now()
  const { stdout, stderr, exitCode } = await runOperation(op, repoRoot)
  return {
    operation: op,
    ok: exitCode === 0,
    exitCode,
    stdout: stdout.slice(0, 20_000),
    stderr: stderr.slice(0, 20_000),
    durationMs: Date.now() - startedAt,
    ranAt: new Date().toISOString(),
  }
}

export async function runValidationOperations(ops: NativeValidationOperation[]): Promise<NativeValidationResult[]> {
  const results: NativeValidationResult[] = []
  for (const op of ops) {
    results.push(await runValidationOperation(op))
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
