import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { wrapSandboxed, SandboxUnavailable, type SandboxOpts } from '../runtime/sandbox'
import { redactText } from '@/lib/recursive-learning/ingestion/redact'

/** Finds a real executable without trusting the desktop session's PATH (a launcher-started server often lacks the shell's PATH). Env override first. */
export function resolveBin(name: 'node' | 'git' | 'pnpm'): string {
  const env = process.env[`WAR_ROOM_ENG_${name.toUpperCase()}`]
  if (env && existsSync(env)) return env
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node')
  try { for (const v of readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin')) } catch { /* no nvm */ }
  dirs.push('/usr/local/bin', '/usr/bin', '/bin')
  for (const d of dirs) { const p = path.join(d, name); if (existsSync(p)) return p }
  return name
}

/** Environment for deterministic tools: no credentials, a PATH that contains the directory of the resolved node. */
export function toolEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const nodeDir = path.dirname(resolveBin('node'))
  return { PATH: [nodeDir, '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter), HOME: os.homedir(), LANG: 'C.UTF-8', CI: '1', ...extra } as unknown as NodeJS.ProcessEnv
}

export type ToolRun = { argv: string[]; cwd: string; exitCode: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }
export function runTool(argv: string[], cwd: string, opts: { timeoutMs?: number; env?: Record<string, string>; /** run inside the OS sandbox (model-generated code: tsc, validators) */ sandbox?: SandboxOpts } = {}): Promise<ToolRun> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let exec = argv
    if (opts.sandbox) {
      try { exec = wrapSandboxed(argv, opts.sandbox).argv } catch (e) {
        const msg = e instanceof SandboxUnavailable ? e.message : String(e)
        return resolve({ argv, cwd, exitCode: null, timedOut: false, stdout: '', stderr: msg, durationMs: 0 })
      }
    }
    execFile(exec[0], exec.slice(1), { cwd, env: toolEnv(opts.env), timeout: opts.timeoutMs ?? 300_000, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
      const clip = (t: string) => redactText(String(t ?? '')).slice(-12_000)
      resolve({ argv, cwd, exitCode: e ? (typeof e.code === 'number' ? e.code : null) : 0, timedOut: !!e?.killed, stdout: clip(stdout), stderr: clip(stderr), durationMs: Date.now() - t0 })
    })
  })
}
