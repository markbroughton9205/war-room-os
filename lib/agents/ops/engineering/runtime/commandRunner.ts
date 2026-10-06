import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { redactText } from '@/lib/recursive-learning/ingestion/redact'
import type { EngineeringTool } from '../../types'
import type { CommandRecord } from './ports'

export class CommandRefusal extends Error { constructor(msg: string) { super(msg) } }
const MAX_OUTPUT = 20_000
const sha = (t: string) => createHash('sha256').update(t).digest('hex')

/** Only these argv shapes can run, and only with the matching tool grant. No shell, no git, no network tools, no deletion. (pnpm is excluded: Corepack may download it on first use.) */
export function authorizeCommand(argv: string[], root: string, tools: EngineeringTool[]): { tool: EngineeringTool } {
  const [bin, ...rest] = argv
  const inRoot = (p: string) => { const abs = path.resolve(root, p); return !path.isAbsolute(p) && (abs === root || abs.startsWith(root + path.sep)) && !p.split('/').includes('node_modules') }
  const scripts = (() => { try { return Object.keys((JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {}) as object) } catch { return [] as string[] } })()
  if (bin === 'node' && rest[0] === '--check' && rest.length === 2 && inRoot(rest[1])) { if (!tools.includes('run_typecheck')) throw new CommandRefusal('run_typecheck is not granted'); return { tool: 'run_typecheck' } }
  if (bin === 'node' && rest[0] === '--test' && rest.slice(1).every((p) => !p.startsWith('-') && inRoot(p))) { if (!tools.includes('run_workspace_tests')) throw new CommandRefusal('run_workspace_tests is not granted'); return { tool: 'run_workspace_tests' } }
  if (bin === 'npx' && rest[0] === 'tsc' && rest.slice(1).every((a) => ['--noEmit', '--incremental', 'false', '-p', 'tsconfig.json'].includes(a))) { if (!tools.includes('run_typecheck')) throw new CommandRefusal('run_typecheck is not granted'); return { tool: 'run_typecheck' } }
  if (bin === 'npm' && rest[0] === 'run' && rest.length === 2 && scripts.includes(rest[1]) && /^(test|check|typecheck|lint|validate[\w:-]*)$/.test(rest[1])) { if (!tools.includes('run_workspace_tests')) throw new CommandRefusal('run_workspace_tests is not granted'); return { tool: 'run_workspace_tests' } }
  throw new CommandRefusal(`command not allowed: ${argv.join(' ').slice(0, 120)}`)
}

const scrubbedEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8', NODE_ENV: 'test', CI: '1', ...extra })

/** Runs an authorized command in the workspace with a timeout, bounded + redacted output and a scrubbed environment. */
export function runCommand(root: string, argv: string[], tools: EngineeringTool[], opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<CommandRecord> {
  const started = new Date()
  const t0 = Date.now()
  try { authorizeCommand(argv, root, tools) } catch (e) {
    const msg = e instanceof Error ? e.message : 'refused'
    return Promise.resolve({ argv, cwd: root, exitCode: null, timedOut: false, stdout: '', stderr: msg, durationMs: 0, startedAt: started.toISOString(), outputHash: sha(msg), refused: msg })
  }
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { cwd: root, env: scrubbedEnv(opts.env), timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const clip = (t: string) => redactText(String(t ?? '')).slice(-MAX_OUTPUT)
      const out = clip(stdout); const er = clip(stderr)
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
      resolve({ argv, cwd: root, exitCode: e ? (typeof e.code === 'number' ? e.code : null) : 0, timedOut: !!e?.killed, stdout: out, stderr: er, durationMs: Date.now() - t0, startedAt: started.toISOString(), outputHash: sha(out + '\n' + er) })
    })
  })
}

export type ServerProbe = { baseUrl: string; stop: () => Promise<void>; log: () => string }
/** Starts a workspace web server on a free loopback port for runtime checks (tool: read_runtime_output). */
export async function startWorkspaceServer(root: string, script: string, tools: EngineeringTool[], env: Record<string, string> = {}, readyMs = 8000): Promise<ServerProbe> {
  if (!tools.includes('read_runtime_output')) throw new CommandRefusal('read_runtime_output is not granted')
  if (path.isAbsolute(script) || script.includes('..') || !existsSync(path.join(root, script))) throw new CommandRefusal(`server script not found inside the workspace: ${script}`)
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn('node', [script], { cwd: root, env: scrubbedEnv({ PORT: String(port), HOST: '127.0.0.1', ...env }), stdio: ['ignore', 'pipe', 'pipe'] })
  let buf = ''
  child.stdout.on('data', (d) => { buf += String(d) }); child.stderr.on('data', (d) => { buf += String(d) })
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + readyMs
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}): ${redactText(buf).slice(-400)}`)
    try { const r = await fetch(baseUrl + '/', { signal: AbortSignal.timeout(500) }); void r; break } catch { if (Date.now() > deadline) { child.kill('SIGKILL'); throw new Error('server did not become ready') } await new Promise((r) => setTimeout(r, 100)) }
  }
  return { baseUrl, log: () => redactText(buf).slice(-4000), stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1500) }) }
}
