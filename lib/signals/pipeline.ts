import 'server-only'

import type { SignalAlert, SignalRawItem, SignalScan, SignalSnapshot } from './model'
import { persistSignalScan } from './persistence'
import { runFirecrawlOrDirectSources, runNewsProviders, runRssSources, runTavilySignalSearch } from './providers'
import { applySignalClassificationPipeline } from './classification'
import { dedupeAndRankSignals, scoreSignalItem } from './scoring'
import { buildSignalSnapshot } from './snapshot'
import { getSignalSources } from './sources'

function scanId(startedAt: string): string {
  return `signal-scan-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function alertsForDiagnostics(diagnostics: Record<string, unknown>): SignalAlert[] {
  const alerts: SignalAlert[] = []
  for (const [provider, detail] of Object.entries(diagnostics)) {
    if (!detail || typeof detail !== 'object') continue
    const record = detail as Record<string, unknown>
    const configured = record.configured ?? record.newsapiConfigured ?? record.guardianConfigured
    const firstError = typeof record.firstError === 'string' ? record.firstError : null
    if (configured === false) {
      alerts.push({
        id: `${provider}-not-configured`,
        severity: 'watch',
        title: `${provider} unavailable`,
        summary: `${provider} did not run because its cloud provider configuration is missing.`,
        sourceAttribution: 'Signal source configuration',
        approvalRequired: true,
        canExecute: false,
      })
    } else if (firstError) {
      alerts.push({
        id: `${provider}-partial-error`,
        severity: 'watch',
        title: `${provider} partial scan issue`,
        summary: firstError,
        sourceAttribution: 'Signal provider diagnostics',
        approvalRequired: true,
        canExecute: false,
      })
    }
  }
  return alerts
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function freshnessSummary(
  completedAt: string,
  diagnostics: Record<string, unknown>,
  resultCount: number,
): SignalScan['freshnessSummary'] {
  let maxAgeDays = 14
  let staleDiscardedCount = 0
  let unknownDateDiscardedCount = 0
  let liveCount = 0
  let recentCount = 0
  let oldestAcceptedAgeDays: number | null = null

  for (const detail of Object.values(diagnostics)) {
    if (!detail || typeof detail !== 'object') continue
    const record = detail as Record<string, unknown>
    const providerMaxAgeDays = nullableNumberField(record, 'maxAgeDays')
    if (providerMaxAgeDays !== null) maxAgeDays = Math.max(maxAgeDays, providerMaxAgeDays)
    staleDiscardedCount += numberField(record, 'staleDiscardedCount')
    unknownDateDiscardedCount += numberField(record, 'unknownDateDiscardedCount')
    liveCount += numberField(record, 'liveCount')
    recentCount += numberField(record, 'recentCount')
    const oldest = nullableNumberField(record, 'oldestAcceptedAgeDays')
    if (oldest !== null) oldestAcceptedAgeDays = oldestAcceptedAgeDays === null ? oldest : Math.max(oldestAcceptedAgeDays, oldest)
  }

  return {
    latestScanTime: completedAt,
    maxAgeDays,
    freshResultCount: resultCount,
    staleDiscardedCount,
    unknownDateDiscardedCount,
    oldestAcceptedAgeDays,
    oldestStoredAgeDays: oldestAcceptedAgeDays,
    liveCount,
    recentCount,
    cacheFilteredCount: 0,
  }
}

export async function runSignalScan(): Promise<SignalSnapshot> {
  const startedAt = new Date().toISOString()
  const id = scanId(startedAt)
  const sources = getSignalSources()
  const diagnostics: Record<string, unknown> = {}
  const rawItems: SignalRawItem[] = []

  const [tavily, rss, news, extracted] = await Promise.allSettled([
    runTavilySignalSearch(startedAt),
    runRssSources(sources, startedAt),
    runNewsProviders(startedAt),
    runFirecrawlOrDirectSources(sources.filter(source => source.url), startedAt),
  ])

  for (const [provider, result] of [
    ['tavily', tavily],
    ['rss', rss],
    ['news', news],
    ['firecrawl_or_source_url', extracted],
  ] as const) {
    if (result.status === 'fulfilled') {
      diagnostics[provider] = result.value.diagnostics
      rawItems.push(...result.value.items)
    } else {
      diagnostics[provider] = { configured: true, resultCount: 0, firstError: errorMessage(result.reason) }
    }
  }

  const scored = dedupeAndRankSignals(rawItems.map(item => scoreSignalItem(item, id))).slice(0, 40)
  const classified = applySignalClassificationPipeline(scored, { sources })
  const results = classified.results
  const completedAt = new Date().toISOString()
  const scanFreshnessSummary = freshnessSummary(completedAt, diagnostics, results.length)
  const scan: SignalScan = {
    id,
    status: results.length ? (Object.values(diagnostics).some(value => typeof value === 'object' && value && 'firstError' in value && (value as { firstError?: unknown }).firstError) ? 'partial' : 'completed') : 'failed',
    startedAt,
    completedAt,
    sourceCount: sources.filter(source => source.configured).length,
    resultCount: results.length,
    freshnessSummary: scanFreshnessSummary,
    providerDiagnostics: {
      ...diagnostics,
      classification: classified.diagnostics,
    },
    error: results.length ? null : 'No configured cloud source returned source-backed signal results.',
  }
  const alerts = alertsForDiagnostics(diagnostics)
  const persistence = await persistSignalScan({ sources, scan, results, alerts })

  return buildSignalSnapshot({
    generatedAt: completedAt,
    persistenceAvailable: persistence.persistenceAvailable,
    persistenceNote: persistence.persistenceNote,
    sources,
    latestScan: scan,
    results,
    alerts,
    classificationDiagnostics: classified.diagnostics,
  })
}
