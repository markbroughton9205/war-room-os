/**
 * Structured web-research discovery for Council Browser Broker.
 * Unwraps search redirects, ranks primary sources, and emits candidates.
 * Does not invent a second intelligence architecture.
 */
import { classifyResearchIntent, classifySourceAuthority, constructDomainQueries, identityKey, preferredAuthorities } from './researchPolicy'

export type ResearchSourceType =
  | 'primary_paper'
  | 'official_docs'
  | 'lab_research'
  | 'conference'
  | 'authoritative'
  | 'secondary'
  | 'unknown'

export type ResearchSourceCandidate = {
  url: string
  title: string
  domain: string
  source_type: ResearchSourceType
  primary_candidate: boolean
  discovered_by: 'search' | 'seed' | 'alternate'
  query: string
  rank: number
  reason_selected: string
}

const SEARCH_HOST = /(^|\.)(duckduckgo\.com|google\.[a-z.]+|bing\.com|yahoo\.com|search\.yahoo\.com)$/i
const SEO_HOST = /(^|\.)(medium\.com|towardsdatascience\.com|reddit\.com|quora\.com|substack\.com|pinterest\.com)$/i
const PRIMARY_HOST = /(^|\.)(arxiv\.org|openai\.com|anthropic\.com|deepmind\.google|research\.google|ai\.google(?:\.dev)?|ai\.meta\.com|developer\.nvidia\.com|nvidia\.com|pytorch\.org|jax\.readthedocs\.io|neurips\.cc|papers\.nips\.cc|proceedings\.mlr\.press|openreview\.net|dl\.acm\.org|ieeexplore\.ieee\.org|nature\.com|science\.org|acm\.org|playwright\.dev)$/i
const PAPER_HOST = /(^|\.)(arxiv\.org|openreview\.net|neurips\.cc|papers\.nips\.cc|proceedings\.mlr\.press|dl\.acm\.org|nature\.com|science\.org)$/i
const DOCS_HOST = /(^|\.)(playwright\.dev|pytorch\.org|jax\.readthedocs\.io|developer\.nvidia\.com|ai\.google\.dev)$/i
const LAB_HOST = /(^|\.)(openai\.com|anthropic\.com|deepmind\.google|research\.google|ai\.meta\.com|nvidia\.com)$/i

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function unwrapSearchResultUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  let current = raw.trim()
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      let decoded = current
      try {
        decoded = decodeURIComponent(current)
      } catch {
        decoded = current
      }
      const parsed = new URL(decoded, 'https://html.duckduckgo.com/')
      const uddg = parsed.searchParams.get('uddg') || parsed.searchParams.get('u')
      if (uddg) {
        current = uddg
        continue
      }
      if (SEARCH_HOST.test(parsed.hostname.replace(/^www\./, ''))) return ''
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
      parsed.hash = ''
      for (const key of [...parsed.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|yclid|_ga|_gl|rut$)/i.test(key) || key === 'rut') {
          parsed.searchParams.delete(key)
        }
      }
      return parsed.toString()
    } catch {
      return ''
    }
  }
  return ''
}

export function paperIdentity(url: string): string {
  return identityKey(url)
}

export function classifySourceType(url: string): ResearchSourceType {
  const host = hostOf(url)
  if (!host) return 'unknown'
  if (PAPER_HOST.test(host) || /arxiv\.org\/(abs|pdf|html)\//i.test(url)) return 'primary_paper'
  if (DOCS_HOST.test(host)) return 'official_docs'
  if (LAB_HOST.test(host)) return 'lab_research'
  if (/(^|\.)(neurips\.cc|openreview\.net|acm\.org)$/i.test(host)) return 'conference'
  if (PRIMARY_HOST.test(host)) return 'authoritative'
  if (SEO_HOST.test(host)) return 'secondary'
  return 'unknown'
}

export function isPrimaryCandidate(url: string, wantsPrimary: boolean): boolean {
  const type = classifySourceType(url)
  if (type === 'primary_paper' || type === 'lab_research' || type === 'conference' || type === 'official_docs') return true
  if (!wantsPrimary && type === 'authoritative') return true
  return false
}

export function wantsPrimarySources(query: string): boolean {
  return /primary sources?|original papers?|arxiv|official (?:docs?|documentation|lab)/i.test(query)
}

export function wantsCurrentInfo(query: string): boolean {
  return /last \d+\s+days|past \d+\s+days|current (?:ai|news|development)|this (?:week|month)|\btoday\b|\blatest\b|recent(?:ly)?|breaking|announced/i.test(query)
}

export function constructResearchQueries(prompt: string): string[] {
  return constructDomainQueries(prompt)
}

export function toCandidate(input: {
  url: string
  title?: string
  discovered_by: ResearchSourceCandidate['discovered_by']
  query: string
  rank: number
  reason_selected?: string
}): ResearchSourceCandidate | null {
  const url = unwrapSearchResultUrl(input.url) || (/^https?:\/\//i.test(input.url) && !SEARCH_HOST.test(hostOf(input.url)) ? input.url : '')
  if (!url) return null
  const host = hostOf(url)
  if (!host || SEARCH_HOST.test(host) || SEO_HOST.test(host)) return null
  const source_type = classifySourceType(url)
  const primary_candidate = isPrimaryCandidate(url, true)
  return {
    url,
    title: (input.title || host).trim(),
    domain: host,
    source_type,
    primary_candidate,
    discovered_by: input.discovered_by,
    query: input.query,
    rank: input.rank,
    reason_selected: input.reason_selected || (primary_candidate ? 'primary_or_authoritative_host' : 'search_result'),
  }
}

export function selectResearchCandidates(
  candidates: readonly ResearchSourceCandidate[],
  input: { wantsPrimary: boolean; wantsCurrent: boolean; limit?: number; prompt?: string },
): ResearchSourceCandidate[] {
  const ceiling = input.wantsCurrent ? 8 : 5
  const limit = Math.min(Math.max(input.limit ?? 4, 3), ceiling)
  const intent = input.prompt ? classifyResearchIntent(input.prompt) : null
  const preferred = intent ? preferredAuthorities(intent.research_domain) : []
  const seen = new Set<string>()
  const scored = candidates
    .map((candidate, index) => {
      let score = 10 - Math.min(candidate.rank, 9)
      if (candidate.primary_candidate) score += 20
      if (candidate.source_type === 'primary_paper') score += 12
      if (candidate.source_type === 'lab_research') score += 8
      if (candidate.source_type === 'official_docs') score += 8
      if (input.wantsPrimary && candidate.source_type === 'secondary') score -= 30
      if (input.wantsCurrent && candidate.source_type === 'lab_research') score += 6
      if (preferred.length) {
        const authority = classifySourceAuthority(candidate.url)
        if (preferred.includes(authority)) score += 16
        else if (authority === 'COMMUNITY') score -= 40
      }
      return { candidate, score, index }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const currentNews = intent?.research_domain === 'current_news'
  const selected: ResearchSourceCandidate[] = []
  for (const row of scored) {
    if (currentNews && !preferred.includes(classifySourceAuthority(row.candidate.url))) continue
    const key = paperIdentity(row.candidate.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    selected.push({
      ...row.candidate,
      rank: selected.length + 1,
      reason_selected: row.candidate.primary_candidate
        ? 'preferred primary/authoritative source'
        : 'bounded search candidate',
    })
    if (selected.length >= limit) break
  }
  return selected
}

export function extractionLooksUsable(input: { title?: string; text?: string; url?: string }): boolean {
  const title = (input.title || '').trim()
  const text = (input.text || '').replace(/\s+/g, ' ').trim()
  if (!input.url || !/^https?:\/\//i.test(input.url)) return false
  if (text.length < 80) return false
  if (/just a moment|access denied|403 forbidden|404 not found|captcha|enable javascript|enable cookies/i.test(text.slice(0, 400))) return false
  if (/opened no usable sources|browser probe failed/i.test(text)) return false
  if (title && /error|forbidden|not found/i.test(title) && text.length < 200) return false
  return true
}

export function parsePublishedAt(text: string, now = Date.now()): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?)/)
  if (iso) {
    const ts = Date.parse(iso[1])
    if (Number.isFinite(ts) && ts <= now + 86_400_000) return new Date(ts).toISOString()
  }
  const submitted = text.match(/Submitted\s+(?:on\s+)?([A-Z][a-z]+ \d{1,2},?\s+20\d{2})/i)
  if (submitted) {
    const ts = Date.parse(submitted[1])
    if (Number.isFinite(ts)) return new Date(ts).toISOString()
  }
  const human = text.match(/\b([A-Z][a-z]+ \d{1,2},?\s+20\d{2})\b/)
  if (human) {
    const ts = Date.parse(human[1])
    if (Number.isFinite(ts) && ts <= now + 86_400_000) return new Date(ts).toISOString()
  }
  return null
}

export async function fetchDuckDuckGoCandidates(query: string, limit = 8): Promise<ResearchSourceCandidate[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.slice(0, 240))}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'WarRoom-Council-Research/1.0 (GET-only discovery)',
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return []
    const html = await res.text()
    const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map(match => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    const uddg = [...html.matchAll(/uddg=([^&"]+)/g)].map(match => {
      try {
        return decodeURIComponent(match[1])
      } catch {
        return ''
      }
    })
    const out: ResearchSourceCandidate[] = []
    for (let i = 0; i < uddg.length && out.length < limit; i += 1) {
      const candidate = toCandidate({
        url: uddg[i],
        title: titles[i] || uddg[i],
        discovered_by: 'search',
        query,
        rank: i + 1,
        reason_selected: 'duckduckgo_html_unwrap',
      })
      if (candidate) out.push(candidate)
    }
    return out
  } catch {
    return []
  }
}
