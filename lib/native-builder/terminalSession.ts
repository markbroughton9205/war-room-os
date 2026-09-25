/**
 * Persistent, interactive terminal sessions for Foundry (terminal.open_session / session_send /
 * session_read / session_kill).
 *
 * Honest scope: this is a kept-open-stdin pipe session (spawn with stdio:'pipe', stdin never
 * closed until the caller sends input or closes the session), NOT a PTY. There is no node-pty
 * dependency in this repo and adding one is a native-module decision left for a follow-up pass.
 * This is sufficient for line-oriented REPLs and long-running CLIs that read stdin line by line;
 * it is NOT suitable for curses-style full-screen terminal programs (no TTY semantics, no resize).
 *
 * Reuses, rather than reimplements: classifyArgv/classifyCommandCwd (commandPolicy.ts) for the
 * same policy gate startOwnedProcess uses, processRegistry's killChildTree for the same
 * POSIX-process-group / Windows-taskkill tree kill, commandOutput.ts's bounded ring buffer (keyed
 * by sessionId) for output so the existing SSE stream route needs no changes, and
 * outputRedaction.ts so secrets never land in the buffer or the audit trail.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { classifyArgv, classifyCommandCwd } from './commandPolicy'
import { killChildTree, registerActiveProcess, unregisterActiveProcess } from './processRegistry'
import { appendCommandOutput, getCommandOutput, type CommandOutputEntry } from './commandOutput'
import { redactSecretsFromOutput } from './outputRedaction'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

const MAX_SESSIONS_PER_MISSION = 3

type Session = {
  sessionId: string
  repairId: string
  child: ChildProcess
  cmd: string
  args: string[]
  label: string
  closed: boolean
  exitCode: number | null
  startedAt: number
}

const sessions = new Map<string, Session>()

function countSessionsForRepair(repairId: string): number {
  let n = 0
  for (const s of sessions.values()) if (s.repairId === repairId && !s.closed) n += 1
  return n
}

export type OpenSessionResult = { ok: boolean; sessionId?: string; pid?: number; error?: string }

export async function openTerminalSession(input: {
  repairId: string
  cmd: string
  args: string[]
  label?: string
}): Promise<OpenSessionResult> {
  if (countSessionsForRepair(input.repairId) >= MAX_SESSIONS_PER_MISSION) {
    return { ok: false, error: `Too many open terminal sessions for this mission (max ${MAX_SESSIONS_PER_MISSION}). Close one first.` }
  }
  const policy = classifyArgv(input.cmd, input.args)
  if (policy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, error: policy.reason }
  }
  const cwd = resolveRepoRoot()
  const cwdPolicy = classifyCommandCwd(cwd, cwd)
  if (cwdPolicy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, error: cwdPolicy.reason }
  }
  const child = spawn(input.cmd, input.args, {
    cwd,
    windowsHide: true,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    stdio: 'pipe',
  })
  if (typeof child.pid !== 'number') {
    return { ok: false, error: 'Process did not start.' }
  }
  const sessionId = randomUUID()
  const label = input.label ?? `${input.cmd} ${input.args.join(' ')}`
  const session: Session = { sessionId, repairId: input.repairId, child, cmd: input.cmd, args: input.args, label, closed: false, exitCode: null, startedAt: Date.now() }
  sessions.set(sessionId, session)
  registerActiveProcess(input.repairId, child, label)

  child.stdout?.on('data', (chunk: Buffer) => {
    appendCommandOutput(input.repairId, sessionId, 'stdout', redactSecretsFromOutput(chunk.toString('utf8')))
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    appendCommandOutput(input.repairId, sessionId, 'stderr', redactSecretsFromOutput(chunk.toString('utf8')))
  })
  child.on('exit', code => {
    session.closed = true
    session.exitCode = code
    unregisterActiveProcess(input.repairId, child)
    appendCommandOutput(input.repairId, sessionId, 'system', `[session exited with code ${code ?? 'null'}]`)
  })

  await logWarRoomRepoAudit('engineer: terminal.open_session', { repairId: input.repairId, sessionId, cmd: input.cmd, args: input.args, pid: child.pid })
  return { ok: true, sessionId, pid: child.pid }
}

export function sendTerminalSessionInput(sessionId: string, text: string): { ok: boolean; error?: string } {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'Unknown terminal session.' }
  if (session.closed) return { ok: false, error: 'Session already closed.' }
  if (!session.child.stdin || session.child.stdin.destroyed) {
    return { ok: false, error: 'Session stdin is not writable.' }
  }
  session.child.stdin.write(text.endsWith('\n') ? text : `${text}\n`)
  appendCommandOutput(session.repairId, sessionId, 'system', `[sent] ${redactSecretsFromOutput(text)}`)
  return { ok: true }
}

export type ReadSessionResult = {
  ok: boolean
  entries: CommandOutputEntry[]
  closed: boolean
  exitCode: number | null
  error?: string
}

export function readTerminalSession(sessionId: string, afterSequence = 0): ReadSessionResult {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, entries: [], closed: true, exitCode: null, error: 'Unknown terminal session.' }
  return {
    ok: true,
    entries: getCommandOutput(session.repairId, afterSequence).filter(e => e.operationId === sessionId),
    closed: session.closed,
    exitCode: session.exitCode,
  }
}

export async function closeTerminalSession(sessionId: string): Promise<{ ok: boolean; killed: boolean }> {
  const session = sessions.get(sessionId)
  if (!session) return { ok: true, killed: false }
  if (!session.closed) {
    await killChildTree(session.child)
    session.closed = true
  }
  await logWarRoomRepoAudit('engineer: terminal.session_kill', { repairId: session.repairId, sessionId })
  return { ok: true, killed: true }
}

export function listTerminalSessions(repairId: string) {
  return [...sessions.values()]
    .filter(s => s.repairId === repairId)
    .map(s => ({ sessionId: s.sessionId, label: s.label, closed: s.closed, exitCode: s.exitCode, startedAt: s.startedAt }))
}
