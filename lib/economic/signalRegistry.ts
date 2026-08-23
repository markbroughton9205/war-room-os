export type EconomicSignalPersistence = 'SESSION_ONLY' | 'DURABLE'
export type EconomicSignalLifecycle = 'SOURCE_DISCOVERED' | 'SOURCE_EXISTENCE_VERIFIED' | 'ACCESS_VERIFIED' | 'LIVE_DATA_VERIFIED' | 'STRATEGY_HYPOTHESIS' | 'BACKTESTED' | 'PAPER_VALIDATED' | 'COMMANDER_AUTHORIZED_LIVE_USE' | 'CONFIRMED_REVENUE' | 'CASH_RECEIVED'

export type EconomicSignal = {
  id: string
  name: string
  sourceUrl: string
  sourceType: 'DISCOVERY' | 'PRIMARY' | 'AGGREGATOR' | 'INFRASTRUCTURE' | 'MARKETPLACE'
  existenceStatus: 'SOURCE_DISCOVERED' | 'SOURCE_EXISTENCE_VERIFIED'
  accessStatus: 'ACCESS_UNVERIFIED' | 'ACCESS_VERIFIED'
  liveDataStatus: 'LIVE_DATA_UNVERIFIED' | 'LIVE_DATA_VERIFIED'
  lifecycleStatus: EconomicSignalLifecycle
  authentication: { type: 'UNKNOWN' | 'NONE' | 'API_KEY' | 'OAUTH' | 'PAYWALL' | 'LEGAL_AGREEMENT'; details: string | null; keyEnvironmentVariable: string | null }
  lastObservedLatencyMs: number | null
  sampleCount: number
  lastLiveTestAt: string | null
  persistence: EconomicSignalPersistence
  liveIncomeGenerated: boolean
  cashReceivedEventId: string | null
  provenance: Array<{ url: string; retrievedAt: string; httpStatus: number | null }>
}

const registry = new Map<string, EconomicSignal>()

export function upsertEconomicSignal(input: Omit<EconomicSignal, 'liveIncomeGenerated'> & { liveIncomeGenerated?: boolean }): EconomicSignal {
  if (input.liveIncomeGenerated && !input.cashReceivedEventId) throw new Error('liveIncomeGenerated requires a traceable CASH_RECEIVED event.')
  const existing = registry.get(input.id)
  const value = { ...input, persistence: 'SESSION_ONLY' as const, liveIncomeGenerated: Boolean(input.cashReceivedEventId), sampleCount: Math.max(input.sampleCount, existing?.sampleCount ?? 0) }
  registry.set(value.id, value)
  return value
}

export function recordLiveSignalObservation(id: string, latencyMs: number, at: string, httpStatus: number): EconomicSignal {
  const signal = registry.get(id)
  if (!signal) throw new Error(`Unknown economic signal: ${id}`)
  const value = { ...signal, existenceStatus: 'SOURCE_EXISTENCE_VERIFIED' as const, accessStatus: 'ACCESS_VERIFIED' as const, liveDataStatus: 'LIVE_DATA_VERIFIED' as const, lifecycleStatus: 'LIVE_DATA_VERIFIED' as const, lastObservedLatencyMs: Math.max(0, Math.round(latencyMs)), sampleCount: signal.sampleCount + 1, lastLiveTestAt: at, provenance: [...signal.provenance, { url: signal.sourceUrl, retrievedAt: at, httpStatus }].slice(-50) }
  registry.set(id, value)
  return value
}

export const listEconomicSignals = () => [...registry.values()]
export const __resetEconomicSignalRegistryForTests = () => registry.clear()
