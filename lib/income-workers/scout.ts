import { orchestrateIncomeWorkerScout } from './scoutOrchestrator'
import type { IncomeWorkerScoutResult } from './types'

export async function scoutIncomeWorkerOpportunities(
  threadId?: string,
): Promise<IncomeWorkerScoutResult> {
  return orchestrateIncomeWorkerScout(threadId ?? 'income-workers')
}
