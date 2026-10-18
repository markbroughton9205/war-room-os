/**
 * Governed public-internet research for Application Builder.
 * Understanding and building only — no login, paywall bypass, purchase, form submit, deploy, or spend.
 */
import { randomUUID } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'
import { tavilyWarRoomSearch, firecrawlWarRoomSearch } from '@/lib/internet/warRoomSearchProviders'
import { googleWebSearchConfigured, runGoogleWebSearch } from '@/lib/war-room-search/providers/googleWebSearch'
import { runSearxngSearch, searxngConfigured } from '@/lib/war-room-search/providers/searxng'
import { redactSecretsFromOutput } from './outputRedaction'
import {
  abortFoundryResearchMission,
  beginFoundryResearchMission,
  foundryResearchFetch,
  foundryResearchFetchForMission,
  releaseFoundryResearchMission,
} from './foundryResearchTransport'
import { isRepairCancellationRequested } from './processRegistry'
import type {
  FoundryClaimKind,
  FoundryResearchProviderDiscovery,
  FoundryResearchRecord,
  FoundryResearchSourceType,
} from './foundryApplicationBuilderTypes'

export const RESEARCH_REFUSED_SIDE_EFFECT = 'REFUSED_RESEARCH_SIDE_EFFECT'
export const RESEARCH_REFUSED_PRIVATE = 'REFUSED_RESEARCH_PRIVATE_TARGET'
export const RESEARCH_STALE_MS = 14 * 24 * 60 * 60 * 1000

const BLOCKED_RESEARCH_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_RESEARCH_HOSTS.has(host)) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (isIPv4(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 169) return true
  }
  if (isIPv6(host) && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host === '::1')) return true
  return false
}

export function classifyResearchRequest(input: {
  url?: string
  method?: string
  body?: unknown
}): { ok: true } | { ok: false; code: string; error: string } {
  const method = (input.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, code: RESEARCH_REFUSED_SIDE_EFFECT, error: `${RESEARCH_REFUSED_SIDE_EFFECT}: only GET/HEAD public fetches are allowed.` }
  }
  if (input.body != null && input.body !== '') {
    return { ok: false, code: RESEARCH_REFUSED_SIDE_EFFECT, error: `${RESEARCH_REFUSED_SIDE_EFFECT}: request bodies (forms, purchases, logins) are forbidden.` }
  }
  if (!input.url) return { ok: true }
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return { ok: false, code: RESEARCH_REFUSED_PRIVATE, error: `${RESEARCH_REFUSED_PRIVATE}: invalid URL.` }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, code: RESEARCH_REFUSED_PRIVATE, error: `${RESEARCH_REFUSED_PRIVATE}: research fetch is https-only.` }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: RESEARCH_REFUSED_SIDE_EFFECT, error: `${RESEARCH_REFUSED_SIDE_EFFECT}: credentials in URLs are forbidden.` }
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { ok: false, code: RESEARCH_REFUSED_PRIVATE, error: `${RESEARCH_REFUSED_PRIVATE}: private/loopback targets are not researchable.` }
  }
  if (/login|signin|checkout|billing|cart|purchase|paywall/i.test(parsed.pathname) && /submit|session|auth/i.test(parsed.search)) {
    return { ok: false, code: RESEARCH_REFUSED_SIDE_EFFECT, error: `${RESEARCH_REFUSED_SIDE_EFFECT}: authentication/checkout URLs are refused.` }
  }
  return { ok: true }
}

export function sanitizeResearchText(text: string): string {
  return redactSecretsFromOutput(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000),
  )
}

export function researchFreshness(retrievedAt: string, now = Date.now()): FoundryResearchRecord['freshness'] {
  const then = Date.parse(retrievedAt)
  if (!Number.isFinite(then)) return 'needs_research'
  return now - then > RESEARCH_STALE_MS ? 'needs_research' : 'current'
}

export function distinguishClaim(kind: FoundryClaimKind, claim: string): { kind: FoundryClaimKind; label: string } {
  const prefix = kind === 'RESEARCHED_FACT' ? 'FACT' : kind === 'OBSERVATION' ? 'OBSERVATION' : 'DESIGN'
  return { kind, label: `${prefix}: ${claim}` }
}

export function classifyResearchHit(url: string): { kind: FoundryClaimKind; sourceType: FoundryResearchSourceType } {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return { kind: 'OBSERVATION', sourceType: 'search_index' }
  }
  if (/(^|\.)w3\.org$|(^|\.)w3c\.org$/.test(host)) return { kind: 'RESEARCHED_FACT', sourceType: 'standards' }
  if (/(^|\.)developer\.mozilla\.org$|(^|\.)schema\.org$/.test(host)) return { kind: 'RESEARCHED_FACT', sourceType: 'official_docs' }
  if (/(^|\.)fmcsa\.dot\.gov$|(^|\.)transportation\.gov$|(^|\.)wikipedia\.org$/.test(host)) return { kind: 'RESEARCHED_FACT', sourceType: 'official_docs' }
  if (/(^|\.)web\.dev$|(^|\.)html\.spec\.whatwg\.org$/.test(host)) return { kind: 'RESEARCHED_FACT', sourceType: 'technical_docs' }
  return { kind: 'OBSERVATION', sourceType: 'industry_example' }
}

export function discoverResearchProviders(): FoundryResearchProviderDiscovery {
  const available = [
    'tavily',
    'firecrawl',
    'google_web_search',
    'searxng',
    'duckduckgo_html',
    'wikipedia_opensearch',
    'public_https_fetch',
  ]
  const configured: string[] = []
  if (process.env.TAVILY_API_KEY?.trim()) configured.push('tavily')
  if (process.env.FIRECRAWL_API_KEY?.trim()) configured.push('firecrawl')
  if (googleWebSearchConfigured()) configured.push('google_web_search')
  if (searxngConfigured()) configured.push('searxng')
  configured.push('duckduckgo_html', 'wikipedia_opensearch', 'public_https_fetch')
  return {
    available,
    configured,
    selected: null,
    fallback: 'duckduckgo_html',
  }
}

export type FoundryResearchCallOptions = {
  missionId?: string
  signal?: AbortSignal
}

async function researchGet(url: string, init: RequestInit, opts?: FoundryResearchCallOptions): Promise<Response> {
  return foundryResearchFetch(url, init, { missionId: opts?.missionId })
}

function httpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

async function duckDuckGoHtmlSearch(query: string, limit: number, opts?: FoundryResearchCallOptions): Promise<{
  ok: boolean
  results: Array<{ title: string; url: string; snippet: string }>
  detail: string
}> {
  const classified = classifyResearchRequest({
    url: 'https://html.duckduckgo.com/html/',
    method: 'GET',
  })
  if (!classified.ok) return { ok: false, results: [], detail: classified.error }
  try {
    const res = await researchGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'WarRoom-Foundry-ApplicationBuilder/1.0 (governed research; GET-only)',
      },
      signal: opts?.signal,
    }, opts)
    if (!res.ok) return { ok: false, results: [], detail: `HTTP ${res.status}` }
    const html = await res.text()
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map(match => sanitizeResearchText(match[1]))
    const uddg = [...html.matchAll(/uddg=([^&"]+)/g)].map(match => {
      try {
        return decodeURIComponent(match[1])
      } catch {
        return ''
      }
    })
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>/g)].map(match => sanitizeResearchText(match[1]))
    for (let i = 0; i < uddg.length && results.length < limit; i += 1) {
      const url = httpsUrl(uddg[i])
      if (!url) continue
      results.push({
        title: titles[i] || url,
        url,
        snippet: snippets[i] || titles[i] || '',
      })
    }
    return { ok: results.length > 0, results, detail: 'duckduckgo_html' }
  } catch (error) {
    return { ok: false, results: [], detail: error instanceof Error ? error.message : String(error) }
  }
}

async function wikipediaOpenSearch(query: string, limit: number, opts?: FoundryResearchCallOptions): Promise<{
  ok: boolean
  results: Array<{ title: string; url: string; snippet: string }>
  detail: string
}> {
  const endpoint = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`
  const classified = classifyResearchRequest({ url: endpoint, method: 'GET' })
  if (!classified.ok) return { ok: false, results: [], detail: classified.error }
  try {
    const res = await researchGet(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'WarRoom-Foundry-ApplicationBuilder/1.0 (governed research; GET-only)' },
      signal: opts?.signal,
    }, opts)
    if (!res.ok) return { ok: false, results: [], detail: `HTTP ${res.status}` }
    const data = await res.json() as [string, string[], string[], string[]]
    const titles = data[1] ?? []
    const snippets = data[2] ?? []
    const urls = data[3] ?? []
    const results = titles.map((title, index) => ({
      title,
      url: urls[index] ?? '',
      snippet: snippets[index] || title,
    })).filter(row => httpsUrl(row.url))
    return { ok: results.length > 0, results, detail: 'wikipedia_opensearch' }
  } catch (error) {
    return { ok: false, results: [], detail: error instanceof Error ? error.message : String(error) }
  }
}

export function makeResearchRecord(input: Omit<FoundryResearchRecord, 'id' | 'freshness'> & { freshness?: FoundryResearchRecord['freshness'] }): FoundryResearchRecord {
  return {
    id: randomUUID(),
    freshness: input.freshness ?? researchFreshness(input.retrievedAt),
    ...input,
  }
}

export async function searchPublicWeb(query: string, limit = 6, opts?: FoundryResearchCallOptions): Promise<{
  ok: boolean
  status: 'LIVE' | 'PARTIAL' | 'CONFIG_NEEDED'
  results: Array<{ title: string; url: string; snippet: string }>
  detail: string
}> {
  const fetchImpl = opts?.missionId
    ? foundryResearchFetchForMission(opts.missionId)
    : ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL ? input : input.url
        return foundryResearchFetch(url, init)
      }) as typeof fetch
  const tavily = await tavilyWarRoomSearch(query, limit, { fetchImpl, signal: opts?.signal })
  if (tavily.ok && tavily.results.length) {
    return {
      ok: true,
      status: 'LIVE',
      results: tavily.results.slice(0, limit).map(row => ({
        title: String(row.title ?? row.url ?? 'untitled'),
        url: String(row.url ?? ''),
        snippet: sanitizeResearchText(String(row.content ?? '')),
      })),
      detail: 'tavily',
    }
  }
  const firecrawl = await firecrawlWarRoomSearch(query, limit, { fetchImpl, signal: opts?.signal })
  if (firecrawl.ok && firecrawl.results.length) {
    return {
      ok: true,
      status: 'LIVE',
      results: firecrawl.results.slice(0, limit).map(row => ({
        title: row.title || row.url,
        url: row.url,
        snippet: sanitizeResearchText(row.description),
      })),
      detail: 'firecrawl',
    }
  }
  if (googleWebSearchConfigured()) {
    const google = await runGoogleWebSearch(query, { pageSize: limit, fetchImpl, signal: opts?.signal })
    if (google.ok && google.results.length) {
      return {
        ok: true,
        status: 'LIVE',
        results: google.results.slice(0, limit).map(row => ({
          title: row.title,
          url: row.url,
          snippet: sanitizeResearchText(row.snippet),
        })),
        detail: 'google_web_search',
      }
    }
  }
  if (searxngConfigured()) {
    const searxng = await runSearxngSearch(query, { pageSize: limit, fetchImpl, signal: opts?.signal })
    if (searxng.ok && searxng.results.length) {
      return {
        ok: true,
        status: 'LIVE',
        results: searxng.results.slice(0, limit).map(row => ({
          title: row.title,
          url: row.url,
          snippet: sanitizeResearchText(row.snippet),
        })),
        detail: 'searxng',
      }
    }
  }
  const duck = await duckDuckGoHtmlSearch(query, limit, opts)
  if (duck.ok) {
    return { ok: true, status: 'LIVE', results: duck.results, detail: duck.detail }
  }
  const wiki = await wikipediaOpenSearch(query, limit, opts)
  if (wiki.ok) {
    return { ok: true, status: 'LIVE', results: wiki.results, detail: wiki.detail }
  }
  const reason = ('reason' in tavily && tavily.reason) || ('reason' in firecrawl && firecrawl.reason) || duck.detail || 'no live search provider'
  return { ok: false, status: 'CONFIG_NEEDED', results: [], detail: String(reason) }
}

export async function fetchPublicPage(url: string, opts?: FoundryResearchCallOptions): Promise<{
  ok: boolean
  title: string
  text: string
  error?: string
}> {
  const classified = classifyResearchRequest({ url, method: 'GET' })
  if (!classified.ok) return { ok: false, title: '', text: '', error: classified.error }
  try {
    const res = await researchGet(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1',
        'User-Agent': 'WarRoom-Foundry-ApplicationBuilder/1.0 (governed research; GET-only)',
      },
      signal: opts?.signal,
    }, opts)
    if (!res.ok) return { ok: false, title: '', text: '', error: `HTTP ${res.status}` }
    const raw = sanitizeResearchText(await res.text())
    const title = raw.slice(0, 80) || url
    return { ok: true, title, text: raw }
  } catch (error) {
    return { ok: false, title: '', text: '', error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runApplicationResearch(queries: string[], opts?: FoundryResearchCallOptions): Promise<{
  records: FoundryResearchRecord[]
  queries: string[]
  status: 'LIVE' | 'PARTIAL' | 'CONFIG_NEEDED'
  selectedProvider: string | null
  providers: FoundryResearchProviderDiscovery
}> {
  if (opts?.missionId) beginFoundryResearchMission(opts.missionId)
  const providers = discoverResearchProviders()
  const records: FoundryResearchRecord[] = []
  const usedProviders = new Set<string>()
  let live = 0
  let needed = 0
  try {
  for (const query of queries) {
    if (opts?.missionId && isRepairCancellationRequested(opts.missionId)) {
      abortFoundryResearchMission(opts.missionId)
      break
    }
    const search = await searchPublicWeb(query, 5, opts)
    if (search.status === 'LIVE') {
      live += 1
      usedProviders.add(search.detail)
    } else {
      needed += 1
    }
    for (const row of search.results) {
      if (!row.url || !httpsUrl(row.url)) continue
      const classified = classifyResearchHit(row.url)
      records.push(makeResearchRecord({
        source: row.url,
        title: row.title,
        retrievedAt: new Date().toISOString(),
        claim: row.snippet.slice(0, 400) || row.title,
        relevance: query,
        confidence: row.snippet.length > 80 ? 'medium' : 'low',
        usedFor: classified.kind === 'OBSERVATION' ? 'information architecture observation' : 'requirement discovery',
        kind: classified.kind,
        sourceType: classified.sourceType,
        provider: search.detail,
        query,
      }))
    }
    const firstHttps = search.results.find(row => httpsUrl(row.url))
    if (firstHttps) {
      const page = await fetchPublicPage(firstHttps.url, opts)
      if (page.ok) {
        const classified = classifyResearchHit(firstHttps.url)
        records.push(makeResearchRecord({
          source: firstHttps.url,
          title: page.title || firstHttps.title,
          retrievedAt: new Date().toISOString(),
          claim: page.text.slice(0, 360),
          relevance: query,
          confidence: 'medium',
          usedFor: 'page-level pattern extraction — copy is not reused',
          kind: classified.kind,
          sourceType: classified.sourceType,
          provider: 'public_https_fetch',
          query,
        }))
      }
    }
    if (search.status !== 'LIVE') {
      records.push(makeResearchRecord({
        source: 'local://research-config',
        title: 'Research provider not configured or unreachable',
        retrievedAt: new Date().toISOString(),
        claim: `Query "${query}" did not return live sources (${search.detail}).`,
        relevance: query,
        confidence: 'low',
        usedFor: 'honest gap',
        kind: 'RESEARCHED_FACT',
        freshness: 'needs_research',
        query,
      }))
    }
  }
  const status = live && needed ? 'PARTIAL' : live ? 'LIVE' : 'CONFIG_NEEDED'
  const selected = [...usedProviders][0] ?? null
  return {
    records,
    queries,
    status,
    selectedProvider: selected,
    providers: { ...providers, selected },
  }
  } finally {
    if (opts?.missionId) releaseFoundryResearchMission(opts.missionId)
  }
}
