import { GOVERNOR_MIN_STATE_MS, GOVERNED_LAYER_IDS, type GovernedLayerId, type LayerDecision, type LayerGovernorPlan } from './types'

export function applyGovernorAntiThrash(input: {
  previous: LayerGovernorPlan | null
  next: LayerGovernorPlan
  nowMs: number
  lastChangeMs: Partial<Record<GovernedLayerId, number>>
}): { plan: LayerGovernorPlan; lastChangeMs: Partial<Record<GovernedLayerId, number>> } {
  if (!input.previous) {
    const seeded: Partial<Record<GovernedLayerId, number>> = {}
    for (const id of GOVERNED_LAYER_IDS) seeded[id] = input.nowMs
    return { plan: input.next, lastChangeMs: seeded }
  }
  const lastChangeMs = { ...input.lastChangeMs }
  const layers = { ...input.next.layers }
  for (const id of GOVERNED_LAYER_IDS) {
    const prev = input.previous.layers[id]
    const next = input.next.layers[id]
    if (next.mode !== 'AUTO' || prev.mode !== 'AUTO') {
      lastChangeMs[id] = input.nowMs
      continue
    }
    if (prev.effective === next.effective && prev.priority === next.priority) continue
    const held = input.nowMs - (lastChangeMs[id] ?? 0)
    if (held < GOVERNOR_MIN_STATE_MS && !isCriticalPromotion(prev, next)) {
      layers[id] = prev
      continue
    }
    lastChangeMs[id] = input.nowMs
  }
  return { plan: { ...input.next, layers }, lastChangeMs }
}

function isCriticalPromotion(prev: LayerDecision, next: LayerDecision): boolean {
  return next.priority === 'CRITICAL' && prev.priority !== 'CRITICAL'
}
