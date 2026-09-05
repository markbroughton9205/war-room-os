import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { BackendMetadata } from './types'

export type ModelDiversitySummary = {
  uniqueModels: number
  totalRespondingSeats: number
  sharedModelGroups: { model: string; seats: CouncilOrchestrationFamily[] }[]
}

/**
 * Pure. Never blocks a deliberation — multiple seats sharing weights is allowed, just disclosed.
 * A model key includes backendType + provider so a local and an external call on the "same"
 * model name are never conflated as one shared model.
 */
export function computeModelDiversity(
  seatBackends: { seat: CouncilOrchestrationFamily; backend: BackendMetadata }[],
): ModelDiversitySummary {
  const responded = seatBackends.filter(entry => entry.backend.status === 'OK')
  const byModel = new Map<string, CouncilOrchestrationFamily[]>()
  for (const { seat, backend } of responded) {
    const key = `${backend.backendType}:${backend.provider}:${backend.model}`
    const seats = byModel.get(key) ?? []
    seats.push(seat)
    byModel.set(key, seats)
  }
  const sharedModelGroups = [...byModel.entries()]
    .filter(([, seats]) => seats.length > 1)
    .map(([model, seats]) => ({ model, seats }))

  return {
    uniqueModels: byModel.size,
    totalRespondingSeats: responded.length,
    sharedModelGroups,
  }
}

export const MIN_DISTINCT_MODELS_RECOMMENDED = 2

/** Advisory only — never blocks. Flags when disagreement risks being illusory. */
export function diversityWarning(summary: ModelDiversitySummary): string | null {
  if (summary.totalRespondingSeats < 2) return null
  if (summary.uniqueModels >= MIN_DISTINCT_MODELS_RECOMMENDED) return null
  return `Only ${summary.uniqueModels} unique model(s) backed ${summary.totalRespondingSeats} responding seats — disagreement may not reflect independent reasoning.`
}
