import 'server-only'

import { getEnvAliasValue } from '@/lib/configuration/envAlias'
import type { SignalCategory, SignalSourceDefinition } from './model'

type RegistryEntry = {
  id: string
  label: string
  url: string
  categories: SignalCategory[]
  notes: string
}

const DEFAULT_SOURCE_URLS: RegistryEntry[] = [
  {
    id: 'ohio-means-jobs',
    label: 'OhioMeansJobs search',
    url: 'https://ohiomeansjobs.ohio.gov/job-seekers/find-a-job',
    categories: ['job', 'gig', 'Ohio_business'],
    notes: 'Ohio job/gig discovery landing page; Firecrawl/direct source extraction only.',
  },
  {
    id: 'akron-business-news',
    label: 'Akron business news',
    url: 'https://www.akronohio.gov/cms/news/index.html',
    categories: ['local_Akron', 'Ohio_business', 'economic_warning'],
    notes: 'Official Akron public news source for local business and economic context.',
  },
  {
    id: 'summit-county-news',
    label: 'Summit County news',
    url: 'https://co.summitoh.net/news',
    categories: ['local_Akron', 'Ohio_business', 'economic_warning'],
    notes: 'Official Summit County public news source for local opportunity and warning context.',
  },
  {
    id: 'odot-freight',
    label: 'ODOT freight planning',
    url: 'https://www.transportation.ohio.gov/programs/freight',
    categories: ['freight', 'sprinter_van', 'local_delivery', 'Ohio_business'],
    notes: 'Ohio freight and logistics planning source; no load or income claim is inferred.',
  },
  {
    id: 'dat-articles',
    label: 'DAT freight market articles',
    url: 'https://www.dat.com/blog',
    categories: ['freight', 'load_board', 'sprinter_van', 'economic_warning'],
    notes: 'Freight market source URL for trends and logistics warnings.',
  },
  {
    id: 'upwork-ai-automation',
    label: 'Upwork AI automation search',
    url: 'https://www.upwork.com/nx/search/jobs/?q=AI%20automation',
    categories: ['gig', 'SMB_automation', 'customer_operations', 'AI_evaluation'],
    notes: 'Job/gig source URL for buyer demand observation only; no application is performed.',
  },
  {
    id: 'data-annotation-search',
    label: 'Data annotation jobs search',
    url: 'https://www.indeed.com/jobs?q=data+annotation+AI+evaluation',
    categories: ['job', 'gig', 'data_annotation', 'AI_evaluation'],
    notes: 'Job search URL for task availability observation only; no application is performed.',
  },
  {
    id: 'call-center-remote-search',
    label: 'Remote call center search',
    url: 'https://www.indeed.com/jobs?q=remote+call+center+customer+operations',
    categories: ['job', 'call_center', 'customer_operations'],
    notes: 'Job search URL for customer operations signal observation only.',
  },
  {
    id: 'ai-trends-openai-news',
    label: 'OpenAI news',
    url: 'https://openai.com/news/',
    categories: ['AI_trends', 'AI_evaluation', 'app_factory_opportunity'],
    notes: 'AI trend source URL for feature/app opportunity framing only.',
  },
]

const CATEGORY_ALIASES: Record<string, SignalCategory> = {
  freight: 'freight',
  sprinter_van: 'sprinter_van',
  local_delivery: 'local_delivery',
  load_board: 'load_board',
  job: 'job',
  gig: 'gig',
  data_annotation: 'data_annotation',
  ai_evaluation: 'AI_evaluation',
  smb_automation: 'SMB_automation',
  customer_operations: 'customer_operations',
  call_center: 'call_center',
  ai_trends: 'AI_trends',
  local_akron: 'local_Akron',
  ohio_business: 'Ohio_business',
  economic_warning: 'economic_warning',
  app_factory_opportunity: 'app_factory_opportunity',
}

export function isAllowedCloudUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:') return false
    if (host === 'localhost' || host.endsWith('.localhost')) return false
    if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false
    if (/^(10|127|169\.254|192\.168)\./.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

function configured(envName: string): boolean {
  return Boolean(process.env[envName]?.trim())
}

function parseCategories(value: string | undefined, fallback: SignalCategory[]): SignalCategory[] {
  if (!value) return fallback
  const categories = value
    .split(',')
    .map(item => CATEGORY_ALIASES[item.trim().toLowerCase()])
    .filter((item): item is SignalCategory => Boolean(item))
  return categories.length ? [...new Set(categories)] : fallback
}

function parseManualRegistry(): RegistryEntry[] {
  const raw = process.env.SIGNAL_SOURCE_URLS?.trim()
  if (!raw) return []
  return raw
    .split(/[;\n]+/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .slice(0, 20)
    .flatMap((entry, index): RegistryEntry[] => {
      const parts = entry.split('|').map(part => part.trim())
      const url = parts.length >= 3 ? parts[2] : parts[0]
      if (!isAllowedCloudUrl(url)) return []
      const parsed = new URL(url)
      return [{
        id: `manual-${index}-${parsed.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        label: parts.length >= 3 ? parts[1] || parsed.hostname : parsed.hostname,
        url: parsed.toString(),
        categories: parseCategories(parts.length >= 3 ? parts[0] : undefined, ['SMB_automation', 'Ohio_business']),
        notes: 'Commander-configured signal source URL.',
      }]
    })
}

function parseRssRegistry(): SignalSourceDefinition[] {
  const raw = getEnvAliasValue('newsRssFeeds')
  if (!raw) return []
  return raw
    .split(/[;\n]+/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .slice(0, 12)
    .flatMap((entry, index): SignalSourceDefinition[] => {
      const parts = entry.split('|').map(part => part.trim())
      const url = parts.length >= 3 ? parts[2] : parts[0]
      if (!isAllowedCloudUrl(url)) return []
      const parsed = new URL(url)
      return [{
        id: `rss-${index}-${parsed.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        label: parts.length >= 3 ? parts[1] || parsed.hostname : parsed.hostname,
        provider: 'rss',
        kind: 'rss',
        categories: parseCategories(parts.length >= 3 ? parts[0] : undefined, ['local_Akron', 'Ohio_business', 'economic_warning']),
        url: parsed.toString(),
        query: null,
        configured: true,
        reliabilityScore: 0.68,
        notes: 'Configured RSS feed registry item.',
      }]
    })
}

export function getSignalSources(): SignalSourceDefinition[] {
  const tavilyConfigured = configured('TAVILY_API_KEY')
  const firecrawlConfigured = configured('FIRECRAWL_API_KEY')
  const manual = [...DEFAULT_SOURCE_URLS, ...parseManualRegistry()]

  return [
    {
      id: 'tavily-income-search',
      label: 'Tavily economic search',
      provider: 'tavily',
      kind: 'search',
      categories: ['freight', 'job', 'gig', 'SMB_automation', 'AI_trends', 'local_Akron', 'Ohio_business', 'app_factory_opportunity'],
      url: null,
      query: 'bounded income, logistics, SMB automation, AI trends, jobs/gigs, and Akron/Ohio economic opportunity searches',
      configured: tavilyConfigured,
      reliabilityScore: 0.78,
      notes: tavilyConfigured ? 'TAVILY_API_KEY is configured.' : 'TAVILY_API_KEY is not configured.',
    },
    {
      id: 'guardian-economic-news',
      label: 'Guardian economic news',
      provider: 'guardian',
      kind: 'guardian',
      categories: ['AI_trends', 'Ohio_business', 'economic_warning', 'app_factory_opportunity'],
      url: null,
      query: 'Akron Ohio business economy AI jobs logistics',
      configured: Boolean(getEnvAliasValue('guardianApiKey')),
      reliabilityScore: 0.82,
      notes: getEnvAliasValue('guardianApiKey') ? 'Guardian API key is configured.' : 'Guardian API key is not configured.',
    },
    {
      id: 'newsapi-economic-news',
      label: 'NewsAPI economic news',
      provider: 'newsapi',
      kind: 'news_api',
      categories: ['AI_trends', 'Ohio_business', 'economic_warning', 'app_factory_opportunity'],
      url: null,
      query: 'Akron Ohio business economy AI jobs logistics',
      configured: Boolean(getEnvAliasValue('newsApiKey')),
      reliabilityScore: 0.76,
      notes: getEnvAliasValue('newsApiKey') ? 'NewsAPI key is configured.' : 'NewsAPI key is not configured.',
    },
    ...parseRssRegistry(),
    ...manual.map((entry): SignalSourceDefinition => ({
      id: entry.id,
      label: entry.label,
      provider: firecrawlConfigured ? 'firecrawl' : 'source_url',
      kind: entry.categories.includes('freight') || entry.categories.includes('load_board') ? 'freight_url'
        : entry.categories.includes('job') || entry.categories.includes('gig') ? 'job_gig_url'
          : entry.categories.includes('SMB_automation') || entry.categories.includes('customer_operations') ? 'smb_lead_url'
            : entry.categories.includes('AI_trends') ? 'ai_trend_url'
              : 'local_economic_url',
      categories: entry.categories,
      url: entry.url,
      query: null,
      configured: true,
      reliabilityScore: firecrawlConfigured ? 0.74 : 0.58,
      notes: `${entry.notes} ${firecrawlConfigured ? 'Firecrawl extraction is configured.' : 'Firecrawl is unavailable; direct bounded source fetch will be attempted.'}`,
    })),
  ]
}
