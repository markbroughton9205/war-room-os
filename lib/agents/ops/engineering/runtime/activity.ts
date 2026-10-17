import type { ChildProcess } from 'node:child_process'

/**
 * What this server process is actually executing for engineering missions right now: child processes (tools, tests, builds, workspace servers) and in-flight model calls.
 * Emergency Stop uses this registry to terminate them for real; nothing here decides anything, it only remembers what is running.
 */
const KEY = Symbol.for('war-room.engineering.activity')
type Registry = { children: Map<number, { child: ChildProcess; label: string; startedAt: string }>; aborts: Set<AbortController>; stopped: boolean }
const reg = (): Registry => { const g = globalThis as unknown as Record<symbol, Registry | undefined>; return (g[KEY] ??= { children: new Map(), aborts: new Set(), stopped: false }) }

/** Remember a spawned process until it exits. A process started while a stop is in force is killed at once. */
export function trackChild(child: ChildProcess, label: string): void {
  const r = reg()
  if (child.pid === undefined) return
  const pid = child.pid
  r.children.set(pid, { child, label, startedAt: new Date().toISOString() })
  child.once('exit', () => { r.children.delete(pid) })
  child.once('error', () => { r.children.delete(pid) })
  if (r.stopped) killPid(pid)
}

export function trackAbort(ctrl: AbortController): () => void {
  const r = reg()
  r.aborts.add(ctrl)
  if (r.stopped) ctrl.abort()
  return () => { r.aborts.delete(ctrl) }
}

function killPid(pid: number): void {
  // the process group first (a sandbox wrapper and its children), then the process itself
  try { process.kill(-pid, 'SIGKILL') } catch { /* not a group leader */ }
  try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
}

export function activitySnapshot(): { children: { pid: number; label: string; startedAt: string }[]; modelCalls: number; stopped: boolean } {
  const r = reg()
  return { children: [...r.children.entries()].map(([pid, c]) => ({ pid, label: c.label, startedAt: c.startedAt })), modelCalls: r.aborts.size, stopped: r.stopped }
}

/** Terminates every tracked process and aborts every in-flight model call. While `hold` is true, anything started afterwards is terminated on arrival too. */
export function haltAllActivity(hold: boolean): { killed: number[]; aborted: number } {
  const r = reg()
  r.stopped = hold
  const killed: number[] = []
  for (const pid of [...r.children.keys()]) { killPid(pid); killed.push(pid) }
  let aborted = 0
  for (const c of [...r.aborts]) { try { c.abort(); aborted++ } catch { /* ignore */ } }
  return { killed, aborted }
}

export function releaseActivityHold(): void { reg().stopped = false }
export const activityHeld = (): boolean => reg().stopped
