/**
 * Process generation identity. A pid alone is not identity: pids are reused. Identity is
 * (pid, kernel start ticks, boot id), read from /proc, so a recycled pid never matches a stale record.
 */
import { readFileSync } from 'node:fs'

export type ProcessIdentity = { pid: number; startTicks: string; bootId: string }

function bootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  } catch {
    return 'unknown-boot'
  }
}

/** Field 22 of /proc/<pid>/stat is the start time in clock ticks since boot. comm may contain spaces/parens, so split after the last ')'. */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isInteger(pid) || pid <= 1) return null
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const startTicks = rest[19]
    if (!startTicks) return null
    // State 'Z' (zombie) is dead for our purposes.
    if (rest[0] === 'Z') return null
    return { pid, startTicks, bootId: bootId() }
  } catch {
    return null
  }
}

export function identityIsLive(identity: ProcessIdentity): boolean {
  const current = readProcessIdentity(identity.pid)
  return current !== null && current.startTicks === identity.startTicks && current.bootId === identity.bootId
}
