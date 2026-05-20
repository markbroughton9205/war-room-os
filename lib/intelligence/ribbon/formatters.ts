import type { FinanceQuote, WeatherDashboardSnapshot } from '@/lib/intelligence/environment/liveEnvironmentTypes'
import type { OperatorDeckSnapshot, OperatorFinancialMetric } from '@/lib/operator/deckTypes'
type CanonicalStatusPayload = {
  subsystems?: { id: string; health: string; label?: string }[]
  providers?: { connectionStatus: string; health?: string }[]
  summary?: { health?: string }
}
import type { NewsIntelStory } from '@/lib/intelligence/newsIntelWall'
import type { IntelligenceCategory } from '@/lib/signals/classification/types'

import type {
  FinancialClimateLabel,
  RibbonAiTeamSlice,
  RibbonMarketsSlice,
  RibbonNewsHeadline,
  RibbonNewsUrgency,
  RibbonOpportunitiesSlice,
  RibbonPersonalFinanceSlice,
  RibbonSymbolicSlice,
  RibbonWeatherSlice,
} from './types'

const RIBBON_SYMBOLS = ['BTC', 'SPY', 'QQQ', 'GLD'] as const

const CATEGORY_LABELS: Record<IntelligenceCategory | 'uncategorized', string> = {
  geopolitics: 'Geopolitics',
  AI_industry: 'AI',
  markets: 'Markets',
  local_economy: 'Akron/Ohio',
  business_opportunity: 'Automation',
  operational_risk: 'Economy',
  infrastructure: 'Logistics',
  emergency: 'Urgent',
  uncategorized: 'Intel',
}

export function categoryLabel(category: IntelligenceCategory | 'uncategorized'): string {
  return CATEGORY_LABELS[category] ?? 'Intel'
}

export function storyUrgency(story: Pick<NewsIntelStory, 'intelligenceCategory' | 'operationalStatus' | 'leverageScore'>): RibbonNewsUrgency {
  if (story.intelligenceCategory === 'emergency' || story.operationalStatus === 'ACTIONABLE') return 'urgent'
  if (story.leverageScore >= 85) return 'urgent'
  if (story.leverageScore >= 70) return 'elevated'
  return 'normal'
}

export function storyToRibbonHeadline(story: NewsIntelStory): RibbonNewsHeadline {
  return {
    id: story.id,
    headline: story.headline,
    source: story.source,
    publishedAt: story.publishedAt,
    category: categoryLabel(story.intelligenceCategory),
    intelligenceCategory: story.intelligenceCategory,
    urgency: storyUrgency(story),
  }
}

function formatPublished(publishedAt: string | null): string {
  if (!publishedAt) return 'time unknown'
  const ms = Date.parse(publishedAt)
  if (!Number.isFinite(ms)) return 'time unknown'
  const diffMin = Math.round((Date.now() - ms) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const hours = Math.round(diffMin / 60)
  if (hours < 48) return `${hours}h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatHeadlineMeta(headline: RibbonNewsHeadline): string {
  return `${headline.source} · ${formatPublished(headline.publishedAt)} · ${headline.category}`
}

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace('/USD', '').replace('-USD', '')
}

function matchQuote(quotes: FinanceQuote[], target: string): FinanceQuote | undefined {
  const want = target.toUpperCase()
  return quotes.find(q => normalizeSymbol(q.symbol) === want || q.symbol.toUpperCase().startsWith(want))
}

function formatPrice(quote: FinanceQuote): string {
  if (quote.price == null) return '—'
  const digits = quote.marketType === 'crypto' && quote.price < 1000 ? 0 : 2
  return quote.price.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatMovement(quote: FinanceQuote): string {
  if (quote.percentChange != null) {
    const sign = quote.percentChange > 0 ? '+' : ''
    return `${sign}${quote.percentChange.toFixed(2)}%`
  }
  if (quote.change != null) {
    const sign = quote.change > 0 ? '+' : ''
    return `${sign}$${Math.abs(quote.change).toFixed(2)}`
  }
  return 'flat'
}

export function deriveFinancialClimate(quotes: FinanceQuote[]): FinancialClimateLabel {
  if (!quotes.length) return 'unavailable'
  const dirs = quotes.map(q => q.direction).filter(d => d !== 'unknown')
  if (!dirs.length) return 'quiet session'
  const up = dirs.filter(d => d === 'up').length
  const down = dirs.filter(d => d === 'down').length
  const flat = dirs.filter(d => d === 'flat').length
  if (up > down && up >= 2) return 'risk-on'
  if (down > up && down >= 2) return 'risk-off'
  if (up && down) return 'mixed volatility'
  if (flat === dirs.length) return 'quiet session'
  return 'mixed volatility'
}

export function buildMarketsSlice(quotes: FinanceQuote[], status: 'available' | 'unavailable'): RibbonMarketsSlice {
  if (status !== 'available' || !quotes.length) {
    return {
      status: 'unavailable',
      climate: 'unavailable',
      quotes: [],
      watchlistNote: null,
      label: 'Markets temporarily unavailable',
    }
  }

  const picked = RIBBON_SYMBOLS.map(sym => {
    const quote = matchQuote(quotes, sym)
    if (!quote) return null
    return {
      symbol: sym,
      price: formatPrice(quote),
      movement: formatMovement(quote),
      direction: quote.direction,
    }
  }).filter((row): row is NonNullable<typeof row> => row != null)

  const climate = deriveFinancialClimate(quotes)
  const climateLabel =
    climate === 'risk-on'
      ? 'Risk-on'
      : climate === 'risk-off'
        ? 'Risk-off'
        : climate === 'mixed volatility'
          ? 'Mixed volatility'
          : climate === 'quiet session'
            ? 'Quiet session'
            : 'Markets limited'

  const summary = picked.map(q => `${q.symbol} ${q.price} (${q.movement})`).join(' · ')
  return {
    status: 'available',
    climate,
    quotes: picked,
    watchlistNote: quotes.length > picked.length ? `${quotes.length - picked.length} more on watchlist` : null,
    label: `${climateLabel} · ${summary}`,
  }
}

export function buildWeatherSlice(weather: WeatherDashboardSnapshot | null | undefined): RibbonWeatherSlice {
  if (!weather || weather.status !== 'available') {
    return {
      status: 'unavailable',
      tempF: null,
      condition: null,
      tonight: null,
      alert: null,
      label: 'Live weather temporarily unavailable.',
    }
  }

  const condition = weather.condition?.trim()
  const safeCondition =
    condition && !/provider not loaded|unavailable|error/i.test(condition) ? condition : null
  const tonightPoint = weather.dailyForecast?.[0] ?? weather.hourlyForecast?.slice(-1)?.[0]
  const tonight =
    tonightPoint != null
      ? [
          tonightPoint.label?.trim() || 'Tonight',
          tonightPoint.tempF != null ? `${Math.round(tonightPoint.tempF)}°` : null,
          tonightPoint.condition?.trim() || null,
        ]
          .filter(Boolean)
          .join(' ')
      : weather.lowF != null
        ? `Tonight low ${Math.round(weather.lowF)}°`
        : null

  const alert = weather.alerts?.[0]
  const alertLabel = alert ? `${alert.title}${alert.severity ? ` (${alert.severity})` : ''}` : null

  const parts: string[] = []
  if (weather.currentTempF != null) parts.push(`${Math.round(weather.currentTempF)}°`)
  if (safeCondition) parts.push(safeCondition)
  if (tonight) parts.push(tonight)

  return {
    status: 'available',
    tempF: weather.currentTempF,
    condition: safeCondition,
    tonight,
    alert: alertLabel,
    label: parts.length ? parts.join(' · ') : 'Weather available',
  }
}

function metric(deck: OperatorDeckSnapshot, key: OperatorFinancialMetric['key']): OperatorFinancialMetric | undefined {
  return deck.financialTelemetry.find(row => row.key === key)
}

export function buildPersonalFinanceSlice(deck: OperatorDeckSnapshot | null): RibbonPersonalFinanceSlice {
  if (!deck || deck.stateLabel === 'UNAVAILABLE' && deck.financialTelemetry.every(m => m.truthLabel === 'UNAVAILABLE')) {
    return {
      status: 'unavailable',
      balance: null,
      recentEarnings: null,
      pipeline: null,
      missionTrigger: null,
      debtProgress: null,
      label: 'Personal finance not logged',
    }
  }

  const balance = metric(deck, 'liquid_balance')
  const earnings = metric(deck, 'weekly_earnings')
  const lastEarning = metric(deck, 'last_logged_earning')
  const pipeline = metric(deck, 'projected_30_day_income')
  const trigger = metric(deck, 'six_hundred_trigger')
  const debt = metric(deck, 'debt_freedom_distance')

  const hasLogged = [balance, earnings, pipeline, trigger, debt].some(
    m => m && m.truthLabel !== 'UNAVAILABLE',
  )
  if (!hasLogged) {
    return {
      status: 'unavailable',
      balance: null,
      recentEarnings: null,
      pipeline: null,
      missionTrigger: null,
      debtProgress: null,
      label: 'Personal finance not logged',
    }
  }

  const missionTrigger =
    trigger && trigger.truthLabel !== 'UNAVAILABLE'
      ? `$600 trigger ${trigger.progress != null ? `${trigger.progress}% complete` : trigger.value}`
      : null

  const parts: string[] = []
  if (balance && balance.truthLabel !== 'UNAVAILABLE') parts.push(`Balance ${balance.value}`)
  if (earnings && earnings.truthLabel !== 'UNAVAILABLE') parts.push(`Week ${earnings.value}`)
  if (pipeline && pipeline.truthLabel !== 'UNAVAILABLE') parts.push(`Pipeline ${pipeline.value}`)
  if (missionTrigger) parts.push(missionTrigger)

  return {
    status: 'available',
    balance: balance?.truthLabel !== 'UNAVAILABLE' ? balance?.value ?? null : null,
    recentEarnings:
      lastEarning?.truthLabel !== 'UNAVAILABLE'
        ? lastEarning?.value ?? null
        : earnings?.truthLabel !== 'UNAVAILABLE'
          ? earnings?.value ?? null
          : null,
    pipeline: pipeline?.truthLabel !== 'UNAVAILABLE' ? pipeline?.value ?? null : null,
    missionTrigger,
    debtProgress: debt?.truthLabel !== 'UNAVAILABLE' ? debt?.value ?? null : null,
    label: parts.length ? parts.join(' · ') : 'Operator deck loaded',
  }
}

export function buildAiTeamSlice(canonical: CanonicalStatusPayload | null): RibbonAiTeamSlice {
  if (!canonical) {
    return {
      label: 'AI team in fallback mode',
      tone: 'warn',
      familiesOnline: 0,
      familiesTotal: 0,
      councilNote: null,
    }
  }

  const providers = canonical.providers ?? []
  const online = providers.filter(
    p => p.connectionStatus === 'online' || p.connectionStatus === 'standby',
  ).length
  const degraded = providers.filter(p => p.health === 'degraded').length
  const researching = providers.filter(p => p.connectionStatus === 'standby').length

  let label = 'AI team ready'
  let tone: RibbonAiTeamSlice['tone'] = 'ok'
  if (online === 0 && providers.length) {
    label = 'AI families need attention'
    tone = 'danger'
  } else if (degraded > 0 || online < providers.length) {
    label = `${online}/${providers.length} families online`
    if (degraded) label += ` · ${degraded} degraded`
    tone = 'warn'
  } else if (researching) {
    label = `${online} families online · ${researching} on standby`
    tone = 'ok'
  }

  const council = canonical.subsystems?.find(s => s.id === 'approval_gate')
  let councilNote: string | null = null
  if (council) {
    if (/unavailable|blocked/i.test(council.health)) {
      councilNote = 'Council approvals need review'
      tone = tone === 'ok' ? 'warn' : tone
    } else if (/degraded/i.test(council.health)) {
      councilNote = 'Council ops degraded'
      tone = tone === 'ok' ? 'warn' : tone
    } else if (/healthy|verified/i.test(council.health)) {
      councilNote = 'Council ops active'
    }
  }

  const summaryHealth = canonical.summary?.health
  if (summaryHealth === 'degraded' && tone === 'ok') tone = 'warn'
  if (summaryHealth === 'unavailable' && tone === 'ok') tone = 'danger'

  return {
    label,
    tone,
    familiesOnline: online,
    familiesTotal: providers.length,
    councilNote,
  }
}

export function buildOpportunitiesSlice(
  count: number,
  extras?: { queuedReviews?: number; localSignals?: number; automationLeads?: number; payoutAlert?: string | null },
): RibbonOpportunitiesSlice {
  const parts: string[] = []
  if (count > 0) parts.push(`${count} opportunit${count === 1 ? 'y' : 'ies'}`)
  else parts.push('No opportunities queued')
  if (extras?.queuedReviews) parts.push(`${extras.queuedReviews} reviews queued`)
  if (extras?.localSignals) parts.push(`${extras.localSignals} local signals`)
  if (extras?.automationLeads) parts.push(`${extras.automationLeads} automation leads`)

  return {
    count,
    label: parts.join(' · '),
    payoutAlert: extras?.payoutAlert ?? null,
  }
}

export function buildSymbolicSlice(
  horoscope: Pick<import('@/lib/intelligence/environment/horoscopeEnvironment').HoroscopeSnapshot, 'sign' | 'interpretation' | 'period'>,
): RibbonSymbolicSlice {
  const snippet = horoscope.interpretation.length > 88
    ? `${horoscope.interpretation.slice(0, 85).trim()}…`
    : horoscope.interpretation
  return {
    sign: horoscope.sign,
    guidance: snippet,
    period: horoscope.period,
  }
}
