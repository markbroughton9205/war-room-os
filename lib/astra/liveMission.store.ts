import { mkdir, open, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import {
  astraExecuteConflict,
  isAstraMissionStatus,
  markAstraMissionRunning,
  type AstraLiveMission,
  type AstraMissionAuditKind,
  type AstraPersistenceBackend,
} from './liveMission'

const TABLE = 'war_room_astra_missions'
const DEFAULT_RELATIVE_DIR = ['.war-room', 'astra-missions'] as const

export type AstraMissionClaimResult =
  | { ok: true; mission: AstraLiveMission }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'already_running' | 'already_completed' | 'already_failed'; mission: AstraLiveMission }

type StoreProbe = { supabase: boolean }

let tableAvailable: boolean | null = null
const inProcessLocks = new Map<string, Promise<void>>()

function storeDir(): string {
  const override = process.env.WAR_ROOM_ASTRA_MISSIONS_DIR?.trim()
  if (override) return path.isAbsolute(override) ? override : path.resolve(resolveBaseRepoRoot(), override)
  return path.join(resolveBaseRepoRoot(), ...DEFAULT_RELATIVE_DIR)
}

export function resetAstraMissionStoreProbe(): void {
  tableAvailable = null
}

function forceFilesystem(): boolean {
  return process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM === '1'
}

async function withMissionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = inProcessLocks.get(id) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => gate, () => gate)
  inProcessLocks.set(id, queued)
  await previous.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (inProcessLocks.get(id) === queued) inProcessLocks.delete(id)
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function withFileLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const dir = storeDir()
  await mkdir(dir, { recursive: true })
  const lockPath = path.join(dir, `${id}.lock`)
  const started = Date.now()
  while (true) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        return await fn()
      } finally {
        await handle.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      if (Date.now() - started > 8_000) throw new Error(`ASTRA mission lock timeout for ${id}`)
      await sleep(15)
    }
  }
}

function isMissingTableError(message: string): boolean {
  return /could not find the table|does not exist|schema cache|PGRST205|relation .* does not exist/i.test(message)
}

function isMissingColumnError(message: string): boolean {
  return /could not find the .*column|PGRST204|column .* does not exist/i.test(message)
}

async function probeSupabaseTable(client: WarRoomSupabase): Promise<boolean> {
  if (forceFilesystem()) return false
  if (tableAvailable !== null) return tableAvailable
  const { error } = await client.from(TABLE).select('id').limit(1)
  if (!error) {
    tableAvailable = true
    return true
  }
  tableAvailable = !isMissingTableError(error.message)
  return tableAvailable
}

function rowToMission(row: Record<string, unknown>): AstraLiveMission | null {
  const json = row.mission_json
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const mission = json as AstraLiveMission
  if (typeof mission.id !== 'string' || !isAstraMissionStatus(mission.status)) return null
  return {
    ...mission,
    constellationSpawned: false,
    astraProvidesSubstantiveAnswer: false,
    persistenceBackend: 'supabase',
  }
}

function missionToRow(mission: AstraLiveMission) {
  return {
    id: mission.id,
    commander_user_id: mission.commanderUserId,
    status: mission.status,
    objective: mission.objective,
    intent: mission.intent,
    created_at: mission.createdAt,
    updated_at: mission.updatedAt,
    planned_at: mission.plannedAt,
    started_at: mission.startedAt,
    completed_at: mission.completedAt,
    failed_at: mission.failedAt,
    terra_object_id: mission.terraSeed?.lineage.objectId ?? mission.observedVessel?.mmsi ?? null,
    terra_object_type: mission.terraSeed?.lineage.type ?? null,
    terra_mmsi: mission.observedVessel?.mmsi ?? null,
    terra_provider: mission.terraSeed?.lineage.provider ?? mission.observedVessel?.provider ?? null,
    terra_evidence_id: mission.terraSeed?.lineage.evidenceId ?? mission.observedVessel?.evidenceId ?? null,
    terra_latitude: mission.terraSeed?.lineage.latitude ?? mission.observedVessel?.latitude ?? null,
    terra_longitude: mission.terraSeed?.lineage.longitude ?? mission.observedVessel?.longitude ?? null,
    terra_observed_at: mission.terraSeed?.lineage.observedAt ?? mission.observedVessel?.observedAt ?? null,
    terra_freshness: mission.terraSeed?.lineage.freshness ?? mission.observedVessel?.freshness ?? null,
    council_conversation_id: mission.councilConversationId,
    constellation_spawned: false,
    astra_provides_substantive_answer: false,
    outcome_summary: mission.outcomeSummary,
    error: mission.error,
    mission_json: { ...mission, persistenceBackend: 'supabase', constellationSpawned: false, astraProvidesSubstantiveAnswer: false },
  }
}

function filePathFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(storeDir(), `${safe}.json`)
}

async function writeFilesystemMission(mission: AstraLiveMission): Promise<AstraLiveMission> {
  const stored: AstraLiveMission = {
    ...mission,
    constellationSpawned: false,
    astraProvidesSubstantiveAnswer: false,
    persistenceBackend: 'local_filesystem_fallback',
  }
  const dir = storeDir()
  await mkdir(dir, { recursive: true })
  const target = filePathFor(stored.id)
  await writeFile(target, JSON.stringify(stored, null, 2), 'utf8')
  return stored
}

async function readFilesystemMission(id: string): Promise<AstraLiveMission | null> {
  try {
    const raw = JSON.parse(await readFile(filePathFor(id), 'utf8')) as AstraLiveMission
    if (typeof raw?.id !== 'string' || !isAstraMissionStatus(raw.status)) return null
    return {
      ...raw,
      constellationSpawned: false,
      astraProvidesSubstantiveAnswer: false,
      persistenceBackend: 'local_filesystem_fallback',
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

async function listFilesystemMissions(commanderUserId: string): Promise<AstraLiveMission[]> {
  try {
    const names = (await readdir(storeDir())).filter(name => name.endsWith('.json'))
    const missions: AstraLiveMission[] = []
    for (const name of names) {
      try {
        const raw = JSON.parse(await readFile(path.join(storeDir(), name), 'utf8')) as AstraLiveMission
        if (raw?.commanderUserId === commanderUserId && isAstraMissionStatus(raw.status)) {
          missions.push({
            ...raw,
            constellationSpawned: false,
            astraProvidesSubstantiveAnswer: false,
            persistenceBackend: 'local_filesystem_fallback',
          })
        }
      } catch {
        /* skip corrupt files rather than inventing records */
      }
    }
    return missions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw error
  }
}

async function persistAudit(mission: AstraLiveMission, kind: AstraMissionAuditKind, detail: string): Promise<void> {
  try {
    const sup = tryWarRoomSupabase()
    await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
      actor: 'user',
      category: 'runtime',
      message: `${kind}: ${mission.id}`,
      metadata: {
        event: kind,
        missionId: mission.id,
        status: mission.status,
        detail,
        terraObjectId: mission.terraSeed?.lineage.objectId ?? null,
        terraProvider: mission.terraSeed?.lineage.provider ?? null,
        terraEvidenceId: mission.terraSeed?.lineage.evidenceId ?? null,
        councilConversationId: mission.councilConversationId,
        constellationSpawned: false,
        astraProvidesSubstantiveAnswer: false,
      },
    })
  } catch {
    /* audit is best-effort; durable mission record is authoritative */
  }
}

export async function saveAstraLiveMission(mission: AstraLiveMission): Promise<AstraLiveMission> {
  const latest = mission.audit.at(-1)
  const shouldAudit = Boolean(latest && latest.at === mission.updatedAt)
  const sup = tryWarRoomSupabase()
  if (sup.ok && await probeSupabaseTable(sup.client)) {
    const { error } = await sup.client.from(TABLE).upsert(missionToRow(mission), { onConflict: 'id' })
    if (!error) {
      const stored = { ...mission, persistenceBackend: 'supabase' as const, constellationSpawned: false as const, astraProvidesSubstantiveAnswer: false as const }
      if (shouldAudit && latest) await persistAudit(stored, latest.kind, latest.detail)
      return stored
    }
    if (isMissingColumnError(error.message)) {
      const fallbackRow = missionToRow(mission)
      delete (fallbackRow as { terra_object_type?: unknown }).terra_object_type
      delete (fallbackRow as { terra_mmsi?: unknown }).terra_mmsi
      const retry = await sup.client.from(TABLE).upsert(fallbackRow, { onConflict: 'id' })
      if (!retry.error) {
        const stored = { ...mission, persistenceBackend: 'supabase' as const, constellationSpawned: false as const, astraProvidesSubstantiveAnswer: false as const }
        if (shouldAudit && latest) await persistAudit(stored, latest.kind, latest.detail)
        return stored
      }
    }
    if (!isMissingTableError(error.message) && !isMissingColumnError(error.message)) {
      throw new Error(`ASTRA mission supabase persist failed: ${error.message}`)
    }
    tableAvailable = false
  }
  const stored = await withFileLock(mission.id, () => writeFilesystemMission(mission))
  if (shouldAudit && latest) await persistAudit(stored, latest.kind, latest.detail)
  return stored
}

export async function getAstraLiveMission(id: string): Promise<AstraLiveMission | null> {
  const sup = tryWarRoomSupabase()
  if (sup.ok && await probeSupabaseTable(sup.client)) {
    const { data, error } = await sup.client.from(TABLE).select('*').eq('id', id).maybeSingle()
    if (!error && data) return rowToMission(data as Record<string, unknown>)
    if (error && !isMissingTableError(error.message)) {
      throw new Error(`ASTRA mission supabase read failed: ${error.message}`)
    }
  }
  return readFilesystemMission(id)
}

export async function createAstraCouncilConversation(mission: AstraLiveMission): Promise<string | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const lineage = mission.terraSeed?.lineage
  const insert: Record<string, unknown> = {
    title: `ASTRA: ${mission.objective.slice(0, 72)}`,
    metadata: {
      astra: {
        missionId: mission.id,
        origin: 'commander_created',
        terraObjectId: lineage?.objectId ?? null,
        terraObjectType: lineage?.type ?? null,
        terraProvider: lineage?.provider ?? null,
        terraEvidenceId: lineage?.evidenceId ?? null,
        terraMmsi: mission.observedVessel?.mmsi ?? null,
      },
    },
  }
  if (mission.commanderUserId) insert.owner_user_id = mission.commanderUserId
  const { data, error } = await sup.client
    .from('war_room_conversations')
    .insert(insert)
    .select('id')
    .single()
  if (!error && typeof data?.id === 'string') return data.id
  if (insert.owner_user_id) {
    delete insert.owner_user_id
    const retry = await sup.client.from('war_room_conversations').insert(insert).select('id').single()
    if (!retry.error && typeof retry.data?.id === 'string') return retry.data.id
  }
  return null
}

export async function listAstraLiveMissions(commanderUserId: string): Promise<AstraLiveMission[]> {
  const sup = tryWarRoomSupabase()
  if (sup.ok && await probeSupabaseTable(sup.client)) {
    const { data, error } = await sup.client
      .from(TABLE)
      .select('*')
      .eq('commander_user_id', commanderUserId)
      .order('created_at', { ascending: false })
    if (!error) {
      return ((data ?? []) as Record<string, unknown>[]).map(rowToMission).filter(Boolean) as AstraLiveMission[]
    }
    if (!isMissingTableError(error.message)) {
      throw new Error(`ASTRA mission supabase list failed: ${error.message}`)
    }
  }
  return listFilesystemMissions(commanderUserId)
}

export async function findAstraMissionByConversationId(conversationId: string): Promise<AstraLiveMission | null> {
  const sup = tryWarRoomSupabase()
  if (sup.ok && await probeSupabaseTable(sup.client)) {
    const { data, error } = await sup.client
      .from(TABLE)
      .select('*')
      .eq('council_conversation_id', conversationId)
      .maybeSingle()
    if (!error && data) return rowToMission(data as Record<string, unknown>)
  }
  const dirMissions = await listFilesystemMissionsFromAll()
  return dirMissions.find(mission => mission.councilConversationId === conversationId) ?? null
}

async function listFilesystemMissionsFromAll(): Promise<AstraLiveMission[]> {
  try {
    const names = (await readdir(storeDir())).filter(name => name.endsWith('.json'))
    const missions: AstraLiveMission[] = []
    for (const name of names) {
      try {
        const raw = JSON.parse(await readFile(path.join(storeDir(), name), 'utf8')) as AstraLiveMission
        if (raw?.id && isAstraMissionStatus(raw.status)) missions.push(raw)
      } catch {
        /* skip */
      }
    }
    return missions
  } catch {
    return []
  }
}

export async function claimAstraMissionRunning(args: {
  id: string
  commanderUserId: string
  nowIso?: string
}): Promise<AstraMissionClaimResult> {
  return withMissionLock(args.id, async () => {
    const nowIso = args.nowIso ?? new Date().toISOString()
    const sup = tryWarRoomSupabase()
    if (sup.ok && await probeSupabaseTable(sup.client)) {
      const { data: existing, error: readError } = await sup.client.from(TABLE).select('*').eq('id', args.id).maybeSingle()
      if (readError && !isMissingTableError(readError.message)) {
        throw new Error(`ASTRA mission claim read failed: ${readError.message}`)
      }
      if (!readError && existing) {
        const current = rowToMission(existing as Record<string, unknown>)
        if (!current || current.commanderUserId !== args.commanderUserId) return { ok: false, code: 'not_found' }
        const conflict = astraExecuteConflict(current.status)
        if (conflict) return { ok: false, code: conflict, mission: current }
        const running = markAstraMissionRunning(current, nowIso)
        const { data, error } = await sup.client
          .from(TABLE)
          .update(missionToRow(running))
          .eq('id', args.id)
          .eq('status', 'planned')
          .eq('commander_user_id', args.commanderUserId)
          .select('*')
          .maybeSingle()
        if (error) throw new Error(`ASTRA mission claim update failed: ${error.message}`)
        if (!data) {
          const latest = await getAstraLiveMission(args.id)
          if (!latest || latest.commanderUserId !== args.commanderUserId) return { ok: false, code: 'not_found' }
          const latestConflict = astraExecuteConflict(latest.status)
          if (latestConflict) return { ok: false, code: latestConflict, mission: latest }
          return { ok: false, code: 'already_running', mission: latest }
        }
        const stored = rowToMission(data as Record<string, unknown>)
        if (!stored) return { ok: false, code: 'not_found' }
        await persistAudit(stored, 'MISSION_EXECUTION_STARTED', 'Commander explicitly requested execution.')
        return { ok: true, mission: stored }
      }
    }
    return withFileLock(args.id, async () => {
      const current = await readFilesystemMission(args.id)
      if (!current || current.commanderUserId !== args.commanderUserId) return { ok: false, code: 'not_found' }
      const conflict = astraExecuteConflict(current.status)
      if (conflict) return { ok: false, code: conflict, mission: current }
      const stored = await writeFilesystemMission(markAstraMissionRunning(current, nowIso))
      await persistAudit(stored, 'MISSION_EXECUTION_STARTED', 'Commander explicitly requested execution.')
      return { ok: true, mission: stored }
    })
  })
}

export async function describeAstraMissionStore(): Promise<StoreProbe & { backend: AstraPersistenceBackend; dir: string }> {
  const sup = tryWarRoomSupabase()
  const supabase = sup.ok && await probeSupabaseTable(sup.client)
  return {
    supabase,
    backend: supabase ? 'supabase' : 'local_filesystem_fallback',
    dir: storeDir(),
  }
}
