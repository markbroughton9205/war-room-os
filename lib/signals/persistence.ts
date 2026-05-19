import 'server-only'

import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import type { SignalAlert, SignalResult, SignalScan, SignalSnapshot, SignalSourceDefinition } from './model'
import { getSignalSources } from './sources'
import { buildSignalSnapshot } from './snapshot'
import {
  activePublishedAtCutoff,
  collectCacheFreshnessDiagnostics,
  enrichSignalResult,
  evaluateFreshness,
  isActiveSignalResult,
  publicationDateFromMetadata,
} from './freshness'

type Row = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function freshnessSummary(value: unknown): SignalScan['freshnessSummary'] | undefined {
  const record = objectValue(value)
  if (!Object.keys(record).length) return undefined
  const nullableNum = (key: string): number | null => {
    const item = record[key]
    return typeof item === 'number' && Number.isFinite(item) ? item : null
  }
  return {
    latestScanTime: text(record.latestScanTime, new Date().toISOString()),
    maxAgeDays: num(record.maxAgeDays, 14),
    freshResultCount: num(record.freshResultCount, 0),
    staleDiscardedCount: num(record.staleDiscardedCount, 0),
    unknownDateDiscardedCount: num(record.unknownDateDiscardedCount, 0),
    oldestAcceptedAgeDays: nullableNum('oldestAcceptedAgeDays'),
    oldestStoredAgeDays: nullableNum('oldestStoredAgeDays'),
    liveCount: num(record.liveCount, 0),
    recentCount: num(record.recentCount, 0),
    cacheFilteredCount: num(record.cacheFilteredCount, 0),
  }
}

function signalMigrationRequired(message: string): boolean {
  return /schema cache|could not find table|relation .*war_room_signal_|war_room_signal_sources/i.test(message)
}

function publishedAtColumnMissing(message: string): boolean {
  return /published_at|column .* does not exist/i.test(message)
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function mapSource(row: Row): SignalSourceDefinition {
  return {
    id: text(row.id),
    label: text(row.label),
    provider: text(row.provider, 'manual_registry') as SignalSourceDefinition['provider'],
    kind: text(row.kind, 'manual_registry') as SignalSourceDefinition['kind'],
    categories: arrayValue(row.categories) as SignalSourceDefinition['categories'],
    url: nullableText(row.url),
    query: nullableText(row.query),
    configured: bool(row.configured),
    reliabilityScore: num(row.reliability_score, 0),
    notes: text(row.notes),
  }
}

function mapScan(row: Row): SignalScan {
  const providerDiagnostics = objectValue(row.provider_diagnostics)
  return {
    id: text(row.id),
    status: text(row.status, 'failed') as SignalScan['status'],
    startedAt: text(row.started_at, new Date().toISOString()),
    completedAt: text(row.completed_at, new Date().toISOString()),
    sourceCount: num(row.source_count, 0),
    resultCount: num(row.result_count, 0),
    freshnessSummary: freshnessSummary(providerDiagnostics.freshnessSummary),
    providerDiagnostics,
    error: nullableText(row.error),
  }
}

function publishedAtForRow(row: Row, metadata: Record<string, unknown>): string | null {
  const column = nullableText(row.published_at)
  if (column) return column
  const freshness = evaluateFreshness(publicationDateFromMetadata(metadata), { provider: text(row.provider, 'manual_registry') as SignalResult['provider'] })
  return freshness.publishedAt
}

function mapResult(row: Row): SignalResult {
  const metadata = objectValue(row.metadata)
  const provider = text(row.provider, 'manual_registry') as SignalResult['provider']
  const publishedAt = publishedAtForRow(row, metadata)
  const base: SignalResult = {
    id: text(row.id),
    scanId: nullableText(row.scan_id),
    title: text(row.title),
    source: text(row.source),
    provider,
    sourceKind: text(row.source_kind, 'manual_registry') as SignalResult['sourceKind'],
    url: text(row.url),
    summary: text(row.summary),
    category: text(row.category, 'SMB_automation') as SignalResult['category'],
    scores: {
      relevance: num(row.relevance_score, 0),
      incomePotential: num(row.income_potential_score, 0),
      urgency: num(row.urgency_score, 0),
      confidence: num(row.confidence_score, 0),
      startupCost: num(row.startup_cost_score, 0),
      timeToProfit: num(row.time_to_profit_score, 0),
      repeatability: num(row.repeatability_score, 0),
      strategicAlignment: num(row.strategic_alignment_score, 0),
      familyImpact: num(row.family_impact_score, 0),
      highestLeverage: num(row.highest_leverage_score, 0),
    },
    startupCostEstimate: text(row.startup_cost_estimate),
    timeToProfitEstimate: text(row.time_to_profit_estimate),
    recommendedNextAction: text(row.recommended_next_action),
    assignedBabyFamily: text(row.assigned_baby_family, 'Analyst Baby') as SignalResult['assignedBabyFamily'],
    approvalStatus: text(row.approval_status, 'pending_review') as SignalResult['approvalStatus'],
    capturedAt: text(row.captured_at, new Date().toISOString()),
    metadata: publishedAt && !metadata.publishedAt ? { ...metadata, publishedAt } : metadata,
    guardrails: {
      sourceBacked: true,
      recommendationOnly: true,
      approvalRequired: true,
      externalExecutionAllowed: false,
      hiddenExecutionAllowed: false,
      incomeClaimed: false,
    },
  }
  return enrichSignalResult(base)
}

function mapAlert(row: Row): SignalAlert {
  return {
    id: text(row.id),
    severity: text(row.severity, 'info') as SignalAlert['severity'],
    title: text(row.title),
    summary: text(row.summary),
    sourceAttribution: text(row.source_attribution),
    approvalRequired: true,
    canExecute: false,
  }
}

function rowFreshnessFields(result: SignalResult): {
  published_at: string | null
  source_status: string
  freshness_status: string
  operational_status: string
} {
  return {
    published_at: typeof result.metadata.publishedAt === 'string' ? result.metadata.publishedAt : null,
    source_status: text(result.metadata.sourceStatus, 'UNKNOWN'),
    freshness_status: text(result.metadata.freshnessStatus, 'UNKNOWN_DATE'),
    operational_status: text(result.metadata.operationalStatus, 'EXCLUDED'),
  }
}

async function upsertSources(client: WarRoomSupabase, sources: SignalSourceDefinition[]) {
  const { error } = await client
    .from('war_room_signal_sources')
    .upsert(sources.map(source => ({
      id: source.id,
      label: source.label,
      provider: source.provider,
      kind: source.kind,
      categories: source.categories,
      url: source.url,
      query: source.query,
      configured: source.configured,
      reliability_score: source.reliabilityScore,
      notes: source.notes,
    })), { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

async function insertScan(client: WarRoomSupabase, scan: SignalScan) {
  const { error } = await client
    .from('war_room_signal_scans')
    .insert({
      id: scan.id,
      status: scan.status,
      started_at: scan.startedAt,
      completed_at: scan.completedAt,
      source_count: scan.sourceCount,
      result_count: scan.resultCount,
      provider_diagnostics: {
        ...scan.providerDiagnostics,
        freshnessSummary: scan.freshnessSummary,
      },
      error: scan.error,
      approval_required: true,
      external_execution_performed: false,
      hidden_execution_performed: false,
    })
  if (error) throw new Error(error.message)
}

async function insertResults(client: WarRoomSupabase, results: SignalResult[]) {
  if (!results.length) return
  const enriched = results.map(result => enrichSignalResult(result))
  const { error } = await client
    .from('war_room_signal_results')
    .upsert(enriched.map(result => ({
      id: result.id,
      scan_id: result.scanId,
      title: result.title,
      source: result.source,
      provider: result.provider,
      source_kind: result.sourceKind,
      url: result.url,
      summary: result.summary,
      category: result.category,
      relevance_score: result.scores.relevance,
      income_potential_score: result.scores.incomePotential,
      urgency_score: result.scores.urgency,
      confidence_score: result.scores.confidence,
      startup_cost_score: result.scores.startupCost,
      time_to_profit_score: result.scores.timeToProfit,
      repeatability_score: result.scores.repeatability,
      strategic_alignment_score: result.scores.strategicAlignment,
      family_impact_score: result.scores.familyImpact,
      highest_leverage_score: result.scores.highestLeverage,
      startup_cost_estimate: result.startupCostEstimate,
      time_to_profit_estimate: result.timeToProfitEstimate,
      recommended_next_action: result.recommendedNextAction,
      assigned_baby_family: result.assignedBabyFamily,
      approval_status: result.approvalStatus,
      captured_at: result.capturedAt,
      source_backed: true,
      recommendation_only: true,
      approval_required: true,
      external_execution_allowed: false,
      hidden_execution_allowed: false,
      income_claimed: false,
      metadata: result.metadata,
      ...rowFreshnessFields(result),
    })), { onConflict: 'id' })
  if (error) throw new Error(error.message)

  const { error: scoreError } = await client
    .from('war_room_signal_scores')
    .insert(enriched.map(result => ({
      result_id: result.id,
      scan_id: result.scanId,
      category: result.category,
      relevance_score: result.scores.relevance,
      income_potential_score: result.scores.incomePotential,
      urgency_score: result.scores.urgency,
      confidence_score: result.scores.confidence,
      startup_cost_score: result.scores.startupCost,
      time_to_profit_score: result.scores.timeToProfit,
      repeatability_score: result.scores.repeatability,
      strategic_alignment_score: result.scores.strategicAlignment,
      family_impact_score: result.scores.familyImpact,
      highest_leverage_score: result.scores.highestLeverage,
      rationale: 'Highest leverage weighs income potential, speed to action, low startup cost, repeatability, strategic alignment, family impact, and confidence.',
      approval_required: true,
      can_execute: false,
    })))
  if (scoreError) throw new Error(scoreError.message)
}

async function insertAlerts(client: WarRoomSupabase, scanId: string, alerts: SignalAlert[]) {
  if (!alerts.length) return
  const { error } = await client
    .from('war_room_signal_alerts')
    .insert(alerts.map(alert => ({
      scan_id: scanId,
      severity: alert.severity,
      title: alert.title,
      summary: alert.summary,
      source_attribution: alert.sourceAttribution,
      approval_required: true,
      can_execute: false,
    })))
  if (error) throw new Error(error.message)
}

async function fetchActiveSignalRows(client: WarRoomSupabase, limit: number): Promise<{ rows: Row[]; usedDbFreshnessGate: boolean }> {
  const cutoff = activePublishedAtCutoff()
  const gated = await client
    .from('war_room_signal_results')
    .select('*')
    .gte('published_at', cutoff)
    .eq('operational_status', 'ACTIONABLE')
    .order('highest_leverage_score', { ascending: false })
    .limit(limit)

  if (!gated.error) return { rows: (gated.data ?? []) as Row[], usedDbFreshnessGate: true }

  if (!publishedAtColumnMissing(gated.error.message)) throw new Error(gated.error.message)

  const fallback = await client
    .from('war_room_signal_results')
    .select('*')
    .order('highest_leverage_score', { ascending: false })
    .limit(Math.max(limit, 80))

  if (fallback.error) throw new Error(fallback.error.message)
  return { rows: (fallback.data ?? []) as Row[], usedDbFreshnessGate: false }
}

export async function persistSignalScan(input: {
  sources: SignalSourceDefinition[]
  scan: SignalScan
  results: SignalResult[]
  alerts: SignalAlert[]
}): Promise<{ persistenceAvailable: boolean; persistenceNote: string }> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; live scan returned but was not persisted: ${supabase.configError}`,
    }
  }

  await upsertSources(supabase.client, input.sources)
  await insertScan(supabase.client, input.scan)
  await insertResults(supabase.client, input.results)
  await insertAlerts(supabase.client, input.scan.id, input.alerts)

  return {
    persistenceAvailable: true,
    persistenceNote: 'Signal sources, scan, results, scores, and alerts persisted through a server-only route.',
  }
}

export async function listPersistedSignalSnapshot(limit = 40): Promise<SignalSnapshot> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return buildSignalSnapshot({
      generatedAt,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}`,
      migrationStatus: 'UNAVAILABLE',
      sources: getSignalSources(),
      latestScan: null,
      results: [],
      alerts: [],
    })
  }

  const [sources, scans, resultsQuery, alerts] = await Promise.all([
    supabase.client.from('war_room_signal_sources').select('*').order('label', { ascending: true }),
    supabase.client.from('war_room_signal_scans').select('*').order('completed_at', { ascending: false }).limit(1),
    fetchActiveSignalRows(supabase.client, limit),
    supabase.client.from('war_room_signal_alerts').select('*').order('created_at', { ascending: false }).limit(limit),
  ])

  const firstError = [sources.error, scans.error, alerts.error].find(Boolean)
  if (firstError) {
    const migrationRequired = signalMigrationRequired(firstError.message)
    return buildSignalSnapshot({
      generatedAt,
      persistenceAvailable: !migrationRequired,
      persistenceNote: migrationRequired
        ? `MIGRATION_REQUIRED: Phase 14 signal tables are missing from Supabase schema cache. Apply supabase/war_room_phase14_signals.sql or the phase17 patch, then reload PostgREST schema.`
        : `Signal tables unavailable: ${firstError.message}`,
      migrationStatus: migrationRequired ? 'MIGRATION_REQUIRED' : 'UNAVAILABLE',
      sources: getSignalSources(),
      latestScan: null,
      results: [],
      alerts: [],
    })
  }

  const mappedStored = resultsQuery.rows.map(mapResult)
  const activeResults = mappedStored.filter(result => (
    isActiveSignalResult(result)
    && result.url.startsWith('https://')
    && result.guardrails.sourceBacked
  ))
  const cacheDiagnostics = collectCacheFreshnessDiagnostics(mappedStored, activeResults)

  return buildSignalSnapshot({
    generatedAt,
    persistenceAvailable: true,
    persistenceNote: resultsQuery.usedDbFreshnessGate
      ? 'Signal persistence is available; active results gated at query level by published_at.'
      : 'Signal persistence is available; apply supabase/war_room_phase26_signal_freshness.sql for DB-level published_at gating.',
    migrationStatus: 'READY',
    sources: ((sources.data ?? []) as Row[]).map(mapSource),
    latestScan: ((scans.data ?? []) as Row[]).map(mapScan)[0] ?? null,
    results: activeResults,
    alerts: ((alerts.data ?? []) as Row[]).map(mapAlert),
    cacheDiagnostics,
  })
}
