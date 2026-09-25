/**
 * Governed Commander terminal. Reuses commandPolicy, processRegistry, and output redaction.
 * This is a real session with real spawn stdin/stdout/stderr — not a PTY and not canned output.
 * Raw shells (bash/sh/cmd) stay denied. Destructive commands stay denied.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyArgv, classifyCommandCwd } from './commandPolicy'
import { killChildTree, registerActiveProcess, unregisterActiveProcess } from './processRegistry'
import { redactSecretsFromOutput } from './outputRedaction'
import { isOwnedProjectCwd } from './foundryProjectProcessRegistry'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

const MAX_OUTPUT_CHARS = 200_000
const COMMAND_TIMEOUT_MS = 30_000
const COMMANDER_READ_ONLY = new Set([
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'echo',
  'which',
  'where',
  'whoami',
  'date',
  'uname',
  'hostname',
  'stat',
  'file',
  'wc',
  'pwd',
])

export type CommanderTerminalLine = {
  kind: 'system' | 'stdin' | 'stdout' | 'stderr' | 'denied'
  text: string
  at: string
}

type CommanderTerminalSession = {
  sessionId: string
  cwd: string
  authorizedRoot: string
  projectId?: string
  lines: CommanderTerminalLine[]
  child: ChildProcess | null
  closed: boolean
  startedAt: number
}

const sessions = new Map<string, CommanderTerminalSession>()

function nowIso(): string {
  return new Date().toISOString()
}

function pushLine(session: CommanderTerminalSession, kind: CommanderTerminalLine['kind'], text: string): void {
  session.lines.push({ kind, text: redactSecretsFromOutput(text), at: nowIso() })
  let total = 0
  for (let i = session.lines.length - 1; i >= 0; i -= 1) {
    total += session.lines[i].text.length
    if (total > MAX_OUTPUT_CHARS) {
      session.lines = session.lines.slice(i + 1)
      break
    }
  }
}

export function tokenizeCommanderLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export function classifyCommanderTerminalArgv(cmd: string, args: readonly string[]): { ok: boolean; reason: string } {
  const base = cmd.replace(/\.cmd$/i, '').split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (base === 'bash' || base === 'sh' || base === 'zsh' || base === 'cmd' || base === 'powershell' || base === 'pwsh') {
    return { ok: false, reason: 'Raw shell interpreters are not permitted. Type a governed command such as pwd or node --version.' }
  }
  const policy = classifyArgv(cmd, args)
  if (policy.policyClass === 'SAFE_LOCAL') return { ok: true, reason: policy.reason }
  if (policy.policyClass === 'DENIED' && COMMANDER_READ_ONLY.has(base)) {
    return { ok: true, reason: 'Commander read-only inspection command.' }
  }
  return { ok: false, reason: policy.reason }
}

function resolveAuthorizedRoot(input?: { projectRoot?: string }): string {
  if (input?.projectRoot && isOwnedProjectCwd(input.projectRoot)) return path.resolve(input.projectRoot)
  return resolveRepoRoot()
}

export type OpenCommanderTerminalResult = {
  ok: boolean
  sessionId?: string
  cwd?: string
  error?: string
}

export async function openCommanderTerminal(input?: {
  projectRoot?: string
  projectId?: string
}): Promise<OpenCommanderTerminalResult> {
  const authorizedRoot = resolveAuthorizedRoot(input)
  const cwdPolicy = classifyCommandCwd(authorizedRoot, authorizedRoot)
  if (cwdPolicy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, error: cwdPolicy.reason }
  }
  const sessionId = randomUUID()
  const session: CommanderTerminalSession = {
    sessionId,
    cwd: authorizedRoot,
    authorizedRoot,
    projectId: input?.projectId,
    lines: [],
    child: null,
    closed: false,
    startedAt: Date.now(),
  }
  pushLine(session, 'system', `War Room terminal ready. cwd=${authorizedRoot}`)
  sessions.set(sessionId, session)
  await logWarRoomRepoAudit('commander: terminal.open', { sessionId, cwd: authorizedRoot, projectId: input?.projectId ?? null })
  return { ok: true, sessionId, cwd: authorizedRoot }
}

export function snapshotCommanderTerminal(sessionId: string): {
  ok: boolean
  sessionId?: string
  cwd?: string
  closed?: boolean
  running?: boolean
  lines?: CommanderTerminalLine[]
  error?: string
} {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'Unknown terminal session.' }
  return {
    ok: true,
    sessionId: session.sessionId,
    cwd: session.cwd,
    closed: session.closed,
    running: Boolean(session.child && !session.closed),
    lines: session.lines.slice(-400),
  }
}

async function runSpawnedCommand(session: CommanderTerminalSession, cmd: string, args: string[]): Promise<void> {
  const cwdPolicy = classifyCommandCwd(session.cwd, session.authorizedRoot)
  if (cwdPolicy.policyClass !== 'SAFE_LOCAL') {
    pushLine(session, 'denied', cwdPolicy.reason)
    return
  }
  const classified = classifyCommanderTerminalArgv(cmd, args)
  if (!classified.ok) {
    pushLine(session, 'denied', classified.reason)
    return
  }
  const child = spawn(cmd, args, {
    cwd: session.cwd,
    windowsHide: true,
    shell: false,
    env: { ...process.env, TERM: 'dumb' },
    stdio: 'pipe',
  })
  if (typeof child.pid !== 'number') {
    pushLine(session, 'stderr', 'Process did not start.')
    return
  }
  session.child = child
  const repairId = `commander-terminal-${session.sessionId}`
  registerActiveProcess(repairId, child, `${cmd} ${args.join(' ')}`)
  child.stdout?.on('data', (chunk: Buffer) => {
    pushLine(session, 'stdout', chunk.toString('utf8'))
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    pushLine(session, 'stderr', chunk.toString('utf8'))
  })
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      void killChildTree(child)
      pushLine(session, 'system', `Command timed out after ${COMMAND_TIMEOUT_MS}ms.`)
    }, COMMAND_TIMEOUT_MS)
    child.on('exit', code => {
      clearTimeout(timer)
      unregisterActiveProcess(repairId, child)
      session.child = null
      pushLine(session, 'system', `exit ${code ?? 'null'}`)
      resolve()
    })
    child.on('error', err => {
      clearTimeout(timer)
      unregisterActiveProcess(repairId, child)
      session.child = null
      pushLine(session, 'stderr', err instanceof Error ? err.message : String(err))
      resolve()
    })
  })
}

export async function sendCommanderTerminal(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'Unknown terminal session.' }
  if (session.closed) return { ok: false, error: 'Session already closed.' }
  if (session.child) return { ok: false, error: 'A command is still running. Stop it first.' }
  const raw = text.replace(/\r$/, '')
  pushLine(session, 'stdin', raw)
  const tokens = tokenizeCommanderLine(raw)
  if (tokens.length === 0) return { ok: true }
  const [cmd, ...args] = tokens
  const base = cmd.toLowerCase()
  if (base === 'clear') {
    session.lines = [{ kind: 'system', text: `cwd=${session.cwd}`, at: nowIso() }]
    return { ok: true }
  }
  if (base === 'help') {
    pushLine(session, 'system', 'Governed War Room terminal. Builtins: pwd, cd, clear, help. Allowlisted toolchain commands such as node --version run for real. Raw shells and destructive commands are denied.')
    return { ok: true }
  }
  if (base === 'pwd') {
    pushLine(session, 'stdout', `${session.cwd}\n`)
    return { ok: true }
  }
  if (base === 'cd') {
    const target = args[0] ? (path.isAbsolute(args[0]) ? args[0] : path.resolve(session.cwd, args[0])) : session.authorizedRoot
    const cwdPolicy = classifyCommandCwd(target, session.authorizedRoot)
    if (cwdPolicy.policyClass !== 'SAFE_LOCAL') {
      pushLine(session, 'denied', cwdPolicy.reason)
      return { ok: true }
    }
    session.cwd = path.resolve(target)
    pushLine(session, 'stdout', `${session.cwd}\n`)
    return { ok: true }
  }
  await runSpawnedCommand(session, cmd, args)
  return { ok: true }
}

export async function stopCommanderTerminal(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'Unknown terminal session.' }
  if (session.child) {
    await killChildTree(session.child)
    session.child = null
    pushLine(session, 'system', 'Stopped.')
  }
  return { ok: true }
}

export function clearCommanderTerminal(sessionId: string): { ok: boolean; error?: string } {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'Unknown terminal session.' }
  session.lines = [{ kind: 'system', text: `cwd=${session.cwd}`, at: nowIso() }]
  return { ok: true }
}

export async function closeCommanderTerminal(sessionId: string): Promise<{ ok: boolean }> {
  const session = sessions.get(sessionId)
  if (!session) return { ok: true }
  if (session.child) await killChildTree(session.child)
  session.closed = true
  session.child = null
  sessions.delete(sessionId)
  await logWarRoomRepoAudit('commander: terminal.close', { sessionId })
  return { ok: true }
}
