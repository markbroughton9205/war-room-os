/**
 * Hard Deep Research acceptance gates.
 * Classification, PULSAR selection, or "Web Research initiated" is never enough.
 */
import { toNormalChatText } from './normalChatContract'
import type { EbcEvidence, LumenVerification } from '@/lib/council/evidence-board/types'

export const MOE_RESEARCH_PROMPT = 'Research current mixture-of-experts inference methods using primary sources.'
export const CURRENT_INFO_PROMPT = 'Research one current AI development from the last 30 days using primary or authoritative sources.'
export const WEB_RESEARCH_MIN_USABLE = 2
export const WEB_RESEARCH_MIN_UNIQUE = 2
export const WEB_RESEARCH_MIN_PRIMARY = 2
export const CURRENT_INFO_WINDOW_DAYS = 30

const FAILED_FETCH = /opened no usable sources|fetch failed|timed out|could not (?:open|retrieve|fetch)|status\s*[45]\d\d/i
const SEO_HOST = /(^|\.)(medium\.com|towardsdatascience\.com|reddit\.com|quora\.com|substack\.com|seo|pinterest\.com)$/i
const PRIMARY_HOST = /(^|\.)(arxiv\.org|openai\.com|anthropic\.com|deepmind\.google|research\.google|ai\.google(?:\.dev)?|ai\.meta\.com|developer\.nvidia\.com|nvidia\.com|pytorch\.org|jax\.readthedocs\.io|neurips\.cc|papers\.nips\.cc|proceedings\.mlr\.press|openreview\.net|dl\.acm\.org|ieeexplore\.ieee\.org|nature\.com|science\.org|acm\.org)$/i

export type UsableSourceRecord = {
  url: string
  title: string
  sourceIdentity: string
  extractedContent: string
  observedAt: string
  sourceType: string
  primary: boolean
  ok: boolean
}

export type WebResearchScore = {
  usable_source_count: number
  unique_source_count: number
  primary_source_count: number
  failed_fetch_counted: boolean
  extraction_ok: boolean
  ebc_usable: number
  lumen_verified: boolean
  lumen_supported: boolean
  lumen_unverified: boolean
  lumen_verified_without_sources: boolean
  aurora_visible: boolean
  sources_visible: boolean
  public_clean: boolean
  idle_after: boolean
  fake_success: boolean
  pass: boolean
  reasons: string[]
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isPrimaryAuthoritativeUrl(url: string): boolean {
  const host = hostOf(url)
  if (!host || SEO_HOST.test(host)) return false
  return PRIMARY_HOST.test(host) || /arxiv\.org\/(abs|pdf|html)\//i.test(url)
}

export function isFailedFetchRow(row: Pick<EbcEvidence, 'ok' | 'summary' | 'url' | 'title'>): boolean {
  if (row.ok === false) return true
  if (!row.url) return true
  if (FAILED_FETCH.test(row.summary || '') || FAILED_FETCH.test(row.title || '')) return true
  return false
}

export function usableSourceFromEvidence(row: EbcEvidence): UsableSourceRecord | null {
  if (isFailedFetchRow(row)) return null
  const url = String(row.final_url || row.url || '').trim()
  const title = String(row.title || '').trim()
  const content = String(row.summary || '').trim()
  const observedAt = String(row.observed_at || row.retrieved_at || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) return null
  if (content.length < 24) return null
  if (FAILED_FETCH.test(content)) return null
  const identity = hostOf(url) || String(row.source || row.tool_name || '')
  if (!identity) return null
  return {
    url,
    title: title || identity,
    sourceIdentity: identity,
    extractedContent: content,
    observedAt,
    sourceType: String(row.source_type || row.kind || 'unknown'),
    primary: isPrimaryAuthoritativeUrl(url) || row.kind === 'primary_external' || row.source_type === 'primary_external',
    ok: true,
  }
}

export function collectUsableSources(rows: readonly EbcEvidence[]): UsableSourceRecord[] {
  const collected: UsableSourceRecord[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const source = usableSourceFromEvidence(row)
    if (!source) continue
    let key = source.url
    try {
      const parsed = new URL(source.url)
      key = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`
    } catch {
      key = source.url
    }
    if (seen.has(key)) continue
    seen.add(key)
    collected.push(source)
  }
  return collected
}

export function failedFetchCountedAsUsable(rows: readonly EbcEvidence[]): boolean {
  return rows.some(row => isFailedFetchRow(row) && Boolean(usableSourceFromEvidence({ ...row, ok: true, summary: row.summary.replace(FAILED_FETCH, 'placeholder content for counting') })))
}

export function publicSourcesVisible(text: string): boolean {
  const body = toNormalChatText(text)
  return /https?:\/\//i.test(body) && /sources?:/i.test(body)
}

export function publicResearchIsClean(text: string): boolean {
  return !/TOOL_BLOCKED|CURRENT_LIVE|broker\.fetch|claim_[a-z0-9_-]+|e-[A-Z]+-r\d+/i.test(toNormalChatText(text))
}

export function sourceIsWithinDays(iso: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!iso) return false
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return false
  return now - ts <= days * 86_400_000 && ts <= now + 86_400_000
}

export function lumenPublicState(rows: readonly LumenVerification[]): {
  verified: boolean
  supported: boolean
  unverified: boolean
} {
  const verdicts = rows.map(row => row.verdict)
  return {
    verified: verdicts.some(v => v === 'SUPPORTED'),
    supported: verdicts.some(v => v === 'SUPPORTED'),
    unverified: verdicts.length === 0 || verdicts.some(v => v === 'UNKNOWN' || v === 'UNSUPPORTED' || v === 'CONTRADICTED'),
  }
}

export function scoreWebResearch(input: {
  evidence: readonly EbcEvidence[]
  lumen?: readonly LumenVerification[]
  auroraText: string
  requirePrimary?: boolean
  minPrimary?: number
  idleAfter?: boolean
  elapsedMs?: number
}): WebResearchScore {
  const usable = collectUsableSources(input.evidence)
  const unique = usable.length
  const primary = usable.filter(row => row.primary).length
  const failedAsUsable = usable.some(source =>
    input.evidence.some(row => row.ok === false && (row.final_url || row.url) === source.url),
  )
  const lumen = lumenPublicState(input.lumen ?? [])
  const reasons: string[] = []
  if (usable.length < WEB_RESEARCH_MIN_USABLE) reasons.push(`usable_source_count ${usable.length} < ${WEB_RESEARCH_MIN_USABLE}`)
  if (unique < WEB_RESEARCH_MIN_UNIQUE) reasons.push(`unique_source_count ${unique} < ${WEB_RESEARCH_MIN_UNIQUE}`)
  const minPrimary = input.minPrimary ?? (input.requirePrimary ? WEB_RESEARCH_MIN_PRIMARY : 0)
  if (minPrimary && primary < minPrimary) reasons.push(`primary_source_count ${primary} < ${minPrimary}`)
  if (failedAsUsable) reasons.push('failed fetch counted as usable')
  if (!usable.every(row => row.extractedContent.length >= 24 && row.observedAt && row.title)) reasons.push('source extraction incomplete')
  if (usable.length >= WEB_RESEARCH_MIN_USABLE && !lumen.verified && !lumen.supported) reasons.push('LUMEN did not inspect retrieved sources')
  if (usable.length === 0 && lumen.verified) reasons.push('VERIFIED without sources')
  if (!toNormalChatText(input.auroraText).trim()) reasons.push('Aurora final missing')
  if (usable.length >= WEB_RESEARCH_MIN_USABLE && !publicSourcesVisible(input.auroraText)) reasons.push('sources not visible in Home answer')
  if (!publicResearchIsClean(input.auroraText)) reasons.push('raw EBC leak in Home answer')
  if (input.idleAfter === false) reasons.push('round did not return Idle')
  const fake = /research succeeded|verified/i.test(input.auroraText) && usable.length === 0
  if (fake) reasons.push('fake success')
  return {
    usable_source_count: usable.length,
    unique_source_count: unique,
    primary_source_count: primary,
    failed_fetch_counted: failedAsUsable,
    extraction_ok: usable.every(row => row.extractedContent.length >= 24 && row.title && row.observedAt),
    ebc_usable: usable.length,
    lumen_verified: lumen.verified,
    lumen_supported: lumen.supported,
    lumen_unverified: lumen.unverified,
    lumen_verified_without_sources: usable.length === 0 && lumen.verified,
    aurora_visible: Boolean(toNormalChatText(input.auroraText).trim()),
    sources_visible: publicSourcesVisible(input.auroraText),
    public_clean: publicResearchIsClean(input.auroraText),
    idle_after: input.idleAfter !== false,
    fake_success: fake,
    pass: reasons.length === 0,
    reasons,
  }
}

export function honestResearchFailure(text: string): boolean {
  const body = toNormalChatText(text)
  if (!body) return false
  if (/https?:\/\/(?!example\.invalid)/i.test(body) && /Sources:/i.test(body)) return false
  if (/\bVERIFIED\b/.test(body) && /source/i.test(body)) return false
  return /could not|couldn't|did not return|no usable|unable to retrieve/i.test(body) && publicResearchIsClean(body)
}

export function crossSourceSynthesized(text: string, sources: readonly UsableSourceRecord[]): boolean {
  if (sources.length < 2) return false
  const body = toNormalChatText(text)
  const mentions = sources.filter(source => {
    const host = source.sourceIdentity.replace(/^www\./, '')
    return body.toLowerCase().includes(host) || body.includes(source.title.slice(0, 18)) || body.includes(source.url)
  }).length
  const hasSynthesis = /what i found|verified|uncertain|together|both papers|both sources|expert/i.test(body)
  return mentions >= 2 && hasSynthesis
}
