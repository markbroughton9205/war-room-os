/**
 * Active child-process registry + cross-platform process-tree kill for the Native Code Operator.
 *
 * Why this exists: validationRunner.ts historically used promisified execFile — there was no
 * handle on the child after launch, so a running `pnpm run build` or validation script could not
 * be cancelled at all. This registry is the single place that knows which OS processes belong to
 * which repair, and how to kill the WHOLE tree (pnpm spawns node spawns tsc — killing only the
 * direct child orphans the grandchildren).
 *
 * Cross-platform strategy:
 *   - POSIX: children are spawned detached:true, making the child a process-GROUP leader; killing
 *     -pid (negative pid) signals the whole group.
 *   - Windows: there are no process groups; `taskkill /pid <pid> /T /F` kills the tree rooted at
 *     the child. Args stay an array — same no-shell-string discipline as validationRunner.
 *
 * Cancellation marker: markRepairCancelled() is checked by validationRunner between sequential
 * operations so a cancelled repair's REMAINING operations never even start — killing the active
 * process alone would let the next op in the list launch a fresh one.
 */
import { spawn, type ChildProcess } from 'node:child_process'

type TrackedChild = { child: ChildProcess; label: string; startedAt: number }

const activeByRepair = new Map<string, Set<TrackedChild>>()
const cancelledRepairs = new Set<string>()

export function registerActiveProcess(repairId: string, child: ChildProcess, label: string): void {
  const set = activeByRepair.get(repairId) ?? new Set<TrackedChild>()
  set.add({ child, label, startedAt: Date.now() })
  activeByRepair.set(repairId, set)
}

export function unregisterActiveProcess(repairId: string, child: ChildProcess): void {
  const set = activeByRepair.get(repairId)
  if (!set) return
  for (const tracked of set) {
    if (tracked.child === child) set.delete(tracked)
  }
  if (set.size === 0) activeByRepair.delete(repairId)
}

export function hasActiveProcesses(repairId: string): boolean {
  return (activeByRepair.get(repairId)?.size ?? 0) > 0
}

export function markRepairCancelled(repairId: string): void {
  cancelledRepairs.add(repairId)
}

export function isRepairCancellationRequested(repairId: string): boolean {
  return cancelledRepairs.has(repairId)
}

/** Clears the cancellation marker — called when a repair reaches any terminal state, so the flag
 * never leaks into a future repair that happens to reuse... nothing (ids are uuids), but an
 * ever-growing Set of dead ids is still a leak. */
export function clearRepairCancellation(repairId: string): void {
  cancelledRepairs.delete(repairId)
}

function killTreePosix(child: ChildProcess): void {
  if (typeof child.pid !== 'number') return
  try {
    // Negative pid => signal the entire process GROUP (child was spawned detached, so it leads one).
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already exited */
    }
  }
}

async function killTreeWindows(child: ChildProcess): Promise<void> {
  if (typeof child.pid !== 'number') return
  await new Promise<void>(resolve => {
    // taskkill is the only honest tree-kill on Windows. Array args, no shell string.
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    killer.on('exit', () => resolve())
    killer.on('error', () => resolve())
  })
}

export type KillResult = { killed: number; label: string }

/** Kills every tracked process (and its tree) for this repair. Idempotent; returns what it did so
 * the caller can put a truthful note in the audit trail. */
export async function killProcessesForRepair(repairId: string): Promise<KillResult[]> {
  const set = activeByRepair.get(repairId)
  if (!set?.size) return []
  const results: KillResult[] = []
  for (const tracked of [...set]) {
    if (process.platform === 'win32') {
      await killTreeWindows(tracked.child)
    } else {
      killTreePosix(tracked.child)
    }
    results.push({ killed: tracked.child.pid ?? -1, label: tracked.label })
    set.delete(tracked)
  }
  if (set.size === 0) activeByRepair.delete(repairId)
  return results
}
