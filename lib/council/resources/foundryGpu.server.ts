import 'server-only'
import { assessLiveness } from '@/lib/agents/ops/engineering/missions/liveness'
import { realFacts } from '@/lib/agents/ops/engineering/missions/reconcile'
import { serviceDeps } from '@/lib/agents/ops/engineering/missions/service'
import { ACTIVE_STATES } from '@/lib/agents/ops/engineering/missions/types'
import type { ActiveFoundryMission } from './gpuArbitration'

/** A Foundry engineering mission that is executing right now (active state AND a live worker), read-only. */
export function activeFoundryMission(): ActiveFoundryMission | null {
  try {
    const deps = serviceDeps()
    const facts = realFacts()
    for (const m of deps.store.list()) {
      if (!ACTIVE_STATES.includes(m.state)) continue
      if (assessLiveness(m, facts).verdict === 'DEAD') continue
      return { id: m.id, title: m.title, state: m.state, stateReason: m.stateReason }
    }
  } catch {
    /* an unreadable Foundry store is not evidence of a running mission */
  }
  return null
}
