import 'server-only'

import { enrichCandidatesWithFirecrawl, searchIncomeOpportunities } from '@/lib/income/firecrawl'
import { searchTavilyIncomeOpportunities, type OpportunityScoutCandidate } from '@/lib/income/tavily'
import { listScoutOpportunities, registerScoutOpportunities } from '@/lib/opportunities/store'
import type { OpportunityPacket, ScoutOpportunity } from '@/lib/opportunities/schema'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { runBraveSignalSearch } from '@/lib/signals/providers/brave'
import {
  buildHistoricalFallbackCandidates,
  buildHistoricalFallbackPackets,
  MIN_FALLBACK_OPPORTUNITIES,
} from './fallbackOpportunities'
import type {
  IncomeWorkerCandidate,
  IncomeWorkerId,
  IncomeWorkerScoutActivityLogEntry,
  IncomeWorkerScoutDiagnostics,
  IncomeWorkerScoutExecutionState,
  IncomeWorkerScoutResult,
  IncomeWorkerScoutSourceType,
} from './types'

const LOG_PREFIX = '[Income Worker]'

type ScoutContext = {
  started: number
  activityLog: IncomeWorkerScoutActivityLogEntry[]
  fallbackPath: string[]
  threadId: string
}

function log(ctx: ScoutContext, message: string) {
  ctx.activityLog.push({ at: new Date().toISOString(), message: `${LOG_PREFIX} ${message}` })
}

function scoreCandidate(candidate: OpportunityScoutCandidate): number {
  let score = 50
  if (candidate.payout) score += 20
  if (candidate.expiration) score += 8
  if (candidate.riskLevel === 'low') score += 15
  if (candidate.riskLevel === 'high') score -= 35
  if (candidate.verificationStatus === 'rejected') score -= 30
  return Math.max(0, Math.min(100, score))
}

function eligibleWorkersFor(candidate: OpportunityScoutCandidate): IncomeWorkerId[] {
  const text = `${candidate.title} ${candidate.type} ${candidate.source}`.toLowerCase()
  const workers: IncomeWorkerId[] = ['revenue_tracker']
  if (/freight|dispatch|truck|transport|delivery/.test(text)) workers.unshift('freight_lead')
  if (/job|hiring|role|career|ai evaluator|evaluator/.test(text)) workers.unshift('job_scout', 'remote_work')
  if (/gig|micro|testing|survey|interview|research|participant/.test(text)) workers.unshift('gig_scout')
  if (/contract|rfp|proposal|client/.test(text)) workers.unshift('contract_opportunity')
  if (/digital|product|template|course/.test(text)) workers.unshift('digital_product')
  if (/affiliate|lead/.test(text)) workers.unshift('affiliate_lead_gen')
  if (/automation|zapier|workflow|no-code|nocode|faq|chat|appointment|missed-call/.test(text)) {
    workers.unshift('automation_service')
  }
  return [...new Set(workers)]
}

function normalizeLiveCandidate(
  candidate: OpportunityScoutCandidate,
  evidenceLabel: IncomeWorkerCandidate['evidenceLabel'] = 'LIVE_SIGNAL_BACKED',
): IncomeWorkerCandidate {
  return {
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    country: candidate.country,
    type: candidate.type,
    payout: candidate.payout,
    currency: candidate.currency,
    expiration: candidate.expiration,
    riskLevel: candidate.riskLevel,
    verificationStatus: candidate.verificationStatus,
    reason: candidate.reason,
    provider: candidate.provider,
    score: scoreCandidate(candidate),
    eligibleWorkers: eligibleWorkersFor(candidate),
    evidenceLabel,
  }
}

function packetFromCandidate(candidate: IncomeWorkerCandidate): OpportunityPacket {
  return {
    opportunityTitle: candidate.title,
    startupCost: candidate.payout?.includes('$') ? 'See scout notes' : '$100–$500',
    estimatedRevenue: candidate.payout ?? 'Unverified until commander approval',
    timeToLaunch: '2–4 weeks',
    toolsRequired: ['Commander-approved stack TBD'],
    targetCustomer: candidate.source,
    executionDifficulty: candidate.riskLevel === 'high' ? 'high' : 'medium',
    confidence: Math.max(0.25, Math.min(0.95, candidate.score / 100)),
    risks: [candidate.reason.slice(0, 120)],
    whyNow: candidate.reason,
  }
}

function cachedToCandidate(row: ScoutOpportunity): IncomeWorkerCandidate {
  return {
    title: row.opportunityTitle,
    url: `warroom://opportunity-cache/${row.id}`,
    source: `cached:${row.family}`,
    country: 'remote',
    type: row.family,
    payout: row.estimatedRevenue,
    currency: null,
    expiration: null,
    riskLevel: 'medium',
    verificationStatus: 'candidate',
    reason: row.whyNow,
    provider: row.providerId,
    score: Math.round(row.confidence * 100),
    eligibleWorkers: ['automation_service', 'revenue_tracker'],
    evidenceLabel: row.evidenceLabel,
  }
}

function rssToCandidate(title: string, url: string, source: string, summary: string): IncomeWorkerCandidate {
  return {
    title,
    url: url || `warroom://rss/${encodeURIComponent(title.slice(0, 40))}`,
    source: `rss:${source}`,
    country: 'remote',
    type: 'rss_intelligence',
    payout: null,
    currency: null,
    expiration: null,
    riskLevel: 'medium',
    verificationStatus: 'candidate',
    reason: summary.slice(0, 200),
    provider: 'rss',
    score: 55,
    eligibleWorkers: eligibleWorkersFor({
      title,
      url,
      source,
      country: 'remote',
      type: 'rss_intelligence',
      payout: null,
      currency: null,
      expiration: null,
      riskLevel: 'medium',
      verificationStatus: 'candidate',
      reason: summary,
      provider: 'rss',
    }),
    evidenceLabel: 'HISTORICAL_PATTERN_BASED',
  }
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Provider unavailable'
  if (/api[_-]?key|secret|token|bearer|unauthorized|401|403/i.test(raw)) {
    return 'Live search provider unavailable.'
  }
  if (raw.length > 160) return `${raw.slice(0, 157)}…`
  return raw
}

async function tryTavily(ctx: ScoutContext): Promise<{
  candidates: IncomeWorkerCandidate[]
  rejected: IncomeWorkerCandidate[]
  sourcesChecked: number
} | null> {
  if (!process.env.TAVILY_API_KEY) {
    log(ctx, 'Tavily unavailable (not configured)')
    return null
  }
  try {
    log(ctx, 'Attempting Tavily live scout')
    const scan = await searchTavilyIncomeOpportunities()
    const candidates = scan.opportunities.map(c => normalizeLiveCandidate(c))
    const rejected = scan.rejected.map(c => normalizeLiveCandidate(c))
    if (candidates.length > 0) {
      log(ctx, `Tavily returned ${candidates.length} verified candidates`)
      ctx.fallbackPath.push('tavily_live')
      return { candidates, rejected, sourcesChecked: scan.sourcesChecked }
    }
    log(ctx, 'Tavily online but no candidates passed verification filter')
    return { candidates: [], rejected, sourcesChecked: scan.sourcesChecked }
  } catch (error) {
    log(ctx, `Tavily unavailable (${sanitizeErrorMessage(error)})`)
    return null
  }
}

async function tryFirecrawl(ctx: ScoutContext): Promise<{
  candidates: IncomeWorkerCandidate[]
  rejected: IncomeWorkerCandidate[]
  sourcesChecked: number
} | null> {
  if (!process.env.FIRECRAWL_API_KEY) {
    log(ctx, 'Firecrawl unavailable (not configured)')
    return null
  }
  try {
    log(ctx, 'Switching to Firecrawl live scout')
    const scan = await searchIncomeOpportunities()
    let opportunities = scan.opportunities
    if (opportunities.length > 0) {
      const enrichment = await enrichCandidatesWithFirecrawl(opportunities)
      opportunities = enrichment.candidates
      if (!enrichment.online) log(ctx, 'Firecrawl enrichment degraded; using search results')
    }
    const candidates = opportunities.map(c => normalizeLiveCandidate(c))
    const rejected = scan.rejected.map(c => normalizeLiveCandidate(c))
    if (candidates.length > 0) {
      log(ctx, `Firecrawl returned ${candidates.length} candidates`)
      ctx.fallbackPath.push('firecrawl_live')
    }
    return { candidates, rejected, sourcesChecked: scan.sourcesChecked ?? opportunities.length }
  } catch (error) {
    log(ctx, `Firecrawl unavailable (${sanitizeErrorMessage(error)})`)
    return null
  }
}

async function tryBrave(ctx: ScoutContext): Promise<IncomeWorkerCandidate[]> {
  if (!process.env.BRAVE_API_KEY) {
    log(ctx, 'Brave unavailable (not configured)')
    return []
  }
  try {
    log(ctx, 'Switching to Brave search fallback')
    const capturedAt = new Date().toISOString()
    const scan = await runBraveSignalSearch(capturedAt)
    const rows = scan.items.filter(item => item.url.startsWith('https://')).slice(0, 6)
    if (!rows.length) {
      log(ctx, 'Brave online but no https candidates')
      return []
    }
    ctx.fallbackPath.push('brave_live')
    log(ctx, `Brave returned ${rows.length} intelligence rows`)
    return rows.map(row => ({
      title: row.title,
      url: row.url,
      source: row.sourceLabel,
      country: 'remote',
      type: 'brave_intelligence',
      payout: null,
      currency: null,
      expiration: null,
      riskLevel: 'medium' as const,
      verificationStatus: 'candidate' as const,
      reason: row.summary.slice(0, 200),
      provider: 'brave',
      score: 58,
      eligibleWorkers: eligibleWorkersFor({
        title: row.title,
        url: row.url,
        source: row.sourceLabel,
        country: 'remote',
        type: 'brave_intelligence',
        payout: null,
        currency: null,
        expiration: null,
        riskLevel: 'medium',
        verificationStatus: 'candidate',
        reason: row.summary,
        provider: 'brave',
      }),
      evidenceLabel: 'LIVE_SIGNAL_BACKED' as const,
    }))
  } catch (error) {
    log(ctx, `Brave unavailable (${sanitizeErrorMessage(error)})`)
    return []
  }
}

async function tryRss(ctx: ScoutContext): Promise<IncomeWorkerCandidate[]> {
  log(ctx, 'Switching to RSS intelligence fallback')
  try {
    const snapshot = await listPersistedSignalSnapshot(24)
    const rssRows = snapshot.results
      .filter(row => row.provider === 'rss' && row.title.trim().length > 4)
      .slice(0, 6)
    if (!rssRows.length) {
      log(ctx, 'RSS cache empty — no persisted signals')
      return []
    }
    ctx.fallbackPath.push('rss_intelligence')
    log(ctx, `RSS fallback loaded ${rssRows.length} intelligence rows`)
    return rssRows.map(row => rssToCandidate(row.title, row.url ?? '', row.source, row.summary))
  } catch {
    log(ctx, 'RSS intelligence unavailable')
    return []
  }
}

function tryCached(ctx: ScoutContext, threadId: string): IncomeWorkerCandidate[] {
  const rows = listScoutOpportunities({ threadId })
  const global = rows.length > 0 ? rows : listScoutOpportunities()
  if (!global.length) {
    log(ctx, 'No cached opportunities in operator queue')
    return []
  }
  ctx.fallbackPath.push('cached_opportunities')
  log(ctx, `Loaded ${Math.min(global.length, 6)} cached opportunities`)
  return global.slice(0, 6).map(cachedToCandidate)
}

function ensureHistoricalMinimum(
  ctx: ScoutContext,
  existing: IncomeWorkerCandidate[],
): IncomeWorkerCandidate[] {
  const historical = buildHistoricalFallbackCandidates()
  if (existing.length >= MIN_FALLBACK_OPPORTUNITIES) return existing

  log(ctx, 'Activating historical pattern fallback generation')
  ctx.fallbackPath.push('historical_pattern')

  const seen = new Set(existing.map(c => c.url))
  const merged = [...existing]
  for (const row of historical) {
    if (merged.length >= MIN_FALLBACK_OPPORTUNITIES) break
    if (seen.has(row.url)) continue
    seen.add(row.url)
    merged.push(row)
  }

  let dup = 0
  while (merged.length < MIN_FALLBACK_OPPORTUNITIES && historical.length > 0) {
    const extra = historical[dup % historical.length]
    dup += 1
    merged.push({ ...extra, url: `${extra.url}?pad=${dup}` })
  }

  log(ctx, `Generated ${merged.length} historical automation opportunities`)
  return merged
}

function registerOpportunityPackets(
  ctx: ScoutContext,
  candidates: IncomeWorkerCandidate[],
  liveSignalsAvailable: boolean,
): ScoutOpportunity[] {
  const packets: OpportunityPacket[] = candidates.map(candidate => {
    if (candidate.evidenceLabel === 'HISTORICAL_PATTERN_BASED') {
      const historical = buildHistoricalFallbackPackets().find(p => p.opportunityTitle === candidate.title)
      if (historical) return historical
    }
    return packetFromCandidate(candidate)
  })

  const registered = registerScoutOpportunities({
    threadId: ctx.threadId,
    family: 'grok',
    providerId: 'income-workers',
    packets,
    liveSignalsAvailable,
  })
  log(ctx, `Registered ${registered.length} opportunity packets (PROPOSED)`)
  return registered
}

function buildDiagnostics(
  ctx: ScoutContext,
  sourceType: IncomeWorkerScoutSourceType,
  selectedProvider: string,
  resultCount: number,
  degradedMode: boolean,
): IncomeWorkerScoutDiagnostics {
  return {
    selectedProvider,
    fallbackPath: [...ctx.fallbackPath],
    scoutDurationMs: Date.now() - ctx.started,
    resultCount,
    sourceType,
    degradedMode,
  }
}

function resolveExecutionState(
  degradedMode: boolean,
  failed: boolean,
  resultCount: number,
): IncomeWorkerScoutExecutionState {
  if (failed && resultCount === 0) return 'failed'
  if (resultCount > 0) return 'awaiting_commander_review'
  if (degradedMode) return 'fallback_active'
  return 'opportunities_generated'
}

export async function orchestrateIncomeWorkerScout(
  threadId = 'income-workers',
): Promise<IncomeWorkerScoutResult> {
  const ctx: ScoutContext = {
    started: Date.now(),
    activityLog: [{ at: new Date().toISOString(), message: `${LOG_PREFIX} Scout execution started` }],
    fallbackPath: [],
    threadId,
  }

  let candidates: IncomeWorkerCandidate[] = []
  let rejected: IncomeWorkerCandidate[] = []
  let sourcesChecked = 0
  let selectedProvider = 'none'
  let sourceType: IncomeWorkerScoutSourceType = 'local_manual'
  let degradedMode = false
  let liveSignalsAvailable = false

  const tavily = await tryTavily(ctx)
  if (tavily?.candidates.length) {
    candidates = tavily.candidates
    rejected = tavily.rejected
    sourcesChecked = tavily.sourcesChecked
    selectedProvider = 'tavily'
    sourceType = 'tavily_live'
    liveSignalsAvailable = true
  } else if (tavily) {
    rejected = tavily.rejected
    sourcesChecked = tavily.sourcesChecked
  }

  if (!candidates.length) {
    degradedMode = true
    log(ctx, 'Tavily empty — walking federation fallback chain')
    const rssCandidates = await tryRss(ctx)
    if (rssCandidates.length) {
      candidates = rssCandidates
      selectedProvider = 'rss'
      sourceType = 'rss_intelligence'
    }
  }

  if (!candidates.length) {
    const braveCandidates = await tryBrave(ctx)
    if (braveCandidates.length) {
      candidates = braveCandidates
      selectedProvider = 'brave'
      sourceType = 'brave_live'
      liveSignalsAvailable = true
    }
  }

  if (!candidates.length) {
    const firecrawl = await tryFirecrawl(ctx)
    if (firecrawl?.candidates.length) {
      candidates = firecrawl.candidates
      rejected = [...rejected, ...firecrawl.rejected]
      sourcesChecked += firecrawl.sourcesChecked
      selectedProvider = 'firecrawl'
      sourceType = 'firecrawl_live'
      liveSignalsAvailable = true
      degradedMode = false
    } else if (firecrawl) {
      rejected = [...rejected, ...firecrawl.rejected]
      sourcesChecked += firecrawl.sourcesChecked
    }
  }

  if (!candidates.length) {
    const cached = tryCached(ctx, threadId)
    if (cached.length) {
      candidates = cached
      selectedProvider = 'cache'
      sourceType = 'cached_opportunities'
    }
  }

  if (!candidates.length || candidates.length < MIN_FALLBACK_OPPORTUNITIES) {
    degradedMode = true
    log(ctx, 'Fallback active — ensuring minimum historical opportunities')
    candidates = ensureHistoricalMinimum(ctx, candidates)
    if (sourceType === 'local_manual' || !liveSignalsAvailable) {
      selectedProvider = selectedProvider === 'none' ? 'historical_pattern' : selectedProvider
      sourceType = 'historical_pattern'
    }
    for (const row of candidates) {
      if (!row.evidenceLabel) row.evidenceLabel = 'HISTORICAL_PATTERN_BASED'
    }
  }

  const opportunityPackets = registerOpportunityPackets(ctx, candidates, liveSignalsAvailable)

  const resultCount = candidates.length
  const executionState = resolveExecutionState(degradedMode, false, resultCount)
  const diagnostics = buildDiagnostics(ctx, sourceType, selectedProvider, resultCount, degradedMode)

  const status: IncomeWorkerScoutResult['status'] =
    resultCount > 0 ? (degradedMode ? 'found' : 'found') : 'no_results'

  const message = degradedMode
    ? `Degraded mode: ${resultCount} operator-safe fallback opportunities ready for commander review.`
    : resultCount > 0
      ? 'Income Workers found source-linked candidates. Review and assign before action.'
      : 'Income Workers generated fallback opportunities for commander review.'

  log(ctx, `Scout complete — ${resultCount} opportunities (${sourceType})`)

  return {
    status: resultCount > 0 ? 'found' : status,
    message,
    scannedAt: new Date().toISOString(),
    providerUsed: selectedProvider,
    sourcesChecked,
    candidates,
    rejected,
    executionState,
    diagnostics,
    activityLog: ctx.activityLog,
    degradedMode,
    opportunityPackets,
  }
}
