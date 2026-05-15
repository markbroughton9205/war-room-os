import type {
  InternetResearchAdapterSummary,
  InternetResearchOverallStatus,
  InternetToolHealth,
} from '@/lib/tools/internet/types'

/** Explicit opt-out of wiring external research adapters (stub / offline bundle). */
export const WAR_ROOM_INTERNET_UNWIRED_ENV = 'WAR_ROOM_INTERNET_UNWIRED'

export function isInternetResearchLayerUnwired(): boolean {
  const v = process.env[WAR_ROOM_INTERNET_UNWIRED_ENV]?.trim()
  return v === '1' || v?.toLowerCase() === 'true'
}

export function internetResearchAdapterSummary(
  tool: Pick<InternetToolHealth, 'status' | 'notes'>,
): InternetResearchAdapterSummary {
  const keyPresent = tool.status !== 'config_needed'
  if (!keyPresent) {
    return { keyPresent: false, configured: false, notes: tool.notes }
  }
  return {
    keyPresent: true,
    configured: true,
    reachable: tool.status === 'reachable',
    notes: tool.notes,
  }
}

export function deriveInternetResearchOverall(params: {
  tavily: InternetResearchAdapterSummary
  firecrawl: InternetResearchAdapterSummary
  unwired: boolean
}): { overallStatus: InternetResearchOverallStatus; label: string } {
  if (params.unwired) {
    return { overallStatus: 'unwired', label: 'Unwired' }
  }
  const { tavily: t, firecrawl: f } = params
  const count = [t.keyPresent, f.keyPresent].filter(Boolean).length
  if (count === 0) {
    return { overallStatus: 'needs_api_key', label: 'Needs API Key' }
  }
  if (count === 1) {
    return { overallStatus: 'partial', label: 'Partial' }
  }
  const anyLive = Boolean(t.reachable) || Boolean(f.reachable)
  if (anyLive) {
    return { overallStatus: 'live', label: 'Live' }
  }
  return { overallStatus: 'configured_only', label: 'Configured Only' }
}
