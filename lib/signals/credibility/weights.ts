import type { SignalProviderId } from '../model'
import type { CredibilityInput } from '../classification/types'

const PROVIDER_BASE: Record<SignalProviderId, number> = {
  guardian: 82,
  newsapi: 76,
  rss: 48,
  tavily: 44,
  firecrawl: 46,
  manual_registry: 55,
  source_url: 40,
}

const TRUSTED_DOMAINS: Array<[RegExp, number]> = [
  [/\b(theguardian|nytimes|reuters|apnews|bbc)\./i, 12],
  [/\b(ohio|akron|summitoh|transportation\.ohio)\./i, 8],
  [/\b(openai|anthropic)\./i, 6],
]

const LOW_TRUST_HINTS = /\b(rumor|unconfirmed|alleged|speculation|clickbait|viral)\b/i

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function scoreSourceCredibility(input: CredibilityInput): {
  score: number
  operatorSourceVerified: boolean
  rationale: string[]
} {
  const rationale: string[] = []
  let score = PROVIDER_BASE[input.provider] ?? 40

  if (typeof input.reliabilityScore === 'number' && Number.isFinite(input.reliabilityScore)) {
    const registryBoost = Math.round((input.reliabilityScore - 50) * 0.2)
    score += registryBoost
    rationale.push(`registry_reliability=${input.reliabilityScore}`)
  }

  const domain = domainFromUrl(input.url)
  if (domain) {
    for (const [pattern, boost] of TRUSTED_DOMAINS) {
      if (pattern.test(domain)) {
        score += boost
        rationale.push(`domain_trust=${domain}`)
        break
      }
    }
  }

  if (input.provider === 'rss') {
    score = Math.min(score, 58)
    rationale.push('rss_feed_unverified_for_operator_truth')
  }

  if (input.provider === 'tavily' || input.provider === 'firecrawl' || input.provider === 'source_url') {
    score = Math.min(score, 55)
    rationale.push('search_or_extract_source_requires_review')
  }

  const text = `${input.sourceLabel} ${input.url}`
  if (LOW_TRUST_HINTS.test(text)) {
    score -= 18
    rationale.push('low_trust_language_detected')
  }

  const operatorSourceVerified = input.provider === 'guardian' || input.provider === 'newsapi'
  if (!operatorSourceVerified) rationale.push('operator_truth_not_auto_verified')

  return {
    score: clamp(score),
    operatorSourceVerified,
    rationale,
  }
}

export function credibilityFactor(score: number): number {
  return clamp(score) / 100
}
