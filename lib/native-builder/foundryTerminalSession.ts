/**
 * Real local shell sessions for Foundry SHOW TERMINAL.
 * Linux uses `script` so the Commander gets a genuine PTY (pwd / node --version).
 * CWD is restricted to an authorized project root — never an arbitrary host path.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getCanonicalWarRoomSourceRoot } from './foundryWorkspaceIdentity'
import { isPathInsideRoot } from './workspaceRegistry'

export type FoundryTerminalRecord = {
  id: string
  cwd: string
  output: string
  running: boolean
  startedAt: string
}

type LiveSession = FoundryTerminalRecord & {
  child: ChildProcessWithoutNullStreams
}

const sessions = new Map<string, LiveSession>()
const MAX_OUTPUT = 80_000

function projectsRoot(): string {
  const env = process.env.FOUNDRY_PROJECTS_ROOT?.trim()
  if (env) return path.resolve(env)
  return path.join(os.homedir(), 'FoundryProjects')
}

function authorizedTerminalRoots(): string[] {
  const extra = (process.env.WAR_ROOM_ENGINEER_ALLOWED_ROOTS ?? '')
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => path.resolve(item))
  return [...new Set([
    projectsRoot(),
    resolveRepoRoot(),
    getCanonicalWarRoomSourceRoot(),
    ...extra,
  ].map(root => path.resolve(root)))]
}

export function authorizeTerminalCwd(requested: string | null | undefined): { ok: true; cwd: string } | { ok: false; error: string } {
  const raw = (requested && requested.trim()) ? requested.trim() : getCanonicalWarRoomSourceRoot()
  const cwd = path.resolve(raw)
  if (!existsSync(cwd)) return { ok: false, error: `cwd does not exist: ${cwd}` }
  const allowed = authorizedTerminalRoots()
  if (!allowed.some(root => isPathInsideRoot(cwd, root))) {
    return { ok: false, error: 'REFUSED_TERMINAL_CWD: path is outside authorized project roots.' }
  }
  return { ok: true, cwd }
}

function spawnShell(cwd: string): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', [], { cwd, env: process.env, windowsHide: true })
  }
  if (existsSync('/usr/bin/script')) {
    return spawn('/usr/bin/script', ['-qefc', 'bash --noprofile --norc', '/dev/null'], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', PS1: '\\u@foundry:\\w\\$ ' },
    })
  }
  return spawn('bash', ['--noprofile', '--norc'], {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', PS1: '\\u@foundry:\\w\\$ ' },
  })
}

function append(session: LiveSession, chunk: string): void {
  session.output = `${session.output}${chunk}`.slice(-MAX_OUTPUT)
}

export function startFoundryTerminal(cwd: string): FoundryTerminalRecord {
  const id = randomUUID()
  const child = spawnShell(cwd)
  const session: LiveSession = {
    id,
    cwd,
    output: '',
    running: true,
    startedAt: new Date().toISOString(),
    child,
  }
  child.stdout?.on('data', (buf: Buffer) => append(session, buf.toString('utf8')))
  child.stderr?.on('data', (buf: Buffer) => append(session, buf.toString('utf8')))
  child.on('close', () => {
    session.running = false
  })
  sessions.set(id, session)
  return snapshot(session)
}

export function writeFoundryTerminal(id: string, data: string): FoundryTerminalRecord | null {
  const session = sessions.get(id)
  if (!session || !session.running) return session ? snapshot(session) : null
  if (/\brm\s+(-rf|--recursive)|remove-item\s+.*-recurse|format\s+|del\s+\/s/i.test(data)) {
    append(session, '\nDENIED: destructive recursive deletion is not permitted.\n')
    return snapshot(session)
  }
  session.child.stdin.write(data)
  return snapshot(session)
}

export function readFoundryTerminal(id: string): FoundryTerminalRecord | null {
  const session = sessions.get(id)
  return session ? snapshot(session) : null
}

export function listFoundryTerminals(): FoundryTerminalRecord[] {
  return [...sessions.values()].map(snapshot)
}

export function closeAllFoundryTerminals(): number {
  const ids = [...sessions.keys()]
  for (const id of ids) closeFoundryTerminal(id)
  return ids.length
}

export function closeFoundryTerminal(id: string): FoundryTerminalRecord | null {
  const session = sessions.get(id)
  if (!session) return null
  try { session.child.kill() } catch { /* already gone */ }
  session.running = false
  const out = snapshot(session)
  sessions.delete(id)
  return out
}

function snapshot(session: LiveSession): FoundryTerminalRecord {
  return {
    id: session.id,
    cwd: session.cwd,
    output: session.output,
    running: session.running,
    startedAt: session.startedAt,
  }
}
