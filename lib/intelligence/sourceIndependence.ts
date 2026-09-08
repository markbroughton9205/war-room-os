import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { evidenceTextForHash, hashEvidenceContent, normalizeEvidenceText, textsAreNearDuplicate } from '@/lib/intelligence/contentHash'
import type {
  IntelligenceEvidenceItem,
  SourceAuthorityClass,
  TranslationStatus,
} from '@/lib/intelligence/intelligencePacket'

export type { SourceAuthorityClass, TranslationStatus }

export type IndependentEvidenceItem = IntelligenceEvidenceItem

export type EvidenceCluster = {
  cluster_id: string
  cluster_head_id: string
  source_family: string
  independence_key: string
  member_ids: string[]
  urls: string[]
  region: string | null
}

const WIRE_FAMILIES: Array<{ family: string; pattern: RegExp; host?: RegExp }> = [
  { family: 'reuters', pattern: /\breuters\b/i, host: /(^|\.)reuters\.com$/i },
  { family: 'associated_press', pattern: /\b(associated press|\(ap\)|\bap\b)\b/i, host: /(^|\.)apnews\.com$/i },
  { family: 'afp', pattern: /\b(afp|agence france[- ]presse)\b/i },
  { family: 'upi', pattern: /\bunited press international|\bupi\b/i },
  { family: 'kyodo', pattern: /\bkyodo\b/i },
  { family: 'yonhap', pattern: /\byonhap\b/i },
  { family: 'xinhua', pattern: /\bxinhua\b/i },
  { family: 'pa_media', pattern: /\bpress association\b|\bpa media\b/i },
]

const HOST_AUTHORITY: Array<{ host: RegExp; authority: SourceAuthorityClass; family: string; jurisdiction?: string; country?: string }> = [
  { host: /(^|\.)sec\.gov$/i, authority: 'PRIMARY_CORPORATE', family: 'sec_edgar', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)federalregister\.gov$/i, authority: 'PRIMARY_REGULATOR', family: 'federal_register', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)ecfr\.gov$/i, authority: 'PRIMARY_REGULATOR', family: 'ecfr', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)fmcsa\.dot\.gov$/i, authority: 'PRIMARY_REGULATOR', family: 'fmcsa', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)transportation\.gov$/i, authority: 'PRIMARY_REGULATOR', family: 'usdot', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)congress\.gov$/i, authority: 'PRIMARY_GOVERNMENT', family: 'congress_gov', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)govinfo\.gov$/i, authority: 'PRIMARY_GOVERNMENT', family: 'govinfo', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)census\.gov$/i, authority: 'PRIMARY_DATA', family: 'us_census', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)data\.gov$/i, authority: 'PRIMARY_DATA', family: 'data_gov', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)statcan\.gc\.ca$/i, authority: 'PRIMARY_DATA', family: 'statcan', jurisdiction: 'CA', country: 'CA' },
  { host: /(^|\.)bankofcanada\.ca$/i, authority: 'PRIMARY_DATA', family: 'bank_of_canada', jurisdiction: 'CA', country: 'CA' },
  { host: /(^|\.)europa\.eu$/i, authority: 'PRIMARY_GOVERNMENT', family: 'eu_institutions', jurisdiction: 'EU' },
  { host: /(^|\.)eurostat\.ec\.europa\.eu$/i, authority: 'PRIMARY_DATA', family: 'eurostat', jurisdiction: 'EU' },
  { host: /(^|\.)ecb\.europa\.eu$/i, authority: 'PRIMARY_DATA', family: 'ecb', jurisdiction: 'EU' },
  { host: /(^|\.)eur-lex\.europa\.eu$/i, authority: 'PRIMARY_GOVERNMENT', family: 'eurlex', jurisdiction: 'EU' },
  { host: /(^|\.)legislation\.gov\.uk$/i, authority: 'PRIMARY_GOVERNMENT', family: 'uk_legislation', jurisdiction: 'UK', country: 'GB' },
  { host: /(^|\.)e-stat\.go\.jp$/i, authority: 'PRIMARY_DATA', family: 'e_stat_japan', jurisdiction: 'JP', country: 'JP' },
  { host: /(^|\.)elaws\.e-gov\.go\.jp$/i, authority: 'PRIMARY_GOVERNMENT', family: 'japan_egov_hourei', jurisdiction: 'JP', country: 'JP' },
  { host: /(^|\.)arxiv\.org$/i, authority: 'PRIMARY_ACADEMIC', family: 'arxiv' },
  { host: /(^|\.)nih\.gov$/i, authority: 'PRIMARY_ACADEMIC', family: 'ncbi', jurisdiction: 'US', country: 'US' },
  { host: /(^|\.)crossref\.org$/i, authority: 'PRIMARY_ACADEMIC', family: 'crossref' },
  { host: /(^|\.)reuters\.com$/i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'reuters' },
  { host: /(^|\.)apnews\.com$/i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'associated_press' },
  { host: /(^|\.)bbc\./i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'bbc' },
  { host: /(^|\.)dw\.com$/i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'deutsche_welle' },
  { host: /(^|\.)lemonde\.fr$/i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'le_monde' },
  { host: /(^|\.)scmp\.com$/i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'scmp' },
  { host: /(^|\.)aljazeera\.com$/i, authority: 'SECONDARY_MAJOR_MEDIA', family: 'al_jazeera' },
  { host: /(^|\.)techcrunch\.com$/i, authority: 'SECONDARY_INDUSTRY', family: 'techcrunch' },
  { host: /(^|\.)ttnews\.com$/i, authority: 'SECONDARY_INDUSTRY', family: 'transport_topics' },
  { host: /(^|\.)overdriveonline\.com$/i, authority: 'SECONDARY_INDUSTRY', family: 'overdrive' },
]

const SOURCE_ID_AUTHORITY: Record<string, { authority: SourceAuthorityClass; family: string; jurisdiction?: string }> = {
  sec_edgar: { authority: 'PRIMARY_CORPORATE', family: 'sec_edgar', jurisdiction: 'US' },
  federal_register: { authority: 'PRIMARY_REGULATOR', family: 'federal_register', jurisdiction: 'US' },
  govinfo: { authority: 'PRIMARY_GOVERNMENT', family: 'govinfo', jurisdiction: 'US' },
  congress_gov: { authority: 'PRIMARY_GOVERNMENT', family: 'congress_gov', jurisdiction: 'US' },
  us_census: { authority: 'PRIMARY_DATA', family: 'us_census', jurisdiction: 'US' },
  fmcsa: { authority: 'PRIMARY_REGULATOR', family: 'fmcsa', jurisdiction: 'US' },
  statcan_wds: { authority: 'PRIMARY_DATA', family: 'statcan', jurisdiction: 'CA' },
  bank_of_canada: { authority: 'PRIMARY_DATA', family: 'bank_of_canada', jurisdiction: 'CA' },
  eurostat: { authority: 'PRIMARY_DATA', family: 'eurostat', jurisdiction: 'EU' },
  ecb_sdw: { authority: 'PRIMARY_DATA', family: 'ecb', jurisdiction: 'EU' },
  uk_legislation: { authority: 'PRIMARY_GOVERNMENT', family: 'uk_legislation', jurisdiction: 'UK' },
  e_stat_japan: { authority: 'PRIMARY_DATA', family: 'e_stat_japan', jurisdiction: 'JP' },
  japan_egov_hourei: { authority: 'PRIMARY_GOVERNMENT', family: 'japan_egov_hourei', jurisdiction: 'JP' },
  jstage: { authority: 'PRIMARY_ACADEMIC', family: 'jstage', jurisdiction: 'JP' },
  ndl_search: { authority: 'PRIMARY_ACADEMIC', family: 'ndl', jurisdiction: 'JP' },
  arxiv: { authority: 'PRIMARY_ACADEMIC', family: 'arxiv' },
  crossref: { authority: 'PRIMARY_ACADEMIC', family: 'crossref' },
  ncbi: { authority: 'PRIMARY_ACADEMIC', family: 'ncbi' },
  x_twitter_discussions: { authority: 'TERTIARY_SOCIAL', family: 'model_social_framing' },
  public_news_rss: { authority: 'SECONDARY_MAJOR_MEDIA', family: 'generic_rss' },
}

export function detectLanguageFromText(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  if (/[\u4e00-\u9fff]/.test(text)) return null
  if (/[\u0600-\u06ff]/.test(text)) return 'ar'
  if (/[äöüß]/.test(text) && /\b(der|die|das|und|für)\b/i.test(text)) return 'de'
  if (/[àâäéèêëïîôùûç]/i.test(text) && /\b(le|la|les|des|une|pour)\b/i.test(text)) return 'fr'
  if (/[áéíóúñ¿¡]/i.test(text) && /\b(el|los|las|una|por)\b/i.test(text)) return 'es'
  if (/^[A-Za-z0-9\s.,;:'"!?()/\-]+$/.test(text.trim())) return 'en'
  return null
}

export function classifySourceAuthority(item: {
  source_id?: string
  source_label?: string
  url?: string
  origin_type?: string
}): SourceAuthorityClass {
  if (item.origin_type === 'MODEL_INFERENCE') return 'MODEL_INFERENCE'
  const host = hostnameFromUrl(item.url)
  if (host) {
    const hit = HOST_AUTHORITY.find(entry => entry.host.test(host))
    if (hit) return hit.authority
  }
  if (item.source_id && SOURCE_ID_AUTHORITY[item.source_id]) return SOURCE_ID_AUTHORITY[item.source_id]!.authority
  const blob = `${item.source_id ?? ''} ${item.source_label ?? ''} ${item.url ?? ''}`
  if (/\b(federal register|fmcsa|ecfr|usdot)\b/i.test(blob)) return 'PRIMARY_REGULATOR'
  if (/\b(sec|edgar|8-k|10-k)\b/i.test(blob)) return 'PRIMARY_CORPORATE'
  if (/\b(court|judiciary)\b/i.test(blob)) return 'PRIMARY_COURT'
  if (/\b(arxiv|pubmed|crossref|doi)\b/i.test(blob)) return 'PRIMARY_ACADEMIC'
  if (/\b(twitter|x\.com|social)\b/i.test(blob)) return 'TERTIARY_SOCIAL'
  if (/\b(bbc|reuters|ap news|al jazeera|deutsche welle|le monde)\b/i.test(blob)) return 'SECONDARY_MAJOR_MEDIA'
  return 'UNKNOWN'
}

export function inferSourceFamily(item: {
  source_id?: string
  source_label?: string
  title?: string
  claim?: string
  content?: string
  url?: string
}): string | null {
  const host = hostnameFromUrl(item.url)
  if (host) {
    const hostHit = HOST_AUTHORITY.find(entry => entry.host.test(host))
    if (hostHit) return hostHit.family
    const wireHost = WIRE_FAMILIES.find(entry => entry.host?.test(host))
    if (wireHost) return wireHost.family
  }
  if (item.source_id && SOURCE_ID_AUTHORITY[item.source_id]) return SOURCE_ID_AUTHORITY[item.source_id]!.family
  const blob = `${item.source_label ?? ''} ${item.title ?? ''} ${item.claim ?? ''} ${item.content ?? ''}`
  const wire = WIRE_FAMILIES.find(entry => entry.pattern.test(blob))
  if (wire) return wire.family
  if (host) return host.replace(/^www\./, '')
  if (item.source_id) return item.source_id
  return null
}

export function inferPublisherFamily(item: { source_label?: string; url?: string; source_id?: string }): string | null {
  const host = hostnameFromUrl(item.url)
  if (host) return host
  const label = item.source_label?.trim().toLowerCase()
  if (label) return label.replace(/\s+/g, '_')
  return item.source_id ?? null
}

export function inferJurisdiction(item: { source_id?: string; url?: string; region?: string | null }): string | null {
  const host = hostnameFromUrl(item.url)
  if (host) {
    const hit = HOST_AUTHORITY.find(entry => entry.host.test(host))
    if (hit?.jurisdiction) return hit.jurisdiction
  }
  if (item.source_id && SOURCE_ID_AUTHORITY[item.source_id]?.jurisdiction) {
    return SOURCE_ID_AUTHORITY[item.source_id]!.jurisdiction ?? null
  }
  if (item.region === 'NORTH_AMERICA') return 'US'
  if (item.region === 'EUROPE') return 'EU'
  if (item.region === 'EAST_ASIA') return 'JP'
  return null
}

export function buildIndependenceKey(item: {
  jurisdiction?: string | null
  source_family?: string | null
  cluster_head_id?: string | null
  content_hash?: string | null
  canonical_url?: string | null
  id?: string
}): string {
  const jurisdiction = item.jurisdiction?.trim() || 'UNKNOWN'
  const family = item.source_family?.trim() || 'UNKNOWN'
  const origin = item.cluster_head_id || item.content_hash || item.canonical_url || item.id || 'UNKNOWN'
  return `${jurisdiction}|${family}|${origin}`
}

export function translationStatusFor(input: {
  originalLanguage: string | null
  queryLanguage: string | null
  translated: boolean
}): TranslationStatus {
  if (input.translated) return 'TRANSLATED'
  if (!input.originalLanguage) return 'UNKNOWN'
  if (!input.queryLanguage || input.originalLanguage === input.queryLanguage || (input.originalLanguage === 'en' && input.queryLanguage === 'en')) {
    return input.originalLanguage === 'en' ? 'NOT_REQUIRED' : 'UNTRANSLATED'
  }
  return 'UNTRANSLATED'
}

export type IndependenceContext = {
  region?: string | null
  queryLanguage?: string | null
  fallbackUsed?: boolean | null
  fallbackReason?: string | null
}

export function annotateEvidenceIndependence(
  items: IntelligenceEvidenceItem[],
  context: IndependenceContext = {},
): IndependentEvidenceItem[] {
  return items.map(item => {
    const canonical_url = canonicalizeUrl(item.url) ?? item.url ?? null
    const content_hash = hashEvidenceContent(evidenceTextForHash(item))
    const source_family = inferSourceFamily(item)
    const publisher_family = inferPublisherFamily(item)
    const source_authority_class = item.source_authority_class ?? classifySourceAuthority(item)
    const jurisdiction = item.jurisdiction ?? inferJurisdiction({ ...item, region: context.region ?? item.region ?? null })
    const original_language = item.original_language ?? detectLanguageFromText(`${item.title} ${item.content}`)
    const query_language = item.query_language ?? context.queryLanguage ?? null
    const translation_status = item.translation_status ?? translationStatusFor({
      originalLanguage: original_language,
      queryLanguage: query_language,
      translated: false,
    })
    const primary_source = item.primary_source ?? source_authority_class.startsWith('PRIMARY_')
    const annotated: IndependentEvidenceItem = {
      ...item,
      canonical_url: item.canonical_url ?? canonical_url,
      content_hash: item.content_hash ?? content_hash,
      source_family: item.source_family ?? source_family,
      publisher_family: item.publisher_family ?? publisher_family,
      source_authority_class,
      jurisdiction,
      region: item.region ?? context.region ?? null,
      country: HOST_AUTHORITY.find(entry => item.url && entry.host.test(hostnameFromUrl(item.url) ?? ''))?.country ?? null,
      language: original_language,
      original_language,
      query_language,
      translation_status,
      primary_source,
      semantic_cluster_id: item.semantic_cluster_id ?? null,
      derivative_of: item.derivative_of ?? null,
      cluster_head_id: item.cluster_head_id ?? null,
      fallback_used: item.fallback_used ?? context.fallbackUsed ?? null,
      fallback_reason: item.fallback_reason ?? context.fallbackReason ?? null,
      independence_key: item.independence_key ?? null,
    }
    annotated.independence_key = buildIndependenceKey(annotated)
    return annotated
  })
}

function normalizedTitle(title: string | undefined): string {
  return normalizeEvidenceText(title ?? '')
}

export function clusterIndependentEvidence(items: IndependentEvidenceItem[]): {
  items: IndependentEvidenceItem[]
  clusters: EvidenceCluster[]
} {
  const clustered = items.map(item => ({ ...item }))
  const parent = clustered.map((_, index) => index)

  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]!)
    return parent[index]!
  }
  const union = (a: number, b: number) => {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) parent[pb] = pa
  }

  for (let i = 0; i < clustered.length; i += 1) {
    for (let j = i + 1; j < clustered.length; j += 1) {
      const left = clustered[i]!
      const right = clustered[j]!
      const sameCanonical = Boolean(left.canonical_url && left.canonical_url === right.canonical_url)
      const sameHash = Boolean(left.content_hash && left.content_hash === right.content_hash)
      const sameWire = Boolean(left.source_family && left.source_family === right.source_family && WIRE_FAMILIES.some(entry => entry.family === left.source_family))
      const titleMatch = Boolean(normalizedTitle(left.title) && normalizedTitle(left.title) === normalizedTitle(right.title))
      const nearText = textsAreNearDuplicate(
        evidenceTextForHash(left),
        evidenceTextForHash(right),
      )
      const closeTime = Boolean(left.published_at && right.published_at && Math.abs(Date.parse(left.published_at) - Date.parse(right.published_at)) <= 48 * 60 * 60 * 1000)
      if (sameCanonical || sameHash || (sameWire && (titleMatch || nearText)) || (titleMatch && nearText && closeTime)) {
        union(i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  clustered.forEach((_, index) => {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(index)
    groups.set(root, list)
  })

  const clusters: EvidenceCluster[] = []
  for (const members of groups.values()) {
    const headIndex = members[0]!
    const head = clustered[headIndex]!
    const cluster_id = `cluster-${head.content_hash ?? head.canonical_url ?? head.id}`.slice(0, 180)
    for (const index of members) {
      const item = clustered[index]!
      item.cluster_head_id = head.id
      item.semantic_cluster_id = cluster_id
      item.derivative_of = item.id === head.id ? null : head.id
      item.independence_key = buildIndependenceKey({
        jurisdiction: item.jurisdiction,
        source_family: item.source_family,
        cluster_head_id: head.id,
        content_hash: head.content_hash,
        canonical_url: head.canonical_url,
        id: head.id,
      })
    }
    clusters.push({
      cluster_id,
      cluster_head_id: head.id,
      source_family: head.source_family ?? 'UNKNOWN',
      independence_key: head.independence_key ?? buildIndependenceKey(head),
      member_ids: members.map(index => clustered[index]!.id),
      urls: members.map(index => clustered[index]!.url).filter((url): url is string => Boolean(url)),
      region: head.region ?? null,
    })
  }

  return { items: clustered, clusters }
}

export function summarizeIndependence(items: IndependentEvidenceItem[], clusters: EvidenceCluster[]) {
  const canonical = new Set(items.map(item => item.canonical_url).filter(Boolean))
  const keys = new Set(items.map(item => item.independence_key).filter(Boolean))
  const families = new Set(items.map(item => item.source_family).filter(Boolean))
  const regions = new Set(items.map(item => item.region).filter(Boolean))
  return {
    rawCount: items.length,
    canonicalUrlUnique: canonical.size,
    clusterCount: clusters.length,
    independentKeyCount: keys.size,
    sourceFamilyDiversity: families.size,
    regionalDiversity: regions.size,
  }
}

export function independentSupportCount(ids: string[], items: IndependentEvidenceItem[]): number {
  const keys = new Set(
    items
      .filter(item => ids.includes(item.id))
      .map(item => item.independence_key)
      .filter((key): key is string => Boolean(key)),
  )
  return keys.size
}
