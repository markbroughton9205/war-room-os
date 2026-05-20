import type { CanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'
import type { ConfigurationSweep } from '@/lib/configuration/configurationHealth'
import type { OperatorDeckSnapshot } from '@/lib/operator/deckTypes'
import type { PaymentProviderReadiness } from '@/lib/payments/types'
import type { RssIngestionRuntimeStatus } from '@/lib/signals/rss/runtime'
import type { SchemaSweepApiResponse } from '@/lib/schema-sweep/types'
import type { ReadinessScores } from './types'

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function subsystemScore(
  canonical: CanonicalRuntimeStatus,
  id: string,
  weightHealthy = 100,
  weightDegraded = 55,
  weightUnavailable = 15,
): number {
  const subsystem = canonical.subsystems.find(entry => entry.id === id)
  if (!subsystem) return 25
  if (subsystem.health === 'healthy') return weightHealthy
  if (subsystem.health === 'degraded' || subsystem.health === 'unknown') return weightDegraded
  return weightUnavailable
}

export function computeProviderReadiness(canonical: CanonicalRuntimeStatus): number {
  const required = canonical.providers.filter(provider => provider.family !== 'redteam')
  if (!required.length) return 0
  const connected = required.filter(provider => provider.connected).length
  const configured = required.filter(provider => provider.configured).length
  const liveWeight = (connected / required.length) * 85
  const configWeight = (configured / required.length) * 15
  return clampScore(liveWeight + configWeight)
}

export function computeSchemaReadiness(schema: SchemaSweepApiResponse | null): number {
  if (!schema) return 20
  if (schema.status === 'healthy') return 100
  if (schema.status === 'drift_detected') {
    const tablePenalty = Math.min(40, schema.missingTables.length * 8)
    const columnPenalty = Math.min(30, schema.missingColumns.length * 4)
    const migrationPenalty = schema.migrations.status === 'missing' ? 20 : 10
    return clampScore(100 - tablePenalty - columnPenalty - migrationPenalty)
  }
  if (schema.status === 'incomplete') return 45
  return 15
}

export function computeSignalReadiness(args: {
  configuredSources: number
  totalSources: number
  rss: RssIngestionRuntimeStatus | null
  canonical: CanonicalRuntimeStatus
}): number {
  const sourceRatio = args.totalSources
    ? (args.configuredSources / args.totalSources) * 50
    : 20
  const radar = subsystemScore(args.canonical, 'signal_radar')
  let rssScore = 25
  if (args.rss) {
    if (args.rss.aggregateHealth === 'healthy') rssScore = 100
    else if (args.rss.aggregateHealth === 'degraded') rssScore = 55
    else if (args.rss.aggregateHealth === 'unavailable') rssScore = 20
    else rssScore = 35
  }
  return clampScore(sourceRatio + radar * 0.25 + rssScore * 0.25)
}

export function computeOperatorReadiness(deck: OperatorDeckSnapshot | null): number {
  if (!deck) return 25
  if (!deck.persistenceAvailable) return 30
  const integrations = Object.values(deck.integrations)
  const healthy = integrations.filter(
    status => status === 'SOURCE_BACKED' || status === 'MANUAL_LOGGED' || status === 'PROPOSED' || status === 'APPROVAL_REQUIRED',
  ).length
  const unavailable = integrations.filter(status => status === 'UNAVAILABLE').length
  const base = integrations.length ? (healthy / integrations.length) * 75 : 40
  const queueBonus = deck.actionQueue.length > 0 ? 10 : 0
  const penalty = unavailable * 8
  return clampScore(base + queueBonus - penalty)
}

export function computeRevenueReadiness(args: {
  payments: PaymentProviderReadiness[]
  canonical: CanonicalRuntimeStatus
  configuration: ConfigurationSweep
}): number {
  const depositProviders = args.payments.filter(provider => provider.id !== 'ach_placeholder')
  const configuredPayments = depositProviders.filter(provider => provider.status === 'configured').length
  const paymentScore = depositProviders.length
    ? (configuredPayments / depositProviders.length) * 40
    : 20
  const revenueSubsystem = subsystemScore(args.canonical, 'revenue_engine')
  const scoutConfigured = args.configuration.providers.find(provider => provider.id === 'opportunity_scout')?.configured
  const scoutScore = scoutConfigured ? 20 : 5
  return clampScore(paymentScore + revenueSubsystem * 0.3 + scoutScore)
}

export function computeReadinessScores(input: {
  canonical: CanonicalRuntimeStatus
  configuration: ConfigurationSweep
  schema: SchemaSweepApiResponse | null
  rss: RssIngestionRuntimeStatus | null
  deck: OperatorDeckSnapshot | null
  payments: PaymentProviderReadiness[]
  configuredSources: number
  totalSources: number
}): ReadinessScores {
  const provider = computeProviderReadiness(input.canonical)
  const schema = computeSchemaReadiness(input.schema)
  const signal = computeSignalReadiness({
    configuredSources: input.configuredSources,
    totalSources: input.totalSources,
    rss: input.rss,
    canonical: input.canonical,
  })
  const operator = computeOperatorReadiness(input.deck)
  const revenue = computeRevenueReadiness({
    payments: input.payments,
    canonical: input.canonical,
    configuration: input.configuration,
  })
  const overall = clampScore((provider + schema + signal + operator + revenue) / 5)
  return { provider, schema, signal, operator, revenue, overall }
}

export function readinessLabel(score: number): string {
  if (score >= 85) return 'Operational'
  if (score >= 65) return 'Degraded'
  if (score >= 40) return 'Repair needed'
  return 'Blocked'
}
