import { createHash } from 'node:crypto'
import type { DiscoveryOpportunity, DiscoveryProvider, MatchSignal } from './types'

export function sanitizeOfficialUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/api[_-]?key|token|secret|auth|key|password|credential|session|cookie/i.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch { return null }
}

export function stableId(provider: DiscoveryProvider, providerId: unknown, fallback: string): string {
  const source = String(providerId ?? '').trim() || createHash('sha256').update(fallback.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 24)
  return `${provider}:${source}`
}

function has(text: string, patterns: RegExp[]): boolean { return patterns.some(pattern => pattern.test(text)) }

export function qualifyOpportunity(record: DiscoveryOpportunity): DiscoveryOpportunity {
  const title = record.title.toLowerCase()
  const description = (record.description ?? '').toLowerCase()
  const all = `${title} ${description}`
  const reasons: string[] = []
  const signals = new Set<MatchSignal>()
  const add = (signal: MatchSignal, reason: string) => { signals.add(signal); reasons.push(reason) }

  if (has(title, [/\bsoftware (developer|engineer|architect)\b/, /\b(full[- ]?stack|backend|frontend|devops|cloud) (developer|engineer)\b/])) add('SOFTWARE', 'TITLE_SOFTWARE_ENGINEER')
  else if (has(all, [/\bsoftware development\b/, /\bapplication development\b/, /\btypescript\b/, /\bpython developer\b/])) add('SOFTWARE', 'DESCRIPTION_SOFTWARE_DEVELOPMENT')
  if (has(title, [/\b(ai|artificial intelligence|automation) (engineer|developer|architect|specialist)\b/])) add('AI_AUTOMATION', 'TITLE_AI_AUTOMATION')
  else if (has(description, [/\bartificial intelligence\b/, /\bai automation\b/, /\bworkflow automation\b/, /\bllm(s)?\b/])) add('AI_AUTOMATION', 'DESCRIPTION_AI_AUTOMATION')
  if (has(all, [/\bmachine learning\b/, /\bml engineer\b/, /\bdeep learning\b/])) add('MACHINE_LEARNING', title.includes('machine learning') ? 'TITLE_MACHINE_LEARNING' : 'DESCRIPTION_MACHINE_LEARNING')
  if (has(title, [/\bdata (engineer|analyst|scientist|architect)\b/, /\banalytics engineer\b/])) add('DATA', 'TITLE_DATA_ROLE')
  else if (has(description, [/\bdata engineering\b/, /\bdata analysis\b/, /\bdata pipeline(s)?\b/])) add('DATA', 'DESCRIPTION_DATA')
  if ((record.remoteStatus === 'REMOTE' || record.remoteStatus === 'REMOTE_ELIGIBLE') && signals.size > 0) add('REMOTE_TECHNICAL', 'REMOTE_CONFIRMED')
  if (record.opportunityType === 'GOVERNMENT_SOLICITATION' && signals.size > 0) add('GOVERNMENT_IT_CONTRACT', 'OFFICIAL_GOVERNMENT_IT_SOLICITATION')

  const negative = has(title, [/\b(sales|account executive|recruiter|customer support|marketing|nurse|driver)\b/]) && signals.size === 0
  return { ...record, matchReasons: negative ? [] : [...new Set(reasons)], matchSignals: negative ? [] : [...signals], confidence: negative ? 0 : Math.min(1, signals.size * 0.2 + (reasons.some(r => r.startsWith('TITLE_')) ? 0.35 : 0.15)) }
}

export function meaningfulStateFingerprint(record: DiscoveryOpportunity): string {
  return createHash('sha256').update(JSON.stringify([record.id, record.title, record.deadline, record.compensation, record.remoteStatus, record.officialUrl])).digest('hex')
}

export function isQualifying(record: DiscoveryOpportunity): boolean {
  if (record.opportunityType === 'HISTORICAL_AWARD_INTELLIGENCE') return false
  const coreSignals = record.matchSignals.filter(signal => signal !== 'REMOTE_TECHNICAL' && signal !== 'GOVERNMENT_IT_CONTRACT')
  // Provider descriptions often contain unrelated boilerplate and recommendations.
  // Require a technical title signal, or corroboration from two distinct technical categories.
  const titleEvidence = record.matchReasons.some(reason => reason.startsWith('TITLE_'))
  return coreSignals.length > 0 && (titleEvidence || coreSignals.length >= 2)
}
