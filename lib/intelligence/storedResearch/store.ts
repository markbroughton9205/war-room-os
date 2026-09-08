import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type {
  StoredResearchPacket,
  StoredResearchReadResult,
  StoredResearchWriteResult,
} from '@/lib/intelligence/storedResearch/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

const TABLE = 'war_room_stored_research_packets'
const DEFAULT_RELATIVE_DIR = ['.war-room', 'stored-research'] as const

function storeDir(): string {
  const override = process.env.WAR_ROOM_STORED_RESEARCH_DIR?.trim()
  if (override) return path.isAbsolute(override) ? override : path.resolve(resolveBaseRepoRoot(), override)
  return path.join(resolveBaseRepoRoot(), ...DEFAULT_RELATIVE_DIR)
}

function isPersistableEvidenceUrl(url: string | undefined): boolean {
  if (!url) return true
  return /^https?:\/\//i.test(url)
}

export function sanitizeStoredResearchPacket(packet: StoredResearchPacket): StoredResearchPacket {
  const evidence = packet.evidence.filter(item => {
    if (item.origin_type === 'MODEL_INFERENCE') return false
    if (!isPersistableEvidenceUrl(item.url)) return false
    return true
  })
  return { ...packet, evidence }
}

export async function persistStoredResearchPacket(
  packet: StoredResearchPacket,
  supabase?: WarRoomSupabase | null,
): Promise<StoredResearchWriteResult> {
  const sanitized = sanitizeStoredResearchPacket(packet)
  const local = await writeLocalPacket(sanitized)
  if (supabase) {
    const remote = await writeSupabasePacket(sanitized, supabase)
    if (remote.ok) return { ...remote, backend: local.ok ? 'supabase' : 'supabase' }
    if (local.ok) return { ok: true, id: sanitized.id, backend: 'local', error: remote.error }
    return { ok: false, backend: 'none', error: remote.error ?? local.error }
  }
  return local
}

async function writeLocalPacket(packet: StoredResearchPacket): Promise<StoredResearchWriteResult> {
  try {
    const dir = storeDir()
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${packet.id}.json`)
    await writeFile(filePath, JSON.stringify(packet, null, 2), 'utf8')
    return { ok: true, id: packet.id, backend: 'local' }
  } catch (error) {
    return {
      ok: false,
      backend: 'none',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function writeSupabasePacket(
  packet: StoredResearchPacket,
  supabase: WarRoomSupabase,
): Promise<StoredResearchWriteResult> {
  try {
    const { error } = await supabase.from(TABLE).upsert({
      id: packet.id,
      conversation_id: packet.conversationId ?? null,
      logical_request_id: packet.logicalRequestId ?? null,
      round_request_id: packet.roundRequestId ?? null,
      decree: packet.decree,
      created_at: packet.createdAt,
      freshness: packet.freshness,
      confidence: packet.confidence,
      packet_json: packet,
    }, { onConflict: 'id' })
    if (error) {
      return { ok: false, backend: 'none', error: error.message }
    }
    return { ok: true, id: packet.id, backend: 'supabase' }
  } catch (error) {
    return {
      ok: false,
      backend: 'none',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function loadAllStoredResearchPackets(
  supabase?: WarRoomSupabase | null,
): Promise<StoredResearchReadResult> {
  const local = await readLocalPackets()
  if (local.ok && local.packets.length) return local
  if (supabase) {
    const remote = await readSupabasePackets(supabase)
    if (remote.ok) return remote
    if (local.ok) {
      return {
        ...local,
        note: remote.error
          ? `Supabase stored-research read unavailable (${remote.error}); using local store.`
          : local.note,
      }
    }
    return remote
  }
  return local
}

async function readLocalPackets(): Promise<StoredResearchReadResult> {
  try {
    const dir = storeDir()
    const names = (await readdir(dir)).filter(name => name.endsWith('.json'))
    const packets: StoredResearchPacket[] = []
    for (const name of names) {
      const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as StoredResearchPacket
      if (raw?.id && raw.origin_type === 'STORED_RESEARCH') packets.push(raw)
    }
    return { ok: true, packets, backend: 'local' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: true, packets: [], backend: 'local' }
    return {
      ok: false,
      packets: [],
      backend: 'none',
      error: error instanceof Error ? error.message : String(error),
      note: 'Prior stored research retrieval unavailable this round; current answer is based only on live evidence if any was fetched.',
    }
  }
}

async function readSupabasePackets(supabase: WarRoomSupabase): Promise<StoredResearchReadResult> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('packet_json')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      return {
        ok: false,
        packets: [],
        backend: 'none',
        error: error.message,
        note: 'Prior stored research retrieval unavailable this round; current answer is based only on live evidence if any was fetched.',
      }
    }
    const packets = (data ?? [])
      .map(row => (row as { packet_json?: StoredResearchPacket }).packet_json)
      .filter((packet): packet is StoredResearchPacket => Boolean(packet?.id && packet.origin_type === 'STORED_RESEARCH'))
    return { ok: true, packets, backend: 'supabase' }
  } catch (error) {
    return {
      ok: false,
      packets: [],
      backend: 'none',
      error: error instanceof Error ? error.message : String(error),
      note: 'Prior stored research retrieval unavailable this round; current answer is based only on live evidence if any was fetched.',
    }
  }
}
