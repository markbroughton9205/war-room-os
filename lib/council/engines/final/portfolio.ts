/**
 * ENGINE-08 Mission portfolio. Commander priority is hard. No secret Commander goals.
 */
import { createCheckpoint } from '../checkpoint/engine'
import { pauseMission } from '../long-horizon/engine'
import { loadMission } from '../long-horizon/store'
import type { LongHorizonMission } from '../long-horizon/types'
import { ENGINE_08_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { saveFinalJson } from './store'
import type { PortfolioEntry, PortfolioStatus, ProposedMission } from './types'

const LOCAL_CAP = 1

export function mapMissionStatus(state: string): PortfolioStatus {
  if (state === 'PAUSED') return 'paused'
  if (state === 'WAITING_AUTHORITY') return 'waiting_authority'
  if (state === 'COMPLETED' || state === 'PARTIALLY_COMPLETED') return 'completed'
  if (state === 'CANCELLED') return 'cancelled'
  if (state === 'FAILED') return 'completed'
  return 'active'
}

export function orderPortfolio(entries: readonly PortfolioEntry[]): PortfolioEntry[] {
  return [...entries].sort((a, b) => b.commander_priority - a.commander_priority || (a.deadline ?? '').localeCompare(b.deadline ?? ''))
}

export function allocateResources(entries: readonly PortfolioEntry[]): {
  selected: string[]
  deferred: string[]
  local_model_ok: boolean
} {
  const waiting = entries.filter(e => e.status === 'waiting_authority')
  const ordered = orderPortfolio(entries.filter(e => e.status === 'active' || e.status === 'scheduled'))
  const selected: string[] = []
  const deferred: string[] = waiting.map(e => e.mission_id)
  let local = 0
  for (const row of ordered) {
    if (row.depends_on.some(id => ordered.find(o => o.mission_id === id && o.status !== 'completed'))) {
      deferred.push(row.mission_id)
      continue
    }
    if (row.resource_class === 'LOCAL_MODEL') {
      if (local >= LOCAL_CAP) {
        deferred.push(row.mission_id)
        continue
      }
      local += 1
    }
    selected.push(row.mission_id)
  }
  return { selected, deferred, local_model_ok: local <= LOCAL_CAP }
}

export function proposeMission(reason: string): ProposedMission {
  return {
    proposed_id: `prop-${Date.now()}`,
    reason,
    grants_authority: false,
    is_commander_goal: false,
    requires_approval: true,
  }
}

export async function preemptLowerPriority(input: {
  lower: LongHorizonMission
  higher_id: string
}): Promise<{ paused: LongHorizonMission; checkpointed: true }> {
  const paused = await pauseMission(input.lower, `preempted by ${input.higher_id}`)
  await createCheckpoint(paused, `pause preempted by ${input.higher_id}`)
  return { paused, checkpointed: true }
}

export function starvationGuard(entries: readonly PortfolioEntry[], last_run: Record<string, number>, now = Date.now()): string | null {
  const waiting = entries.filter(e => e.status === 'scheduled' || e.status === 'active')
  const starved = waiting.find(e => (last_run[e.mission_id] ?? 0) + 60_000 < now && e.commander_priority > 0)
  return starved?.mission_id ?? null
}

export async function runPortfolio(input: { entries: PortfolioEntry[]; mission_id: string }) {
  const started = Date.now()
  const alloc = allocateResources(input.entries)
  await saveFinalJson('portfolio', input.mission_id, { entries: input.entries, alloc, version: ENGINE_08_VERSION })
  return {
    ordered: orderPortfolio(input.entries),
    alloc,
    grants_authority: false as const,
    waiting_authority_autorun: false as const,
    receipt: createEngineReceipt({
      engine: 'mission-portfolio',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: alloc.selected.length,
      decision: `selected=${alloc.selected.join(',')} deferred=${alloc.deferred.join(',')}`,
    }),
  }
}

export { loadMission }
