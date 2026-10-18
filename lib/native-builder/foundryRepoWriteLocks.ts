/** One atomic registry transaction covers overlap checks and every ownership mutation. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { randomUUID } from 'node:crypto'
import type { FoundryResourceClaim } from './foundryOperationsTypes'
import { repoWriteScope, repoWriteScopesOverlap, validRepoWriteScope } from './foundryRepoWriteScope'
import type { ResourceAcquireResult } from './foundryResourceLocks'

type Registry = { version: 1; claims: FoundryResourceClaim[] }
function validClaim(value: unknown): value is FoundryResourceClaim {
  if (!value || typeof value !== 'object') return false
  const c = value as FoundryResourceClaim
  return c.resource === 'REPO_WRITE' && typeof c.missionId === 'string' && !!c.missionId
    && typeof c.callId === 'string' && !!c.callId && Number.isInteger(c.pid) && c.pid > 0
    && typeof c.acquiredAt === 'string' && Number.isFinite(Date.parse(c.acquiredAt))
    && (c.repoWriteScope === undefined || validRepoWriteScope(c.repoWriteScope))
}
async function readRegistry(file: string): Promise<Registry> {
  let raw: string
  try { raw = await readFile(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, claims: [] }
    throw error
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('REPO_WRITE_REGISTRY_INVALID: unreadable claim; exclusion retained') }
  if (validClaim(parsed)) return { version: 1, claims: [parsed] } // legacy unscoped claim is never silently discarded
  const registry = parsed as Registry | null
  if (!registry || registry.version !== 1 || !Array.isArray(registry.claims) || !registry.claims.every(validClaim)) {
    throw new Error('REPO_WRITE_REGISTRY_INVALID: malformed claim; exclusion retained')
  }
  return registry
}
async function transaction<T>(file: string, action: (registry: Registry) => Promise<T>, write = false): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true })
  const guard = `${file}.guard`
  const deadline = Date.now() + 5_000
  for (;;) {
    try { await mkdir(guard); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error('REPO_WRITE_REGISTRY_BUSY: transaction guard held or orphaned; no automatic removal')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try {
    const registry = await readRegistry(file)
    const result = await action(registry)
    if (write) {
      const staged = `${file}.new-${process.pid}-${randomUUID()}`
      try {
        await writeFile(staged, JSON.stringify(registry, null, 2), 'utf8')
        await rename(staged, file)
      } finally { await rm(staged, { force: true }) }
    }
    return result
  } finally { await rm(guard, { recursive: true }) }
}
export async function listRepoWriteClaims(file: string): Promise<FoundryResourceClaim[]> {
  return transaction(file, async registry => registry.claims)
}
export async function mutateRepoWriteClaims(file: string, missionId: string | undefined, callId: string | undefined,
  action: 'heartbeat' | 'release' | 'reclaim', stale: (claim: FoundryResourceClaim) => boolean): Promise<FoundryResourceClaim[]> {
  return transaction(file, async registry => {
    const selected = registry.claims.filter(c => (missionId === undefined || c.missionId === missionId)
      && (callId === undefined || c.callId === callId) && (action !== 'reclaim' || (!!c.repoWriteScope && stale(c))))
    if (action === 'heartbeat') for (const c of selected) c.heartbeatAt = new Date().toISOString()
    else registry.claims = registry.claims.filter(c => !selected.includes(c))
    return selected
  }, true).then(async selected => {
    if (action !== 'heartbeat') for (const claim of selected) await logWarRoomRepoAudit(`foundry-ops: resource.${action === 'release' ? 'released' : 'stale_reclaimed'}`, { ...claim })
    return selected
  })
}
export async function acquireRepoWrite(file: string, input: { missionId: string; operation: string; paths?: string[]; workspaceRoot?: string; waitMs?: number },
  stale: (claim: FoundryResourceClaim) => boolean): Promise<ResourceAcquireResult> {
  // Validate on every acquisition, including resumed missions. Never derive scope from a legacy persisted claim.
  let scope
  try { scope = await repoWriteScope(input.workspaceRoot, input.paths) } catch (error) {
    return { state: 'DEADLOCK_REFUSED', error: String(error) }
  }
  const deadline = Date.now() + (input.waitMs ?? 0)
  let waited = false
  for (;;) {
    const result = await transaction(file, async registry => {
      // Unscoped legacy claims remain conservative, even when their owner appears stale.
      // callId is the ownership-generation token. Transfer only a dead/stale scoped owner; never reuse its token.
      const retiredOwn = registry.claims.find(c => c.missionId === input.missionId && c.repoWriteScope?.workspaceRoot === scope.workspaceRoot && stale(c))
      registry.claims = registry.claims.filter(c => !c.repoWriteScope || !stale(c))
      if (registry.claims.some(c => c.missionId === input.missionId && c.repoWriteScope && c.repoWriteScope.workspaceRoot !== scope.workspaceRoot)) {
        return { state: 'DEADLOCK_REFUSED' as const, error: 'REPO_WRITE_SCOPE_CHANGED: release prior scope before rebinding' }
      }
      const holder = registry.claims.find(c => repoWriteScopesOverlap(scope, c.repoWriteScope)
        && (c.missionId !== input.missionId || c.pid !== process.pid || !c.repoWriteScope || c.repoWriteScope.workspaceRoot !== scope.workspaceRoot))
      if (holder) return { state: 'BUSY' as const, holder }
      const own = registry.claims.find(c => c.missionId === input.missionId && c.repoWriteScope?.workspaceRoot === scope.workspaceRoot)
      const at = new Date().toISOString()
      const claim: FoundryResourceClaim = own ?? { resource: 'REPO_WRITE', missionId: input.missionId, callId: randomUUID(), pid: process.pid,
        acquiredAt: at, heartbeatAt: at, exclusive: true, operation: input.operation }
      claim.heartbeatAt = at
      claim.paths = [...new Set([...(claim.paths ?? []), ...(input.paths ?? [])])]
      claim.repoWriteScope = { ...scope, targets: [...new Set([...(own?.repoWriteScope?.targets ?? []), ...scope.targets])], fileIds: [...new Set([...(own?.repoWriteScope?.fileIds ?? []), ...scope.fileIds])] }
      if (!own) registry.claims.push(claim)
      return { state: 'ACQUIRED' as const, claim, transferredFrom: retiredOwn, release: async () => { await mutateRepoWriteClaims(file, input.missionId, claim.callId, 'release', stale) } }
    }, true)
    if (result.state === 'DEADLOCK_REFUSED') return result
    if (result.state === 'ACQUIRED') {
      await logWarRoomRepoAudit('foundry-ops: resource.acquired', { ...result.claim })
      if (result.transferredFrom) await logWarRoomRepoAudit('foundry-ops: resource.owner-generation-transferred', {
        missionId: input.missionId, previousPid: result.transferredFrom.pid, previousCallId: result.transferredFrom.callId,
        pid: result.claim.pid, callId: result.claim.callId,
      })
      return { state: result.state, claim: result.claim, release: result.release }
    }
    if (Date.now() >= deadline) return waited ? { state: 'TIMEOUT', holder: result.holder } : result
    waited = true
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
