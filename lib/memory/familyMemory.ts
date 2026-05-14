import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { MemoryFamilyPartition } from '@/lib/memory/types'
import { listApprovedMemoriesByPartition } from '@/lib/memory/store'

const DEFAULT_CHAR_BUDGET = 12_000

/** Newest-first approved memories for prompt injection (truncated by character budget). */
export async function buildFamilyContext(
  client: WarRoomSupabase,
  partition: MemoryFamilyPartition,
  limit: number,
  charBudget = DEFAULT_CHAR_BUDGET,
): Promise<string> {
  const res = await listApprovedMemoriesByPartition(client, partition, Math.min(Math.max(limit, 1), 200))
  if (!res.ok) {
    return ''
  }
  const parts: string[] = []
  let used = 0
  for (const row of res.rows) {
    const block = `## ${row.title}\n${row.content}\n\n`
    if (used + block.length > charBudget) {
      const rest = charBudget - used
      if (rest > 80) {
        parts.push(block.slice(0, rest) + '\n[truncated]')
      }
      break
    }
    parts.push(block)
    used += block.length
  }
  return parts.join('').trim()
}
