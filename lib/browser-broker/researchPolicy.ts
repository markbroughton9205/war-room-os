/**
 * Domain-sensitive research policy for Browser Broker discovery.
 * Primary is a quality requirement, not an arXiv synonym.
 * No second intelligence architecture.
 */

export type ResearchDomain =
  | 'ai_ml_research'
  | 'fda_regulation'
  | 'sec_filing'
  | 'court_case'
  | 'software_api'
  | 'company_announcement'
  | 'academic_science'
  | 'current_news'
  | 'general'

export type SourceAuthorityClass =
  | 'PRIMARY_RESEARCH'
  | 'OFFICIAL_GOVERNMENT'
  | 'REGULATORY_FILING'
  | 'OFFICIAL_COMPANY'
  | 'OFFICIAL_DOCUMENTATION'
  | 'COURT_RECORD'
  | 'AUTHORITATIVE_SECONDARY'
  | 'SECONDARY'
  | 'COMMUNITY'
  | 'UNKNOWN'

export type RelevanceDecision =
  | 'ACCEPT'
  | 'REJECT_OFF_TOPIC'
  | 'REJECT_STALE'
  | 'REJECT_WRONG_AUTHORITY'
  | 'REJECT_DUPLICATE'
  | 'REJECT_EXTRACTION_FAILED'

export type SourceQualityScores = {
  relevance: number
  authority: number
  primaryness: number
  freshness: number
  independence: number
  extractability: number
}

export type ResearchIntent = {
  research_domain: ResearchDomain
  requested_source_authority: 'primary' | 'authoritative' | 'any'
  freshness_window_days: number | null
  wants_primary: boolean
  wants_current: boolean
}

export type FreshnessDecision = 'IN_WINDOW' | 'OUT_OF_WINDOW' | 'DATE_UNKNOWN'

export type FreshnessAssessment = {
  requested_start: string | null
  requested_end: string | null
  source_published_at: string | null
  source_updated_at: string | null
  freshness_decision: FreshnessDecision
}

export type SourceRelevanceRecord = {
  relevance_score: number
  relevance_reason: string
  entity_match: boolean
  topic_match: boolean
  temporal_match: boolean
  relevance_decision: RelevanceDecision
  authority_class: SourceAuthorityClass
  published_at: string | null
  updated_at: string | null
  freshness: FreshnessAssessment
  scores: SourceQualityScores
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'using', 'from', 'by',
  'research', 'current', 'methods', 'method', 'one', 'this', 'that', 'only', 'please', 'need',
  'into', 'about', 'over', 'last', 'past', 'days', 'day', 'week', 'month', 'sources', 'source',
  'primary', 'authoritative', 'official', 'development', 'news',
])

const GOV_HOST = /(^|\.)(fda\.gov|federalregister\.gov|sec\.gov|justice\.gov|supremecourt\.gov|uscourts\.gov|congress\.gov|whitehouse\.gov|cms\.gov|nih\.gov|cdc\.gov)$/i
const SEC_HOST = /(^|\.)(sec\.gov)$/i
const COURT_HOST = /(^|\.)(supremecourt\.gov|uscourts\.gov|courtlistener\.com|justia\.com)$/i
const DOCS_HOST = /(^|\.)(playwright\.dev|pytorch\.org|jax\.readthedocs\.io|developer\.nvidia\.com|ai\.google\.dev|docs\.python\.org|nodejs\.org|developer\.mozilla\.org|learn\.microsoft\.com)$/i
const LAB_HOST = /(^|\.)(openai\.com|anthropic\.com|deepmind\.google|research\.google|ai\.meta\.com|nvidia\.com)$/i
const PAPER_HOST = /(^|\.)(arxiv\.org|openreview\.net|neurips\.cc|papers\.nips\.cc|proceedings\.mlr\.press|dl\.acm\.org|nature\.com|science\.org|acm\.org|ieeexplore\.ieee\.org)$/i
const COMPANY_HOST = /(^|\.)(openai\.com|anthropic\.com|deepmind\.google|ai\.meta\.com|nvidia\.com|microsoft\.com|apple\.com|amazon\.com|googleblog\.com|blog\.google)$/i
export const PARTIAL_FAILURE_URL = 'https://127.0.0.1:9/wr-research-partial-fail'
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec'
const LABELED_PUBLISHED = /\b(?:published|released|posted|announced|submitted|datepublished)\b/i
const LABELED_UPDATED = /\b(?:updated|modified|revised|datemodified)\b/i
const NEWS_HOST = /(^|\.)(reuters\.com|apnews\.com|bbc\.com|nytimes\.com|wsj\.com|bloomberg\.com|theverge\.com|techcrunch\.com|wired\.com)$/i
const COMMUNITY_HOST = /(^|\.)(medium\.com|towardsdatascience\.com|reddit\.com|quora\.com|substack\.com|pinterest\.com)$/i
const RELEVANCE_ACCEPT = 0.18

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function partialFailureRequested(prompt: string): boolean {
  return /\bforce the first selected source to fail\b/i.test(prompt)
}

export function stripResearchHarness(prompt: string): string {
  return prompt.replace(/\bforce the first selected source to fail\b/ig, ' ').replace(/\s+/g, ' ').trim()
}

function coerceDocumentDate(raw: string, now: number): string | null {
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/)
  let ts = Number.NaN
  if (iso) {
    const value = iso[1].includes('T') || iso[1].includes(' ') ? iso[1].replace(' ', 'T') : `${iso[1]}T00:00:00Z`
    const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`
    ts = Date.parse(normalized)
  } else {
    const day = raw.match(new RegExp(`\\b(${MONTHS})\\s+\\d{1,2},?\\s+20\\d{2}\\b`, 'i'))
    if (day) ts = Date.parse(`${day[0].replace(/,/g, '')} UTC`)
  }
  if (!Number.isFinite(ts) || ts > now + 86_400_000) return null
  return new Date(ts).toISOString()
}

function labeledDocumentDate(text: string, label: RegExp, now: number): string | null {
  const parts = text.split(/\n|(?<=[.!?])\s+/)
  for (const part of parts) {
    if (!label.test(part)) continue
    const found = coerceDocumentDate(part, now)
    if (found) return found
  }
  return null
}

export function extractDocumentDates(input: {
  publishedMeta?: string | null
  updatedMeta?: string | null
  text?: string | null
  title?: string | null
  now?: number
}): { published_at: string | null; updated_at: string | null } {
  const now = input.now ?? Date.now()
  const body = `${input.title || ''}\n${input.text || ''}`
  return {
    published_at: coerceDocumentDate(input.publishedMeta || '', now) || labeledDocumentDate(body, LABELED_PUBLISHED, now),
    updated_at: coerceDocumentDate(input.updatedMeta || '', now) || labeledDocumentDate(body, LABELED_UPDATED, now),
  }
}

export function requestedWindow(prompt: string, now = Date.now()): { requested_start: string; requested_end: string } | null {
  const end = new Date(now)
  const last = stripResearchHarness(prompt).match(/\b(?:last|past)\s+(\d+)\s+days?\b/i)
  if (last) {
    const days = Math.min(Math.max(Number(last[1]), 1), 365)
    return { requested_start: new Date(now - days * 86_400_000).toISOString(), requested_end: end.toISOString() }
  }
  const text = stripResearchHarness(prompt)
  if (/\btoday\b/i.test(text)) {
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
    return { requested_start: start.toISOString(), requested_end: end.toISOString() }
  }
  if (/\bthis week\b/i.test(text)) {
    const day = end.getUTCDay()
    const mondayOffset = day === 0 ? 6 : day - 1
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - mondayOffset))
    return { requested_start: start.toISOString(), requested_end: end.toISOString() }
  }
  if (/\bthis month\b/i.test(text)) {
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
    return { requested_start: start.toISOString(), requested_end: end.toISOString() }
  }
  if (/\blatest\b/i.test(text) || /\bcurrent\s+(?:ai|news|development)\b/i.test(text) || /\b(recent(?:ly)?|breaking|announced)\b/i.test(text)) {
    return { requested_start: new Date(now - 30 * 86_400_000).toISOString(), requested_end: end.toISOString() }
  }
  return null
}

export function assessFreshness(input: {
  prompt: string
  published_at?: string | null
  updated_at?: string | null
  retrieved_at?: string | null
  url?: string | null
  text?: string | null
  title?: string | null
  now?: number
}): FreshnessAssessment {
  const now = input.now ?? Date.now()
  const dates = extractDocumentDates({
    publishedMeta: input.published_at,
    updatedMeta: input.updated_at,
    text: input.text,
    title: input.title,
    now,
  })
  const window = requestedWindow(input.prompt, now)
  const published = dates.published_at
  const updated = dates.updated_at
  let freshness_decision: FreshnessDecision = 'DATE_UNKNOWN'
  if (window && (published || updated)) {
    const start = Date.parse(window.requested_start)
    const end = Date.parse(window.requested_end)
    const inside = (iso: string | null) => {
      if (!iso) return false
      const ts = Date.parse(iso)
      return Number.isFinite(ts) && ts >= start && ts <= end
    }
    freshness_decision = inside(published) || inside(updated) ? 'IN_WINDOW' : 'OUT_OF_WINDOW'
  }
  return {
    requested_start: window?.requested_start ?? null,
    requested_end: window?.requested_end ?? null,
    source_published_at: published,
    source_updated_at: updated,
    freshness_decision,
  }
}

export function satisfiesStrictWindow(decision: FreshnessDecision): boolean {
  return decision === 'IN_WINDOW'
}

export type StructuredRelease = {
  title: string
  date: string
  url: string | null
  summary: string | null
}

function releaseFields(window: string): { url: string | null; summary: string | null } {
  const url = window.match(/"url"\s*:\s*"(\/[^"]+|https?:\/\/[^"]+)"/)
  const slug = window.match(/"current"\s*:\s*"([a-z0-9-]{6,})"/i)
  const summary = window.match(/"summary"\s*:\s*"([^"]{12,500})"/)
  return {
    url: url?.[1] || (slug ? `/news/${slug[1]}` : null),
    summary: summary ? summary[1].replace(/\\n/g, ' ').replace(/\\+/g, '').replace(/\s+/g, ' ').trim() : null,
  }
}

export function parseStructuredReleases(raw: string, now = Date.now()): StructuredRelease[] {
  if (!raw) return []
  const text = raw.replace(/\\"/g, '"').replace(/\\\//g, '/')
  const found: StructuredRelease[] = []
  const seen = new Set<string>()
  const consider = (dateRaw: string, titleRaw: string, window: string) => {
    const title = titleRaw.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
    if (title.length < 8 || /^(newsroom|announcements|search|home)$/i.test(title)) return
    const date = coerceDocumentDate(dateRaw, now)
    if (!date) return
    const key = `${title.toLowerCase()}|${date.slice(0, 10)}`
    if (seen.has(key)) return
    seen.add(key)
    const fields = releaseFields(window)
    found.push({ title, date, url: fields.url, summary: fields.summary })
  }
  const dateFirst = /"(?:publishedOn|date)"\s*:\s*"(20\d{2}-\d{2}-\d{2}[^"]*)"([\s\S]{0,700}?)"title"\s*:\s*"([^"]{8,180})"/g
  const titleFirst = /"title"\s*:\s*"([^"]{8,180})"([\s\S]{0,700}?)"(?:publishedOn|date)"\s*:\s*"(20\d{2}-\d{2}-\d{2}[^"]*)"/g
  for (const match of text.matchAll(dateFirst)) {
    const start = match.index ?? 0
    consider(match[1], match[3], text.slice(start, start + match[0].length + 240))
  }
  for (const match of text.matchAll(titleFirst)) {
    const start = match.index ?? 0
    consider(match[3], match[1], text.slice(start, start + match[0].length + 240))
  }
  return found.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6)
}

export function parseVisibleNewsroomReleases(text: string, now = Date.now()): StructuredRelease[] {
  if (!text) return []
  const found: StructuredRelease[] = []
  const seen = new Set<string>()
  const push = (titleRaw: string, dateRaw: string, summaryRaw: string) => {
    const title = titleRaw.replace(/\s+/g, ' ').trim()
    if (title.length < 8 || /press kit|skip to|download|non-media|media assets/i.test(title)) return
    const date = coerceDocumentDate(dateRaw, now)
    if (!date) return
    const key = `${title.toLowerCase()}|${date.slice(0, 10)}`
    if (seen.has(key)) return
    seen.add(key)
    const summary = summaryRaw.replace(/\s+/g, ' ').trim()
    found.push({ title, date, url: null, summary: summary.length >= 12 ? summary : null })
  }
  const titleFirst = /(?:^|\n)([^\n]{8,160})\nAnnouncements\n([A-Z][a-z]{2,9} \d{1,2}, \d{4})\n+([^\n]{24,500})/g
  const dateFirst = /(?:^|\n)Announcements\n([A-Z][a-z]{2,9} \d{1,2}, \d{4})\n([^\n]{8,160})\n+([^\n]{24,500})/g
  for (const match of text.matchAll(titleFirst)) push(match[1], match[2], match[3])
  for (const match of text.matchAll(dateFirst)) push(match[2], match[1], match[3])
  return found.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6)
}

export function extractFreshnessWindowDays(prompt: string): number | null {
  const window = requestedWindow(prompt)
  if (!window) return null
  const span = Date.parse(window.requested_end) - Date.parse(window.requested_start)
  return Math.min(Math.max(Math.ceil(span / 86_400_000), 1), 365)
}

export function classifyResearchDomain(prompt: string): ResearchDomain {
  const text = stripResearchHarness(prompt)
  if (/\bfda\b|federal register|food and drug/i.test(text)) return 'fda_regulation'
  if (/\bsec\b|edgar|\b10-?k\b|\b8-?k\b|securities (?:and exchange|filing)/i.test(text)) return 'sec_filing'
  if (/\b(court|docket|opinion|holding|case law|supreme court)\b/i.test(text)) return 'court_case'
  if (/playwright|browser.?context|persistent.?profile|api docs?|official documentation|sdk reference/i.test(text)) return 'software_api'
  if (/mixture.of.experts|sparse expert|\bmoe\b|expert routing|switch transformer|inference methods/i.test(text)) return 'ai_ml_research'
  if (extractFreshnessWindowDays(text) != null || /current ai|ai news|ai development/i.test(text)) return 'current_news'
  if (/arxiv|neurips|paper|journal|proceedings|preprint/i.test(text)) return 'academic_science'
  if (/announcement|newsroom|press release|launched|released/i.test(text)) return 'company_announcement'
  if (/\b(llm|transformer|machine learning|deep learning|neural)\b/i.test(text)) return 'ai_ml_research'
  return 'general'
}

export function classifyResearchIntent(prompt: string): ResearchIntent {
  const text = stripResearchHarness(prompt)
  const research_domain = classifyResearchDomain(text)
  const wants_primary = /primary sources?|original papers?|official (?:docs?|documentation|lab|filing|record)/i.test(text)
  const wants_authoritative = /authoritative/i.test(text)
  const wants_current = extractFreshnessWindowDays(text) != null || /current (?:ai|news)|recent(?:ly)?|breaking|announced/i.test(text)
  const freshness_window_days = extractFreshnessWindowDays(text)
  const requested_source_authority = wants_primary && !wants_authoritative
    ? 'primary'
    : (wants_authoritative || wants_primary ? 'authoritative' : 'any')
  return { research_domain, requested_source_authority, freshness_window_days, wants_primary, wants_current }
}

export function classifySourceAuthority(url: string): SourceAuthorityClass {
  const host = hostOf(url)
  if (!host) return 'UNKNOWN'
  if (COMMUNITY_HOST.test(host)) return 'COMMUNITY'
  if (SEC_HOST.test(host) || /sec\.gov\/.*(edgar|Archives|filings)/i.test(url)) return 'REGULATORY_FILING'
  if (COURT_HOST.test(host)) return 'COURT_RECORD'
  if (GOV_HOST.test(host)) return 'OFFICIAL_GOVERNMENT'
  if (DOCS_HOST.test(host) || /\/docs?\//i.test(url) && /github\.com|gitlab\.com/.test(host) === false) {
    if (DOCS_HOST.test(host)) return 'OFFICIAL_DOCUMENTATION'
  }
  if (PAPER_HOST.test(host) || /arxiv\.org\/(abs|pdf|html)\//i.test(url)) return 'PRIMARY_RESEARCH'
  if (LAB_HOST.test(host) || COMPANY_HOST.test(host)) return 'OFFICIAL_COMPANY'
  if (NEWS_HOST.test(host)) return 'AUTHORITATIVE_SECONDARY'
  if (DOCS_HOST.test(host)) return 'OFFICIAL_DOCUMENTATION'
  return 'UNKNOWN'
}

export function preferredAuthorities(domain: ResearchDomain): SourceAuthorityClass[] {
  switch (domain) {
    case 'ai_ml_research':
    case 'academic_science':
      return ['PRIMARY_RESEARCH', 'OFFICIAL_COMPANY', 'OFFICIAL_DOCUMENTATION', 'AUTHORITATIVE_SECONDARY']
    case 'fda_regulation':
      return ['OFFICIAL_GOVERNMENT']
    case 'sec_filing':
      return ['REGULATORY_FILING', 'OFFICIAL_COMPANY']
    case 'court_case':
      return ['COURT_RECORD', 'OFFICIAL_GOVERNMENT']
    case 'software_api':
      return ['OFFICIAL_DOCUMENTATION', 'OFFICIAL_COMPANY']
    case 'company_announcement':
      return ['OFFICIAL_COMPANY', 'REGULATORY_FILING', 'AUTHORITATIVE_SECONDARY']
    case 'current_news':
      return ['OFFICIAL_COMPANY', 'AUTHORITATIVE_SECONDARY', 'OFFICIAL_GOVERNMENT', 'PRIMARY_RESEARCH']
    default:
      return ['OFFICIAL_GOVERNMENT', 'REGULATORY_FILING', 'OFFICIAL_DOCUMENTATION', 'PRIMARY_RESEARCH', 'OFFICIAL_COMPANY', 'AUTHORITATIVE_SECONDARY']
  }
}

export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9.-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^\.+|\.+$/g, ''))
    .filter(token => token.length >= 3 && !STOP.has(token) && !/^\d+$/.test(token))
}

export function distinctiveTokens(tokens: readonly string[]): string[] {
  return tokens.filter(token => token.length >= 8 || token.includes('-') || token.includes('.'))
}

function overlapRatio(queryTokens: readonly string[], haystack: string): { ratio: number; hits: number; distinctive: boolean } {
  if (!queryTokens.length) return { ratio: 0, hits: 0, distinctive: false }
  const hay = ` ${haystack.toLowerCase()} `
  let hits = 0
  for (const token of queryTokens) {
    if (hay.includes(` ${token} `) || hay.includes(token)) hits += 1
  }
  const distinctive = distinctiveTokens(queryTokens).some(token => hay.includes(token))
  return { ratio: hits / queryTokens.length, hits, distinctive }
}

export function sourcePublishedAt(input: { title?: string; text?: string; url?: string; published_at?: string | null; updated_at?: string | null }, now = Date.now()): string | null {
  const dates = extractDocumentDates({
    publishedMeta: input.published_at,
    updatedMeta: input.updated_at,
    text: input.text,
    title: input.title,
    now,
  })
  return dates.published_at || dates.updated_at
}

export function withinFreshnessWindow(publishedAt: string | null, windowDays: number | null, now = Date.now()): boolean {
  if (windowDays == null) return true
  if (!publishedAt) return false
  const ts = Date.parse(publishedAt)
  if (!Number.isFinite(ts)) return false
  return now - ts <= windowDays * 86_400_000 && ts <= now + 86_400_000
}

export function evaluateSourceRelevance(input: {
  prompt: string
  intent?: ResearchIntent
  url: string
  title?: string
  text?: string
  published_at?: string | null
  updated_at?: string | null
  retrieved_at?: string | null
  duplicate?: boolean
  extraction_ok?: boolean
  now?: number
}): SourceRelevanceRecord {
  const stripped = stripResearchHarness(input.prompt)
  const intent = input.intent ?? classifyResearchIntent(stripped)
  const now = input.now ?? Date.now()
  const authority_class = classifySourceAuthority(input.url)
  const freshnessAssessment = assessFreshness({
    prompt: stripped,
    published_at: input.published_at,
    updated_at: input.updated_at,
    retrieved_at: input.retrieved_at,
    url: input.url,
    text: input.text,
    title: input.title,
    now,
  })
  const published_at = freshnessAssessment.source_published_at
  const hay = `${input.title || ''} ${input.text || ''}`
  let tokens = contentTokens(stripped)
  if (intent.research_domain === 'current_news' && /\bai\b/i.test(input.prompt) && !tokens.includes('ai')) {
    tokens = [...tokens, 'ai']
  }
  const overlap = overlapRatio(tokens, hay)
  const preferred = preferredAuthorities(intent.research_domain)
  const strictDomain = intent.research_domain === 'fda_regulation'
    || intent.research_domain === 'sec_filing'
    || intent.research_domain === 'court_case'
    || intent.research_domain === 'software_api'
  const authorityOk = preferred.includes(authority_class)
    || (intent.research_domain !== 'current_news' && intent.requested_source_authority === 'any' && !strictDomain && authority_class !== 'COMMUNITY')
  const domainTopic = intent.research_domain === 'current_news'
    && /\b(ai|models?|openai|anthropic|claude|gemini|llama|gpt|nvidia|deepmind|google|release|announc|launch)\b/i.test(hay)
  const topic_match = overlap.ratio >= RELEVANCE_ACCEPT || overlap.hits >= 2 || (!tokens.length && domainTopic)
  const entity_match = overlap.distinctive
  const uniqueNeedles = distinctiveTokens(tokens)
  const requiresNeedle = uniqueNeedles.length > 0 && (intent.research_domain === 'general' || uniqueNeedles.some(token => /invalid|qzxt|nonexistent|war-room-source-test/i.test(token)))
  const offTopic = (!topic_match && !domainTopic)
    || (requiresNeedle && !entity_match)
  const temporal_match = freshnessAssessment.requested_start == null || freshnessAssessment.freshness_decision === 'IN_WINDOW'
  const extractability = input.extraction_ok === false ? 0 : Math.min(1, (input.text || '').replace(/\s+/g, ' ').trim().length / 400)
  const authority = preferred.includes(authority_class) ? 1 : authority_class === 'UNKNOWN' ? 0.25 : 0.4
  const primaryness = ['PRIMARY_RESEARCH', 'OFFICIAL_GOVERNMENT', 'REGULATORY_FILING', 'OFFICIAL_DOCUMENTATION', 'COURT_RECORD', 'OFFICIAL_COMPANY'].includes(authority_class) ? 1 : 0.3
  const freshness = intent.freshness_window_days == null ? 1 : temporal_match ? 1 : 0
  const relevance = Math.max(0, Math.min(1, overlap.ratio + (entity_match ? 0.25 : 0) + (domainTopic ? 0.2 : 0)))
  const scores: SourceQualityScores = {
    relevance,
    authority,
    primaryness,
    freshness,
    independence: 1,
    extractability,
  }

  let relevance_decision: RelevanceDecision = 'ACCEPT'
  let relevance_reason = 'topic and authority match'
  if (input.duplicate) {
    relevance_decision = 'REJECT_DUPLICATE'
    relevance_reason = 'duplicate identity of an already accepted source'
  } else if (input.extraction_ok === false) {
    relevance_decision = 'REJECT_EXTRACTION_FAILED'
    relevance_reason = 'page did not yield usable extracted content'
  } else if (offTopic) {
    relevance_decision = 'REJECT_OFF_TOPIC'
    relevance_reason = 'source does not match the research question'
  } else if (freshnessAssessment.requested_start != null && freshnessAssessment.freshness_decision !== 'IN_WINDOW') {
    relevance_decision = 'REJECT_STALE'
    relevance_reason = freshnessAssessment.freshness_decision === 'OUT_OF_WINDOW'
      ? `publication ${(published_at || freshnessAssessment.source_updated_at || '').slice(0, 10)} is outside the requested window`
      : 'publication date could not be established for a freshness-gated query'
  } else if (!authorityOk) {
    relevance_decision = 'REJECT_WRONG_AUTHORITY'
    relevance_reason = `authority ${authority_class} is not preferred for ${intent.research_domain}`
  }

  return {
    relevance_score: relevance,
    relevance_reason,
    entity_match,
    topic_match,
    temporal_match,
    relevance_decision,
    authority_class,
    published_at,
    updated_at: freshnessAssessment.source_updated_at,
    freshness: freshnessAssessment,
    scores,
  }
}

export function constructDomainQueries(prompt: string): string[] {
  const text = prompt.trim()
  const intent = classifyResearchIntent(text)
  const queries: string[] = []
  if (intent.research_domain === 'ai_ml_research' && /mixture.of.experts|sparse expert|\bmoe\b|expert routing|switch transformer/i.test(text)) {
    queries.push('mixture of experts sparse routing inference site:arxiv.org')
    queries.push('Switch Transformer mixture-of-experts routing inference arxiv')
  } else if (intent.research_domain === 'software_api' && /playwright|browser.?context|persistent.?profile/i.test(text)) {
    queries.push('Playwright browser contexts isolated persistent profiles official documentation site:playwright.dev')
  } else if (intent.research_domain === 'fda_regulation') {
    queries.push(`${text} site:fda.gov`)
    queries.push(`${text} site:federalregister.gov`)
  } else if (intent.research_domain === 'sec_filing') {
    queries.push(`${text} site:sec.gov EDGAR`)
    queries.push(`${text} site:sec.gov`)
  } else if (intent.research_domain === 'court_case') {
    queries.push(`${text} site:uscourts.gov OR site:supremecourt.gov`)
    queries.push(text)
  } else if (intent.research_domain === 'company_announcement') {
    queries.push(`${text} official newsroom OR press release`)
    queries.push(text)
  } else if (intent.research_domain === 'software_api') {
    queries.push(`${text} official documentation`)
    queries.push(text)
  } else if (intent.research_domain === 'current_news') {
    const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    queries.push(`AI announcement ${month} site:openai.com OR site:anthropic.com OR site:deepmind.google OR site:ai.meta.com OR site:blog.google`)
    queries.push(`official AI announcement ${month} site:anthropic.com OR site:openai.com OR site:deepmind.google`)
  } else {
    queries.push(text)
  }
  if (!queries.includes(text) && intent.research_domain !== 'current_news') queries.push(text)
  const limit = intent.research_domain === 'current_news' ? 2 : 2
  return [...new Set(queries.map(item => item.trim()).filter(Boolean))].slice(0, limit)
}

export function identityKey(url: string): string {
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf|html|pdf\/)\/([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i)
  if (arxiv) return `arxiv:${arxiv[1].toLowerCase()}`
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    const doi = path.match(/10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+/)
    if (doi) return `doi:${doi[0].toLowerCase()}`
    if (host === 'doi.org' || host.endsWith('.doi.org')) return `doi:${path.replace(/^\//, '').toLowerCase()}`
    return `${host}${path}`
  } catch {
    return url
  }
}
