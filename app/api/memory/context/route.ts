import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { buildFamilyContext } from '@/lib/memory/familyMemory'
import { buildOperationalMemorySnapshot } from '@/lib/memory/operationalSnapshot'
import type { MemoryContextResponse, MemoryContextSnippet, MemoryFamilyPartition } from '@/lib/memory/types'
import { isMemoryFamilyPartition } from '@/lib/memory/types'
import { listApprovedMemoriesByPartition, listRecentApprovedMemories } from '@/lib/memory/store'

export const dynamic = 'force-dynamic'

function toSnippets(rows: { id: string; approved_at: string; family_partition: MemoryFamilyPartition; title: string; content: string }[], previewLen: number): MemoryContextSnippet[] {
  return rows.map(r => ({
    id: r.id,
    approved_at: r.approved_at,
    family_partition: r.family_partition,
    title: r.title,
    preview: r.content.length > previewLen ? `${r.content.slice(0, previewLen)}…` : r.content,
  }))
}

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  const url = new URL(req.url)
  const partitionRaw = url.searchParams.get('partition')
  const limitRaw = url.searchParams.get('limit')
  const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw || '20', 10) || 20))

  const partition: MemoryFamilyPartition | null =
    partitionRaw && isMemoryFamilyPartition(partitionRaw) ? partitionRaw : null

  if (!sup.ok) {
    const empty: MemoryContextResponse = {
      partition,
      limit,
      snippets: [],
      familyContext: '',
      operational: {},
      operationalNote: 'Persistence unavailable; operational snapshot empty.',
    }
    return jsonWithPersistence(empty, false)
  }

  const op = await buildOperationalMemorySnapshot(sup.client)
  let approvedRows: {
    id: string
    approved_at: string
    family_partition: MemoryFamilyPartition
    title: string
    content: string
  }[] = []

  if (partition) {
    const r = await listApprovedMemoriesByPartition(sup.client, partition, limit)
    if (r.ok) {
      approvedRows = r.rows
    } else {
      op.note = op.note ? `${op.note} | approved:${r.error}` : `approved:${r.error}`
    }
  } else {
    const r = await listRecentApprovedMemories(sup.client, limit)
    if (r.ok) {
      approvedRows = r.rows
    } else {
      op.note = op.note ? `${op.note} | approved:${r.error}` : `approved:${r.error}`
    }
  }

  const familyContext = partition ? await buildFamilyContext(sup.client, partition, limit) : ''

  const body: MemoryContextResponse = {
    partition,
    limit,
    snippets: toSnippets(approvedRows, 360),
    familyContext,
    operational: op.snapshot,
    operationalNote: op.note,
  }

  return jsonWithPersistence(body, true)
}
