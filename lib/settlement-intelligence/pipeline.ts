import { fetchAggregator } from './adapters'
import { generateSettlementNotification } from './notifications'
import type { FieldVerification, SettlementAggregator, VerificationField } from './types'
import { applyOfficialVerification, compareAggregatorClaims, corroborate, verifyOfficialSource } from './verification'

export type SettlementSource = { provider: SettlementAggregator; url: string }

function mergeOfficialFields(results: Array<Partial<Record<VerificationField, FieldVerification>>>) {
  const merged: Partial<Record<VerificationField, FieldVerification>> = {}
  for (const fields of results) {
    for (const [field, candidate] of Object.entries(fields) as Array<[VerificationField, FieldVerification]>) {
      const current = merged[field]
      if (!current) merged[field] = candidate
      else if (current.value !== candidate.value) merged[field] = {
        ...current,
        status: 'CONFLICT',
        value: null,
        note: `Official sources conflict: ${current.source?.url ?? 'unknown'} and ${candidate.source?.url ?? 'unknown'}.`,
      }
    }
  }
  return merged
}

export async function runSettlementIntelligence(
  sources: SettlementSource[],
  options: { fetcher?: typeof fetch } = {},
) {
  const fetcher = options.fetcher ?? fetch
  const sourceResults = await Promise.all(sources.map(source => fetchAggregator(source.provider, source.url, fetcher)))
  const discoveries = sourceResults.flatMap(result => result.record ? [result.record] : [])
  const records = corroborate(discoveries).map(compareAggregatorClaims)
  const verifiedRecords = await Promise.all(records.map(async record => {
    const candidates = [...new Set(record.discoveries.flatMap(discovery => discovery.officialSourceCandidates))]
    const checks = await Promise.all(candidates.map(candidate => verifyOfficialSource(candidate, fetcher)))
    return applyOfficialVerification(record, mergeOfficialFields(checks.map(check => check.fields)))
  }))
  const notificationResults = verifiedRecords.map(record => ({ record, notification: generateSettlementNotification(record) }))
  return {
    discoveryOnly: true as const,
    sourceResults,
    records: verifiedRecords,
    notifications: notificationResults.flatMap(result => result.notification ? [result.notification] : []),
    duplicatesSuppressed: notificationResults.filter(result => !result.notification).map(result => result.record.key),
  }
}
