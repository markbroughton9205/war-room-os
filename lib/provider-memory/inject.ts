import { buildFamilyContext } from '@/lib/memory/familyMemory'
import { buildOperationalMemorySnapshot } from '@/lib/memory/operationalSnapshot'
import { councilSingleFamilyToMemoryPartition } from '@/lib/memory/ingestFromModel'
import { sanitizeMemoryRuntimeText } from '@/lib/memory/runtimeState'
import { listApprovedMemoriesByPartition } from '@/lib/memory/store'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type ProviderMemoryInjection = {
  block: string
  snippetCount: number
  degraded: boolean
  note: string | null
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * Approved council memory for provider prompts. Graceful when DB unavailable.
 */
export async function buildProviderMemoryInjection(
  client: WarRoomSupabase | null,
  family: CouncilOrchestrationFamily,
  limit = 12,
): Promise<ProviderMemoryInjection> {
  if (!client) {
    return {
      block: '',
      snippetCount: 0,
      degraded: true,
      note: 'Memory store unavailable; proceeding without approved recall.',
    }
  }

  const partition = councilSingleFamilyToMemoryPartition(family)
  const [approved, familyContext, operational] = await Promise.all([
    listApprovedMemoriesByPartition(client, partition, limit),
    buildFamilyContext(client, partition, limit),
    buildOperationalMemorySnapshot(client),
  ])

  const lines: string[] = ['### Approved council memory (Commander-gated)']
  let snippetCount = 0
  let degraded = false
  let note: string | null = null

  if (!approved.ok) {
    degraded = true
    note = sanitizeMemoryRuntimeText(`approved_memory_unavailable:${approved.error}`)
  } else {
    snippetCount = approved.rows.length
    for (const row of approved.rows) {
      lines.push(`- [${row.title}] ${truncate(row.content, 240)}`)
    }
  }

  if (familyContext.trim()) {
    lines.push('', '### Family continuity', truncate(familyContext, 1200))
  }

  if (operational.note) {
    degraded = true
    note = note ? `${note} | ${sanitizeMemoryRuntimeText(operational.note)}` : sanitizeMemoryRuntimeText(operational.note)
  }

  if (operational.snapshot.activeMission?.title) {
    lines.push(
      '',
      '### Mission continuity',
      `- Active mission: ${operational.snapshot.activeMission.title} (${operational.snapshot.activeMission.state ?? 'unknown'})`,
    )
  }

  if (snippetCount === 0 && !familyContext.trim()) {
    return { block: '', snippetCount: 0, degraded, note }
  }

  return {
    block: lines.join('\n'),
    snippetCount,
    degraded,
    note,
  }
}
