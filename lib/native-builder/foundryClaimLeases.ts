/**
 * Claim leases: the single arbiter for scarce execution resources held by a running Foundry process (the GPU, a specific local model,
 * a browser session...). A lease is a FIFO ticket on disk. It is HELD only when no live HELD lease and no earlier waiting ticket
 * conflicts with it, so queued work wakes by itself, in order, the moment the holder releases or dies.
 *
 * PROVIDER_SLOT remains the physical single-flight lock for every provider; local-model turns take the lease first and the slot second
 * (acquireModelTurn), so the two can never disagree: the lease decides who is next, the slot just records the call in flight.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs'
import path from 'node:path'
import { identityIsLive, readProcessIdentity, type ProcessIdentity } from './foundryProcessIdentity'
import { findClaimConflicts, normalizeClaims, type ClaimHolder } from './foundryResourceClaims'

export type ClaimLease = {
  leaseId: string
  missionId: string
  purpose: string
  claims: string[]
  pid: number
  identity: ProcessIdentity | null
  createdAt: string
  /** Strictly increasing ticket (ms timestamp + counter) giving FIFO order across processes. */
  ticket: number
  state: 'WAITING' | 'HELD'
  heldAt?: string
}

const MAX_HOLD_MS = 30 * 60 * 1000
let counter = 0

function dir(root: string): string { return path.join(root, 'leases') }
function file(root: string, leaseId: string): string { return path.join(dir(root), `${leaseId}.json`) }

function write(root: string, lease: ClaimLease): void {
  mkdirSync(dir(root), { recursive: true })
  const tmp = `${file(root, lease.leaseId)}.${process.pid}.${randomUUID().slice(0, 6)}.tmp`
  writeFileSync(tmp, JSON.stringify(lease))
  renameSync(tmp, file(root, lease.leaseId))
}

function alive(lease: ClaimLease): boolean {
  if (lease.identity && !identityIsLive(lease.identity)) return false
  if (lease.state === 'HELD' && lease.heldAt && Date.now() - Date.parse(lease.heldAt) > MAX_HOLD_MS) return false
  return true
}

/** Live leases, oldest ticket first. Leases whose holder process is gone are deleted here: stale ownership never accumulates. */
export function listLeases(root: string): ClaimLease[] {
  let names: string[]
  try { names = readdirSync(dir(root)) } catch { return [] }
  const leases: ClaimLease[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const lease = JSON.parse(readFileSync(path.join(dir(root), name), 'utf8')) as ClaimLease
      if (alive(lease)) leases.push(lease)
      else rmSync(path.join(dir(root), name), { force: true })
    } catch { /* being written */ }
  }
  return leases.sort((a, b) => a.ticket - b.ticket)
}

export function heldLeaseHolders(root: string): ClaimHolder[] {
  return listLeases(root).filter(lease => lease.state === 'HELD').map(lease => ({ holderId: `lease:${lease.leaseId}`, claims: lease.claims }))
}

export type LeaseHandle = { leaseId: string; waitedMs: number; release: () => void }

export async function acquireLease(input: {
  root: string
  missionId: string
  purpose: string
  claims: readonly string[]
  /** Other live holders (running jobs) that must also not conflict. */
  externalHeld?: () => ClaimHolder[]
  isCancelled?: () => boolean
  onQueued?: (ahead: ClaimLease[]) => void
}): Promise<LeaseHandle | null> {
  const claims = normalizeClaims(input.claims)
  const lease: ClaimLease = {
    leaseId: randomUUID(), missionId: input.missionId, purpose: input.purpose, claims, pid: process.pid, identity: readProcessIdentity(process.pid),
    createdAt: new Date().toISOString(), ticket: Date.now() * 1000 + (counter++ % 1000), state: 'WAITING',
  }
  write(input.root, lease)
  const started = Date.now()
  let announced = false
  const release = () => rmSync(file(input.root, lease.leaseId), { force: true })
  for (;;) {
    if (input.isCancelled?.()) { release(); return null }
    const live = listLeases(input.root)
    const mine = live.find(item => item.leaseId === lease.leaseId)
    if (!mine) { write(input.root, lease); continue }
    const blockers: ClaimHolder[] = [
      ...live.filter(item => item.leaseId !== lease.leaseId && (item.state === 'HELD' || item.ticket < lease.ticket)).map(item => ({ holderId: `lease:${item.leaseId}`, claims: item.claims })),
      ...(input.externalHeld?.() ?? []),
    ]
    if (!findClaimConflicts(claims, blockers).length) {
      write(input.root, { ...lease, state: 'HELD', heldAt: new Date().toISOString() })
      // Re-check: a conflicting earlier ticket could have appeared between list and write. Ticket order resolves the tie.
      const recheck = listLeases(input.root).filter(item => item.leaseId !== lease.leaseId && item.state === 'HELD' && findClaimConflicts(claims, [{ holderId: item.leaseId, claims: item.claims }]).length)
      if (!recheck.length) return { leaseId: lease.leaseId, waitedMs: Date.now() - started, release }
      write(input.root, lease)
    }
    if (!announced) { announced = true; input.onQueued?.(live.filter(item => item.leaseId !== lease.leaseId)) }
    await new Promise<void>(resolve => {
      let done = false
      let watcher: ReturnType<typeof watch> | null = null
      const finish = () => { if (done) return; done = true; clearTimeout(timer); watcher?.close(); resolve() }
      const timer = setTimeout(finish, 1500)
      try { mkdirSync(dir(input.root), { recursive: true }); watcher = watch(dir(input.root), finish) } catch { /* timer covers it */ }
    })
  }
}
