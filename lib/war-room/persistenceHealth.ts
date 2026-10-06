/**
 * Persistence health for the installed runtime.
 * Session rows use the existing local-ownership SQLite store.
 * Missions, checkpoints, approvals, and memory refs stay on Engine-04.
 * Supabase remains the remote backend when that client is configured.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { engine04StoreRoot } from '@/lib/council/engines/long-horizon/store'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const PERSISTENCE_HEALTH_STATUSES = ['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'READ_ONLY', 'MISCONFIGURED'] as const
export type PersistenceHealthStatus = (typeof PERSISTENCE_HEALTH_STATUSES)[number]

export type PersistenceHealth = {
  status: PersistenceHealthStatus
  backend: 'local_ownership' | 'supabase' | 'none'
  store_path: string
  readable: boolean
  writable: boolean
  session_persistence: boolean
  mission_persistence: boolean
  checkpoint_persistence: boolean
  approval_persistence: boolean
  memory_ref_persistence: boolean
  last_write_at: string | null
  last_readback_at: string | null
  failure_reason: string | null
  degraded_reason: string | null
}

export type PersistenceHealthInput = {
  dataDir?: string | null
  engine04Root?: string | null
  force?: string | null
}

const STORE_CLASS = 'local-app-data/local-ownership.sqlite'
const ENGINE04_CLASS = 'local-app-data/council/engine-04'

function forced(input?: PersistenceHealthInput): string | null {
  const raw = input?.force ?? process.env.WAR_ROOM_PERSISTENCE_FORCE ?? null
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return value || null
}

async function probeEngine04(root: string): Promise<{
  readable: boolean
  writable: boolean
  last_write_at: string | null
  last_readback_at: string | null
  reason: string | null
}> {
  const file = path.join(root, '.persistence-probe.json')
  const payload = { nonce: `probe-${Date.now()}`, written_at: new Date().toISOString() }
  try {
    await mkdir(root, { recursive: true })
    await mkdir(path.join(root, 'missions'), { recursive: true })
    await mkdir(path.join(root, 'checkpoints'), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(payload))
    await rename(tmp, file)
    const readback = JSON.parse(await readFile(file, 'utf8')) as { nonce?: string }
    if (readback.nonce !== payload.nonce) {
      return { readable: false, writable: true, last_write_at: payload.written_at, last_readback_at: null, reason: 'engine-04 probe readback mismatch' }
    }
    const readbackAt = new Date().toISOString()
    return { readable: true, writable: true, last_write_at: payload.written_at, last_readback_at: readbackAt, reason: null }
  } catch (error) {
    const readable = existsSync(root)
    return {
      readable,
      writable: false,
      last_write_at: null,
      last_readback_at: null,
      reason: error instanceof Error ? error.message : 'engine-04 probe failed',
    }
  }
}

const healthCache = new Map<string, { at: number; health: PersistenceHealth }>()
const healthInflight = new Map<string, Promise<PersistenceHealth>>()

export async function collectPersistenceHealth(input: PersistenceHealthInput = {}): Promise<PersistenceHealth> {
  const force = forced(input)
  const cacheKey = `${input.dataDir ?? ''}|${input.engine04Root ?? ''}|${force ?? ''}`
  const cached = healthCache.get(cacheKey)
  if (!force && cached && Date.now() - cached.at < 10_000) return cached.health
  if (!force) {
    const pending = healthInflight.get(cacheKey)
    if (pending) return pending
  }
  const pending = probePersistenceHealth(input, force).then(health => {
    if (!force && health.status === 'HEALTHY') healthCache.set(cacheKey, { at: Date.now(), health })
    return health
  }).finally(() => {
    healthInflight.delete(cacheKey)
  })
  if (!force) healthInflight.set(cacheKey, pending)
  return pending
}

async function probePersistenceHealth(input: PersistenceHealthInput, force: string | null): Promise<PersistenceHealth> {
  if (force === 'unavailable' || force === 'failed') {
    return {
      status: 'UNAVAILABLE',
      backend: 'none',
      store_path: STORE_CLASS,
      readable: false,
      writable: false,
      session_persistence: false,
      mission_persistence: false,
      checkpoint_persistence: false,
      approval_persistence: false,
      memory_ref_persistence: false,
      last_write_at: null,
      last_readback_at: null,
      failure_reason: 'controlled persistence failure',
      degraded_reason: 'session-only fallback',
    }
  }
  if (force === 'readonly' || force === 'read_only') {
    return {
      status: 'READ_ONLY',
      backend: 'local_ownership',
      store_path: STORE_CLASS,
      readable: true,
      writable: false,
      session_persistence: false,
      mission_persistence: false,
      checkpoint_persistence: false,
      approval_persistence: false,
      memory_ref_persistence: false,
      last_write_at: null,
      last_readback_at: null,
      failure_reason: 'controlled read-only persistence',
      degraded_reason: 'store is readable and not writable',
    }
  }

  const supabase = tryWarRoomSupabase()
  let session: { readable: boolean; writable: boolean; last_write_at: string | null; last_readback_at: string | null; reason: string | null } = {
    readable: false,
    writable: false,
    last_write_at: null,
    last_readback_at: null,
    reason: 'local ownership store did not open',
  }
  try {
    const store = getLocalOwnershipStore(input.dataDir ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    session = store.probePersistence()
  } catch (error) {
    session.reason = error instanceof Error ? error.message : 'local ownership store failed'
  }

  const engineRoot = input.engine04Root || process.env.WAR_ROOM_ENGINE04_STORE || engine04StoreRoot()
  const mission = await probeEngine04(engineRoot)
  const sessionOk = session.readable && session.writable
  const missionOk = mission.readable && mission.writable
  const backend: PersistenceHealth['backend'] = sessionOk
    ? 'local_ownership'
    : supabase.ok
      ? 'supabase'
      : 'none'

  if (!session.readable && !session.writable && !mission.readable) {
    return {
      status: 'UNAVAILABLE',
      backend,
      store_path: STORE_CLASS,
      readable: false,
      writable: false,
      session_persistence: false,
      mission_persistence: false,
      checkpoint_persistence: false,
      approval_persistence: false,
      memory_ref_persistence: false,
      last_write_at: session.last_write_at ?? mission.last_write_at,
      last_readback_at: session.last_readback_at ?? mission.last_readback_at,
      failure_reason: session.reason || mission.reason,
      degraded_reason: null,
    }
  }

  if (session.readable && !session.writable) {
    return {
      status: 'READ_ONLY',
      backend: 'local_ownership',
      store_path: STORE_CLASS,
      readable: true,
      writable: false,
      session_persistence: false,
      mission_persistence: missionOk,
      checkpoint_persistence: missionOk,
      approval_persistence: missionOk,
      memory_ref_persistence: missionOk,
      last_write_at: session.last_write_at,
      last_readback_at: session.last_readback_at,
      failure_reason: session.reason,
      degraded_reason: 'session store is read-only',
    }
  }

  const healthy = sessionOk && missionOk
  const degradedReason = healthy
    ? null
    : !sessionOk
      ? session.reason || 'session persistence is not writable'
      : mission.reason || 'engine-04 persistence is not writable'
  return {
    status: healthy ? 'HEALTHY' : 'DEGRADED',
    backend,
    store_path: healthy ? `${STORE_CLASS}+${ENGINE04_CLASS}` : STORE_CLASS,
    readable: session.readable || mission.readable,
    writable: session.writable && mission.writable,
    session_persistence: sessionOk,
    mission_persistence: missionOk,
    checkpoint_persistence: missionOk,
    approval_persistence: missionOk,
    memory_ref_persistence: missionOk,
    last_write_at: session.last_write_at ?? mission.last_write_at,
    last_readback_at: session.last_readback_at ?? mission.last_readback_at,
    failure_reason: healthy ? null : degradedReason,
    degraded_reason: healthy ? null : degradedReason,
  }
}

export function persistenceAllowsDurableCouncil(health: PersistenceHealth): boolean {
  return health.status === 'HEALTHY' && health.session_persistence && health.writable && health.readable
}
