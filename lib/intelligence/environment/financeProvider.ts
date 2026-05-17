import { configuredEnvName, getEnvAliasNames, getEnvAliasValue, resolveEnvAlias } from '@/lib/configuration/envAlias'
import type { FinanceDashboardSnapshot, FinanceQuote } from '@/lib/intelligence/environment/liveEnvironmentTypes'

const FINANCE_TIMEOUT_MS = 8000
const FINANCE_ENV_NAMES = [...getEnvAliasNames('financeApiKey'), ...getEnvAliasNames('financeProvider')]
const DEFAULT_SYMBOLS = ['GLD', 'SPY', 'BTC', 'QQQ']

type AlphaVantageQuote = {
  'Global Quote'?: {
    '01. symbol'?: string
    '05. price'?: string
    '09. change'?: string
    '10. change percent'?: string
  }
}

type AlphaVantageCrypto = {
  'Realtime Currency Exchange Rate'?: {
    '1. From_Currency Code'?: string
    '3. To_Currency Code'?: string
    '5. Exchange Rate'?: string
    '6. Last Refreshed'?: string
  }
}

type FinnhubQuote = {
  c?: number
  d?: number
  dp?: number
  t?: number
}

type TwelveDataQuote = {
  symbol?: string
  price?: string
  change?: string
  percent_change?: string
  currency?: string
  datetime?: string
}

function unavailable(detail: string): FinanceDashboardSnapshot {
  const aliasDiagnostics = [resolveEnvAlias('financeApiKey'), resolveEnvAlias('financeProvider')]
  const primaryDiagnostic = aliasDiagnostics.find(diagnostic => diagnostic.configured) ?? aliasDiagnostics[0]
  const aliasRecommendation = aliasDiagnostics.find(diagnostic => diagnostic.recommendation)?.recommendation ?? null

  return {
    status: 'unavailable',
    provider: getEnvAliasValue('financeProvider') || 'not configured',
    quotes: [],
    fetchedAt: null,
    freshness: 'unknown',
    source: 'No finance provider returned data',
    detail,
    setup: {
      envVarNames: FINANCE_ENV_NAMES,
      preferredEnvName: primaryDiagnostic.preferredEnvName,
      aliasDetected: aliasDiagnostics.some(diagnostic => diagnostic.aliasDetected),
      configured: aliasDiagnostics.some(diagnostic => diagnostic.configured),
      aliasRecommendation,
      envAliasDiagnostics: aliasDiagnostics,
      blockedFeature: 'Finance and market Live Environment card',
      recommendedSetup: aliasRecommendation ?? 'Set FINANCE_PROVIDER to alpha_vantage, finnhub, or twelvedata. Set FINANCE_API_KEY. Optional MARKET_WATCHLIST controls the watchlist; FINANCE_SYMBOLS remains supported.',
    },
  }
}

function symbols(): string[] {
  const raw = process.env.MARKET_WATCHLIST?.trim() || process.env.FINANCE_SYMBOLS?.trim()
  if (!raw) return DEFAULT_SYMBOLS.map(normalizeWatchlistSymbol)
  return raw.split(',').map(symbol => normalizeWatchlistSymbol(symbol.trim())).filter(Boolean).slice(0, 10)
}

function normalizeWatchlistSymbol(symbol: string): string {
  const upper = symbol.toUpperCase()
  if (upper === 'BTC' || upper === 'ETH') return `${upper}/USD`
  return symbol
}

function marketType(symbol: string): FinanceQuote['marketType'] {
  if (symbol.includes('/') || symbol.includes('-')) return 'crypto'
  if (['SPY', 'QQQ', 'DIA', '^GSPC', '^DJI', '^IXIC'].includes(symbol.toUpperCase())) return 'index'
  if (['GLD', 'SLV', 'USO', 'GC=F', 'SI=F', 'CL=F'].includes(symbol.toUpperCase())) return 'commodity'
  return 'stock'
}

function freshnessLabel(fetchedAt: string | null): string {
  if (!fetchedAt) return 'unknown'
  const ageMs = Date.now() - Date.parse(fetchedAt)
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now'
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 1) return 'just now'
  return `${minutes}m old`
}

function quoteDirection(change: number | null, percentChange: number | null): FinanceQuote['direction'] {
  const value = change ?? percentChange
  if (value === null) return 'unknown'
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

function movementSummary(symbol: string, change: number | null, percentChange: number | null): string {
  const direction = quoteDirection(change, percentChange)
  if (direction === 'unknown') return `${symbol} price returned, but the provider did not include session movement.`
  if (direction === 'flat') return `${symbol} is flat in the provider's latest session data.`
  const verb = direction === 'up' ? 'gained' : 'lost'
  const dollar = change === null ? null : `$${Math.abs(change).toFixed(2)}`
  const percent = percentChange === null ? null : `${Math.abs(percentChange).toFixed(2)}%`
  return `${symbol} ${verb} ${[dollar, percent].filter(Boolean).join(' / ')} in the latest provider quote.`
}

function enrichQuote(quote: Omit<FinanceQuote, 'direction' | 'movementSummary' | 'marketStatus'>, marketStatus: string | null = null): FinanceQuote {
  return {
    ...quote,
    direction: quoteDirection(quote.change, quote.percentChange),
    movementSummary: movementSummary(quote.symbol, quote.change, quote.percentChange),
    marketStatus,
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace('%', ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FINANCE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WarRoomLiveEnvironment/1.0',
      },
    })
    if (!res.ok) throw new Error(`Finance provider returned ${res.status}`)
    return await res.json() as T
  } finally {
    clearTimeout(timeout)
  }
}

async function alphaVantageQuote(symbol: string, apiKey: string, fetchedAt: string): Promise<FinanceQuote | null> {
  if (symbol.includes('/')) {
    const [from, to] = symbol.split('/')
    const data = await fetchJson<AlphaVantageCrypto>(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(from)}&to_currency=${encodeURIComponent(to ?? 'USD')}&apikey=${encodeURIComponent(apiKey)}`)
    const rate = data['Realtime Currency Exchange Rate']
    const price = toNumber(rate?.['5. Exchange Rate'])
    if (price === null) return null
    return enrichQuote({
      symbol: `${rate?.['1. From_Currency Code'] ?? from}/${rate?.['3. To_Currency Code'] ?? to ?? 'USD'}`,
      price,
      change: null,
      percentChange: null,
      currency: rate?.['3. To_Currency Code'] ?? to ?? 'USD',
      marketType: 'crypto',
      freshness: freshnessLabel(rate?.['6. Last Refreshed'] ?? fetchedAt),
      fetchedAt: rate?.['6. Last Refreshed'] ?? fetchedAt,
    })
  }

  const data = await fetchJson<AlphaVantageQuote>(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`)
  const quote = data['Global Quote']
  const price = toNumber(quote?.['05. price'])
  if (price === null) return null
  return enrichQuote({
    symbol: quote?.['01. symbol'] ?? symbol,
    price,
    change: toNumber(quote?.['09. change']),
    percentChange: toNumber(quote?.['10. change percent']),
    currency: 'USD',
    marketType: marketType(symbol),
    freshness: freshnessLabel(fetchedAt),
    fetchedAt,
  })
}

async function finnhubQuote(symbol: string, apiKey: string, fetchedAt: string): Promise<FinanceQuote | null> {
  const normalized = symbol.includes('/') ? `BINANCE:${symbol.replace('/', '')}` : symbol
  const data = await fetchJson<FinnhubQuote>(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(normalized)}&token=${encodeURIComponent(apiKey)}`)
  const price = toNumber(data.c)
  if (price === null || price === 0) return null
  const providerTime = data.t ? new Date(data.t * 1000).toISOString() : fetchedAt
  return enrichQuote({
    symbol,
    price,
    change: toNumber(data.d),
    percentChange: toNumber(data.dp),
    currency: 'USD',
    marketType: marketType(symbol),
    freshness: freshnessLabel(providerTime),
    fetchedAt: providerTime,
  })
}

async function twelveDataQuote(symbol: string, apiKey: string, fetchedAt: string): Promise<FinanceQuote | null> {
  const data = await fetchJson<TwelveDataQuote>(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`)
  const price = toNumber(data.price)
  if (price === null) return null
  const providerTime = data.datetime && Number.isFinite(Date.parse(data.datetime)) ? new Date(data.datetime).toISOString() : fetchedAt
  return enrichQuote({
    symbol: data.symbol ?? symbol,
    price,
    change: toNumber(data.change),
    percentChange: toNumber(data.percent_change),
    currency: data.currency ?? 'USD',
    marketType: marketType(symbol),
    freshness: freshnessLabel(providerTime),
    fetchedAt: providerTime,
  })
}

export async function buildFinanceDashboardSnapshot(): Promise<FinanceDashboardSnapshot> {
  const detectedFinanceEnv = configuredEnvName(process.env, 'FINANCE_API_KEY')
  const provider = (getEnvAliasValue('financeProvider') || (detectedFinanceEnv === 'FINNHUB_API_KEY' ? 'finnhub' : '')).toLowerCase()
  const apiKey = getEnvAliasValue('financeApiKey')
  if (!apiKey) return unavailable('Set FINANCE_API_KEY and FINANCE_PROVIDER before market data can be fetched.')
  const fetchedAt = new Date().toISOString()
  const selected = symbols()

  try {
    const loader =
      provider === 'finnhub'
        ? finnhubQuote
        : provider === 'twelvedata' || provider === 'twelve_data'
          ? twelveDataQuote
          : provider === 'alpha_vantage' || provider === 'alphavantage' || provider === ''
            ? alphaVantageQuote
            : null
    if (!loader) return unavailable(`Unsupported FINANCE_PROVIDER "${provider}".`)

    const results = await Promise.allSettled(selected.map(symbol => loader(symbol, apiKey, fetchedAt)))
    const quotes = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
    const failures = results.length - quotes.length
    if (!quotes.length) {
      return {
        ...unavailable('Finance provider returned no usable quotes for the selected symbols.'),
        status: failures ? 'error' : 'unavailable',
        provider: provider || 'finance provider',
        fetchedAt,
      }
    }

    return {
      status: failures ? 'error' : 'available',
      provider: provider || 'alpha_vantage',
      quotes,
      fetchedAt,
      freshness: freshnessLabel(fetchedAt),
      source: provider || 'alpha_vantage',
      detail: failures
        ? `${quotes.length} live quote${quotes.length === 1 ? '' : 's'} loaded; ${failures} selected symbol${failures === 1 ? '' : 's'} failed.`
        : `${quotes.length} live quote${quotes.length === 1 ? '' : 's'} loaded from the configured finance provider.`,
    }
  } catch (error) {
    return {
      ...unavailable(error instanceof Error ? error.message : 'Finance provider request failed'),
      status: 'error',
      provider: provider || 'finance provider',
      fetchedAt,
    }
  }
}
