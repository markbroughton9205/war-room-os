import 'server-only'

import { buildConfigurationSweep } from '@/lib/configuration/configurationHealth'
import type { ProviderConfigStatus } from '@/lib/configuration/providerConfigStatus'
import { getRepairSnapshot } from '@/lib/council-repair'
import { collectOperatorDeck } from '@/lib/operator/deckPersistence'
import { getPaymentProviderReadiness } from '@/lib/payments/providers'
import { collectQueueSnapshot } from '@/lib/queues'
import { collectCanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'
import { runSchemaSweepApi } from '@/lib/schema-sweep'
import { sanitizePersistenceNote, sanitizeSchemaError } from '@/lib/schema-sweep/sanitize'
import type { SchemaSweepApiResponse } from '@/lib/schema-sweep/types'
import { getSignalSources } from '@/lib/signals/sources'
import { getRssIngestionRuntimeStatus } from '@/lib/signals/rss/runtime'
import { formatOperatorNextStepsMarkdown } from '@/lib/operator/nextStepsReport'
import { buildRepairIntelligenceOperatorNextSteps } from '@/lib/operator/repairPacketNextSteps'
import type {
  MissingConfigItem,
  RepairApprovalState,
  RepairIntelligenceItem,
  RepairIntelligenceSection,
  RepairIntelligenceSnapshot,
  RepairSeverity,
} from './types'
import { computeReadinessScores } from './readinessScore'

const SEVERITY_ORDER: Record<RepairSeverity, number> = {
  BLOCKER: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
}

function sortBySeverity<T extends { severity: RepairSeverity }>(items: T[]): T[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

function configSeverity(provider: ProviderConfigStatus): RepairSeverity {
  if (provider.required === 'required' && (provider.status === 'missing_api_key' || provider.status === 'missing_provider')) {
    return 'BLOCKER'
  }
  if (provider.status === 'degraded' || provider.status === 'unavailable') return 'HIGH'
  if (provider.status === 'disabled_by_operator') return 'LOW'
  if (provider.required === 'optional') return 'LOW'
  return 'MEDIUM'
}

function configStatus(provider: ProviderConfigStatus): MissingConfigItem['status'] {
  if (provider.status === 'disabled_by_operator') return 'disabled'
  if (provider.status === 'degraded' || provider.status === 'unavailable') return 'degraded'
  if (provider.status === 'missing_api_key' || provider.status === 'missing_provider') return 'missing'
  return 'unknown'
}

function providerIssueMessage(family: string, availability: string, feature: string): string {
  if (availability === 'NOT_CONFIGURED') {
    return `${family} API key missing or unreachable — ${feature} degraded`
  }
  if (availability === 'INVALID_KEY') {
    return `${family} key rejected by live probe — ${feature} unavailable`
  }
  if (availability === 'RATE_LIMITED') {
    return `${family} rate limited — ${feature} may stall`
  }
  if (availability === 'DEGRADED') {
    return `${family} reachable but response integrity degraded — ${feature} unreliable`
  }
  return `${family} provider probe ${availability.toLowerCase()} — review ${feature}`
}

function missingConfigFromProviders(providers: ProviderConfigStatus[]): MissingConfigItem[] {
  return providers
    .filter(provider => !provider.configured || provider.status === 'degraded' || provider.status === 'disabled_by_operator')
    .map(provider => ({
      id: `config:${provider.id}`,
      name: provider.name,
      category: provider.missingEnvVars.length ? 'api_key' as const : 'provider' as const,
      status: configStatus(provider),
      severity: configSeverity(provider),
      affectedFeature: provider.affectedFeatures[0] ?? provider.category,
      affectedPanel: provider.setupLocation,
      reason: provider.missingDependency ?? provider.lastCheckResult,
      requiredFix: provider.recommendedNextAction,
      repairPacketAvailable: false,
      envVarNames: [...provider.missingEnvVars, ...provider.requiredEnvVars].filter(Boolean),
    }))
}

function missingConfigFromSchema(schema: SchemaSweepApiResponse): MissingConfigItem[] {
  const items: MissingConfigItem[] = []
  for (const table of schema.missingTables) {
    items.push({
      id: `schema:table:${table}`,
      name: `Table ${table} missing`,
      category: 'supabase_table',
      status: 'missing',
      severity: 'BLOCKER',
      affectedFeature: 'War Room persistence',
      affectedPanel: 'Engineering · Schema Sweep',
      reason: sanitizePersistenceNote('Expected table not visible through server-side probe.'),
      requiredFix: `Apply migration for ${table} from supabase/ and re-run schema sweep.`,
      repairPacketAvailable: schema.repairPacketAvailable,
    })
  }
  for (const entry of schema.missingColumns) {
    items.push({
      id: `schema:column:${entry.table}.${entry.column}`,
      name: `Column ${entry.table}.${entry.column} missing`,
      category: 'column',
      status: 'missing',
      severity: 'HIGH',
      affectedFeature: 'Schema-dependent panels',
      affectedPanel: 'Engineering · Schema Sweep',
      reason: 'Column not visible through PostgREST probe.',
      requiredFix: `Review ${entry.table} migration and refresh schema cache.`,
      repairPacketAvailable: schema.repairPacketAvailable,
    })
  }
  for (const migration of schema.migrations.missingMigrations ?? []) {
    items.push({
      id: `schema:migration:${migration}`,
      name: `Migration ${migration} not applied`,
      category: 'migration',
      status: 'missing',
      severity: 'HIGH',
      affectedFeature: 'Database evolution',
      affectedPanel: 'Engineering · Schema Sweep',
      reason: schema.migrations.detail,
      requiredFix: 'Apply listed migration in Supabase SQL editor after review.',
      repairPacketAvailable: schema.repairPacketAvailable,
    })
  }
  return items
}

function repairItemsFromSchema(schema: SchemaSweepApiResponse): RepairIntelligenceItem[] {
  const drift = schema.status === 'drift_detected' || schema.status === 'incomplete'
  if (!drift) return []
  const items: RepairIntelligenceItem[] = []
  if (schema.missingTables.length) {
    items.push({
      id: 'schema-drift:tables',
      title: `${schema.missingTables.length} expected table(s) missing`,
      issueType: 'schema_drift',
      section: 'schema_drift',
      severity: 'BLOCKER',
      affectedPanel: 'Engineering · Schema Sweep',
      affectedRoute: '/api/schema/sweep',
      evidence: schema.missingTables.map(table => `Missing table: ${table}`),
      dependencyChain: ['Supabase migrations', 'PostgREST schema cache', 'War Room persistence'],
      suggestedFiles: ['supabase/', 'lib/schema-sweep/expectedSchema.ts'],
      suggestedSqlMigration: schema.repairPacketAvailable
        ? 'Generate repair packet from Schema Sweep (advisory only).'
        : undefined,
      validationCommands: ['pnpm exec tsc --noEmit', 'GET /api/schema/sweep'],
      approvalState: 'approval_required',
      repairPacketAvailable: schema.repairPacketAvailable,
    })
  }
  if (schema.migrations.missingMigrations?.length) {
    items.push({
      id: 'schema-drift:migrations',
      title: `${schema.migrations.missingMigrations.length} migration(s) pending`,
      issueType: 'required_migration',
      section: 'required_migrations',
      severity: 'HIGH',
      affectedPanel: 'Engineering · Schema Sweep',
      affectedRoute: '/api/schema/repair-packet',
      evidence: schema.migrations.missingMigrations.map(name => `Missing migration: ${name}`),
      dependencyChain: ['Supabase migration history', 'Repository manifest'],
      suggestedFiles: schema.migrations.missingMigrations.map(name => `supabase/${name}`),
      validationCommands: ['GET /api/schema/sweep'],
      approvalState: 'approval_required',
      repairPacketAvailable: schema.repairPacketAvailable,
    })
  }
  return items
}

function repairItemsFromCanonical(
  canonical: Awaited<ReturnType<typeof collectCanonicalRuntimeStatus>>,
): RepairIntelligenceItem[] {
  const items: RepairIntelligenceItem[] = []
  for (const provider of canonical.providers.filter(entry => entry.family !== 'redteam')) {
    if (provider.connected) continue
    const feature =
      provider.family === 'claude' || provider.family === 'chatgpt' || provider.family === 'grok' || provider.family === 'gemini'
        ? 'Live Council'
        : 'Provider runtime'
    items.push({
      id: `provider:${provider.family}`,
      title: providerIssueMessage(provider.label.split('·')[0]?.trim() ?? provider.family, provider.availability, feature),
      issueType: 'provider_issue',
      section: 'provider_issues',
      severity: provider.availability === 'NOT_CONFIGURED' ? 'BLOCKER' : 'HIGH',
      affectedPanel: 'Council · Provider Setup',
      affectedRoute: '/api/runtime/canonical-status',
      evidence: [...provider.evidence, ...provider.missingEvidence],
      dependencyChain: ['Environment variables', 'Provider live probe', feature],
      suggestedFiles: ['lib/providers/health.ts', 'components/war-room/ProviderSetupChecklistPanel.tsx'],
      validationCommands: ['GET /api/providers/status', 'GET /api/runtime/canonical-status'],
      approvalState: 'not_required',
      repairPacketAvailable: false,
    })
  }
  for (const subsystem of canonical.subsystems.filter(entry => entry.health !== 'healthy')) {
    items.push({
      id: `runtime:${subsystem.id}`,
      title: `${subsystem.label} ${subsystem.health}`,
      issueType: 'runtime_degradation',
      section: 'runtime_degradation',
      severity: subsystem.health === 'unavailable' ? 'BLOCKER' : 'MEDIUM',
      affectedPanel: 'Runtime Integrity',
      affectedRoute: '/api/runtime/canonical-status',
      evidence: subsystem.evidence,
      dependencyChain: subsystem.downstreamImpact,
      suggestedFiles: ['lib/runtime/canonicalStatus.ts'],
      validationCommands: ['GET /api/runtime/canonical-status'],
      approvalState: subsystem.id === 'approval_gate' ? 'approval_required' : 'unknown',
      repairPacketAvailable: false,
    })
  }
  return items
}

function repairItemsFromQueues(
  engineering: Awaited<ReturnType<typeof collectQueueSnapshot>>,
): RepairIntelligenceItem[] {
  return engineering.items.slice(0, 12).map(item => ({
    id: `queue:${item.id}`,
    title: item.translatedTitle || item.title,
    issueType: item.sourceType,
    section: 'repair_queue' as const,
    severity: item.severity === 'critical' ? 'BLOCKER' as const : item.severity === 'important' ? 'HIGH' as const : 'MEDIUM' as const,
    affectedPanel: 'Engineering Queue',
    affectedRoute: '/api/engineering/queue',
    evidence: [item.description].filter(Boolean),
    dependencyChain: ['Engineering queue', item.sourceType],
    suggestedFiles: ['lib/queues/queueIntelligence.ts'],
    validationCommands: ['GET /api/engineering/queue'],
    approvalState: item.approvalRequired ? 'approval_required' : 'not_required',
    repairPacketAvailable: item.sourceType === 'schema_repair' || item.sourceType === 'runtime_repair',
  }))
}

function repairItemsFromCouncilPackets(): RepairIntelligenceItem[] {
  const snapshot = getRepairSnapshot()
  return (snapshot.packets ?? []).slice(0, 6).map(packet => ({
    id: `council-repair:${packet.id}`,
    title: packet.title,
    issueType: 'council_repair_packet',
    section: 'repair_queue' as const,
    severity: 'MEDIUM' as const,
    affectedPanel: packet.affectedPanelRoute || 'Engineering · Repair Packet',
    affectedRoute: '/api/council/repair-packet',
    evidence: packet.evidence.slice(0, 4).length ? packet.evidence.slice(0, 4) : [packet.concreteIssue],
    dependencyChain: ['Council repair decree', 'Manual Cursor handoff'],
    suggestedFiles: packet.filesRoutesToInspect,
    validationCommands: [...packet.validationCommands],
    approvalState: 'approval_required' as RepairApprovalState,
    repairPacketAvailable: true,
    cursorCommand: packet.cursorReadyPrompt,
  }))
}

function rssMissingConfig(rss: Awaited<ReturnType<typeof getRssIngestionRuntimeStatus>>): MissingConfigItem[] {
  const items: MissingConfigItem[] = []
  if (rss.enabledFeedCount === 0 && rss.configuredFeedCount === 0) {
    items.push({
      id: 'rss:no-feeds',
      name: 'RSS feeds not configured',
      category: 'rss_source',
      status: 'missing',
      severity: 'HIGH',
      affectedFeature: 'News Intel',
      affectedPanel: 'Live Environment · News',
      reason: 'No enabled RSS sources are registered for server-side polling.',
      requiredFix: 'Configure NEWS_RSS_FEEDS or register feeds in signal sources persistence.',
      repairPacketAvailable: false,
    })
  }
  const staleMs = rss.pollIntervalMinutes * 60_000 * 2
  const lastPoll = rss.lastPollAt ? Date.parse(rss.lastPollAt) : NaN
  const pollStale = !rss.lastPollAt || (Number.isFinite(lastPoll) && Date.now() - lastPoll > staleMs)
  if (rss.enabledFeedCount > 0 && pollStale) {
    items.push({
      id: 'rss:cron-stale',
      name: 'RSS poll schedule stale',
      category: 'cron',
      status: 'degraded',
      severity: 'HIGH',
      affectedFeature: 'News Intel',
      affectedPanel: 'Signal Radar · RSS',
      reason: rss.lastPollAt
        ? `Last RSS poll at ${rss.lastPollAt} exceeds ${rss.pollIntervalMinutes * 2}m threshold.`
        : 'No successful RSS poll timestamp recorded.',
      requiredFix: 'RSS cron not scheduled — News Intel will not refresh automatically. Schedule POST /api/signals/rss/poll with WAR_ROOM_RSS_POLL_SECRET.',
      repairPacketAvailable: false,
    })
  }
  for (const feed of rss.feeds.filter(entry => entry.health !== 'healthy' && entry.enabled)) {
    items.push({
      id: `rss:feed:${feed.sourceId}`,
      name: `${feed.label} feed degraded`,
      category: 'rss_source',
      status: feed.health === 'unavailable' ? 'failed' : 'degraded',
      severity: feed.health === 'unavailable' ? 'HIGH' : 'MEDIUM',
      affectedFeature: 'News Intel',
      affectedPanel: 'Live Environment · News',
      reason: feed.lastErrorMessage
        ? sanitizeSchemaError(feed.lastErrorMessage)
        : feed.staleFeedDetection
          ? 'Feed marked stale by ingestion runtime.'
          : 'Feed has not returned a successful poll.',
      requiredFix: 'Verify feed URL, provider reachability, and RSS poll schedule.',
      repairPacketAvailable: false,
    })
  }
  return items
}

function paymentMissingConfig(): MissingConfigItem[] {
  return getPaymentProviderReadiness()
    .filter(provider => provider.status === 'not_configured' && provider.id !== 'manual_proof' && provider.id !== 'ach_placeholder')
    .map(provider => ({
      id: `payment:${provider.id}`,
      name: `${provider.name} not configured`,
      category: 'payment' as const,
      status: 'missing' as const,
      severity: 'MEDIUM' as const,
      affectedFeature: 'Revenue deposits',
      affectedPanel: 'Payments',
      reason: provider.notes,
      requiredFix: `Configure ${provider.id} env credentials for deposit visibility (no auto-charge).`,
      repairPacketAvailable: false,
    }))
}

function pickNextAction(items: RepairIntelligenceItem[]): RepairIntelligenceItem | null {
  const ranked = sortBySeverity(items)
  return ranked[0] ?? null
}

export async function collectRepairIntelligence(req: Request): Promise<RepairIntelligenceSnapshot> {
  const generatedAt = new Date().toISOString()
  const sources: RepairIntelligenceSnapshot['sources'] = []

  let canonical: Awaited<ReturnType<typeof collectCanonicalRuntimeStatus>>
  let schema: SchemaSweepApiResponse | null = null
  let rss: Awaited<ReturnType<typeof getRssIngestionRuntimeStatus>> | null = null
  let deck: Awaited<ReturnType<typeof collectOperatorDeck>> | null = null
  let engineering: Awaited<ReturnType<typeof collectQueueSnapshot>> | null = null

  try {
    canonical = await collectCanonicalRuntimeStatus(req)
    sources.push({ id: 'canonical-status', label: 'Canonical runtime', status: 'ok' })
  } catch {
    sources.push({ id: 'canonical-status', label: 'Canonical runtime', status: 'error' })
    throw new Error('Canonical runtime status unavailable.')
  }

  const configuration = buildConfigurationSweep()
  sources.push({ id: 'configuration-sweep', label: 'Configuration sweep', status: 'ok' })

  try {
    schema = await runSchemaSweepApi()
    sources.push({
      id: 'schema-sweep',
      label: 'Schema sweep',
      status: schema.status === 'error' ? 'error' : schema.status === 'healthy' ? 'ok' : 'degraded',
    })
  } catch {
    sources.push({ id: 'schema-sweep', label: 'Schema sweep', status: 'error' })
  }

  try {
    rss = await getRssIngestionRuntimeStatus()
    sources.push({
      id: 'rss-status',
      label: 'RSS ingestion',
      status: rss.aggregateHealth === 'healthy' ? 'ok' : rss.aggregateHealth === 'unknown' ? 'degraded' : 'degraded',
    })
  } catch {
    sources.push({ id: 'rss-status', label: 'RSS ingestion', status: 'error' })
  }

  try {
    deck = await collectOperatorDeck(req)
    sources.push({
      id: 'operator-deck',
      label: 'Operator deck',
      status: deck.persistenceAvailable ? 'ok' : 'degraded',
    })
  } catch {
    sources.push({ id: 'operator-deck', label: 'Operator deck', status: 'error' })
  }

  try {
    engineering = await collectQueueSnapshot(req, 'engineering_queue')
    sources.push({ id: 'engineering-queue', label: 'Engineering queue', status: 'ok' })
  } catch {
    sources.push({ id: 'engineering-queue', label: 'Engineering queue', status: 'error' })
  }

  const signalSources = getSignalSources()
  const missingConfiguration = sortBySeverity([
    ...missingConfigFromProviders(configuration.providers),
    ...(schema ? missingConfigFromSchema(schema) : []),
    ...(rss ? rssMissingConfig(rss) : []),
    ...paymentMissingConfig(),
  ])

  const providerIssues = repairItemsFromCanonical(canonical)
  const schemaDrift = schema ? repairItemsFromSchema(schema) : []
  const runtimeDegradation = providerIssues.filter(item => item.section === 'runtime_degradation')
  const providerOnly = providerIssues.filter(item => item.section === 'provider_issues')
  const requiredMigrations = schemaDrift.filter(item => item.section === 'required_migrations')
  const schemaOnly = schemaDrift.filter(item => item.section === 'schema_drift')
  const repairQueue = sortBySeverity([
    ...repairItemsFromCouncilPackets(),
    ...(engineering ? repairItemsFromQueues(engineering) : []),
  ])

  const systemReadiness: RepairIntelligenceItem[] = [
    {
      id: 'readiness:overall',
      title: `Runtime health: ${canonical.summary.health}`,
      issueType: 'system_readiness',
      section: 'system_readiness',
      severity: canonical.summary.health === 'healthy' ? 'INFO' : canonical.summary.health === 'degraded' ? 'MEDIUM' : 'BLOCKER',
      affectedPanel: 'War Room Evolution',
      affectedRoute: '/api/evolution/repair-intelligence',
      evidence: [
        `Confidence ${canonical.summary.confidence}%`,
        ...canonical.summary.degradedSubsystems.map(id => `Degraded subsystem: ${id}`),
        ...canonical.summary.unavailableSubsystems.map(id => `Unavailable subsystem: ${id}`),
      ],
      dependencyChain: canonical.subsystems.map(subsystem => subsystem.label),
      suggestedFiles: ['lib/runtime/canonicalStatus.ts'],
      validationCommands: ['GET /api/runtime/canonical-status'],
      approvalState: 'not_required',
      repairPacketAvailable: Boolean(schema?.repairPacketAvailable),
    },
  ]

  const allActionable = sortBySeverity([
    ...missingConfiguration.map(item => ({
      id: `missing:${item.id}`,
      title: item.name,
      issueType: item.category,
      section: 'missing_configuration' as RepairIntelligenceSection,
      severity: item.severity,
      affectedPanel: item.affectedPanel ?? 'Configuration',
      evidence: [item.reason],
      dependencyChain: [item.affectedFeature],
      suggestedFiles: item.envVarNames?.length ? ['.env.local', 'lib/configuration/configurationRegistry.ts'] : [],
      validationCommands: ['GET /api/configuration/sweep'],
      approvalState: 'not_required' as RepairApprovalState,
      repairPacketAvailable: item.repairPacketAvailable,
    })),
    ...providerOnly,
    ...requiredMigrations,
    ...schemaOnly,
    ...runtimeDegradation,
    ...repairQueue,
  ])

  const nextRequiredAction = pickNextAction(allActionable)
  const operatorReport = nextRequiredAction
    ? buildRepairIntelligenceOperatorNextSteps({
        title: nextRequiredAction.title,
        affectedPanel: nextRequiredAction.affectedPanel,
        affectedRoute: nextRequiredAction.affectedRoute,
        validationCommands: nextRequiredAction.validationCommands,
        envVarNames: missingConfiguration.find(item => item.name === nextRequiredAction.title)?.envVarNames,
        suggestedSqlMigration: nextRequiredAction.suggestedSqlMigration,
        repairPacketAvailable: nextRequiredAction.repairPacketAvailable,
      })
    : buildRepairIntelligenceOperatorNextSteps({
        title: 'No blocker detected in current snapshot',
        affectedPanel: 'War Room Evolution',
        validationCommands: ['GET /api/evolution/repair-intelligence'],
        repairPacketAvailable: false,
      })
  const operatorNextStepsMarkdown = formatOperatorNextStepsMarkdown(operatorReport)

  const nextSection: RepairIntelligenceItem[] = nextRequiredAction
    ? [{ ...nextRequiredAction, section: 'next_required_action' }]
    : [{
        id: 'next:none',
        title: 'No blocker detected in current snapshot',
        issueType: 'clear',
        section: 'next_required_action',
        severity: 'INFO',
        affectedPanel: 'War Room Evolution',
        evidence: ['All source-backed checks returned without BLOCKER severity items.'],
        dependencyChain: [],
        suggestedFiles: [],
        validationCommands: ['GET /api/evolution/repair-intelligence'],
        approvalState: 'not_required',
        repairPacketAvailable: false,
      }]

  const scores = computeReadinessScores({
    canonical,
    configuration,
    schema,
    rss,
    deck,
    payments: getPaymentProviderReadiness(),
    configuredSources: signalSources.filter(source => source.configured).length,
    totalSources: signalSources.length,
  })

  const sections: Record<RepairIntelligenceSection, RepairIntelligenceItem[]> = {
    system_readiness: systemReadiness,
    missing_configuration: allActionable.filter(item => item.section === 'missing_configuration'),
    required_migrations: requiredMigrations,
    provider_issues: providerOnly,
    schema_drift: schemaOnly,
    runtime_degradation: runtimeDegradation,
    repair_queue: repairQueue,
    next_required_action: nextSection,
  }

  return {
    generatedAt,
    scores,
    missingConfiguration,
    sections,
    nextRequiredAction,
    operatorNextSteps: operatorReport,
    operatorNextStepsMarkdown,
    repairQueue,
    sources,
    guardrails: {
      exposesSecrets: false,
      browserDbMutation: false,
      fakeConfiguredStates: false,
      fakeRepairedStates: false,
    },
  }
}
