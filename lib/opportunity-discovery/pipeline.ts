import { fetchProvider } from './adapters'
import { isQualifying } from './core'
import { notifyCommander } from './notifications'
import { detectNewOrChanged, discoveryPersistenceState } from './state'
import type { DiscoveryProvider, NotificationResult } from './types'

export async function runOpportunityDiscovery(options: { providers?: DiscoveryProvider[]; deliverExternal?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const providers = options.providers ?? ['adzuna', 'remote_ok', 'sam_gov', 'usaspending']
  const sourceResults = await Promise.all(providers.map(provider => fetchProvider(provider, options.env)))
  const qualifying = sourceResults.flatMap(source => source.records).filter(isQualifying)
  const { newMatches, unchanged } = detectNewOrChanged(qualifying)
  const notifications: NotificationResult[] = []
  for (const record of newMatches) {
    if (options.deliverExternal && notifications.every(item => item.state !== 'EXTERNAL_DELIVERY')) notifications.push(await notifyCommander(record, options.env))
    else notifications.push({ state: 'NOTIFICATION_GENERATED', channel: null, providerMessageId: null, body: (await import('./notifications')).buildDiscoveryNotification(record), error: null })
  }
  const operationalEvents = sourceResults.flatMap(source => source.records.map(record => ({
    provider: source.provider,
    providerRecordId: record.providerRecordId,
    timestamp: record.retrievedAt,
    retrievalState: source.state,
    matchResult: isQualifying(record) ? 'QUALIFIED' as const : 'REJECTED' as const,
    notificationState: newMatches.some(match => match.id === record.id) ? 'GENERATED' as const : 'NOT_REQUIRED' as const,
    provenance: record.provenance,
    blockReason: source.error,
  })))
  return {
    discoveryOnly: true as const,
    actionState: newMatches.length ? 'READY_FOR_COMMANDER_REVIEW' as const : 'DISCOVERED' as const,
    sourceResults,
    qualifying,
    newMatches,
    duplicatesSuppressed: unchanged,
    notifications,
    operationalEvents,
    externalDeliveryOccurred: notifications.some(item => item.state === 'EXTERNAL_DELIVERY'),
    persistence: discoveryPersistenceState(),
    prohibitedCapabilities: ['APPLICATION_SUBMISSION', 'PROPOSAL_SUBMISSION', 'BIDDING', 'AUTONOMOUS_EXTERNAL_ACTION'],
  }
}
