import type { IntelligenceCategory } from './types'

const CATEGORY_RULES: Array<{ category: IntelligenceCategory; patterns: RegExp[]; weight: number }> = [
  {
    category: 'emergency',
    patterns: [/\bemergency|evacuat|disaster|wildfire|flood|earthquake|shooting|casualt|urgent alert\b/i],
    weight: 95,
  },
  {
    category: 'geopolitics',
    patterns: [/\bgeopolitic|sanction|nato|ukraine|russia|china|taiwan|war\b|conflict|diplomat|embassy|military\b/i],
    weight: 80,
  },
  {
    category: 'markets',
    patterns: [/\bmarket|stocks?|bonds?|fed\b|interest rate|inflation|earnings|nasdaq|s&p|dow\b|treasury|commodit/i],
    weight: 78,
  },
  {
    category: 'local_economy',
    patterns: [/\bakron|summit county|northeast ohio|cleveland|columbus|ohio\b|local economy|workforce|regional\b/i],
    weight: 76,
  },
  {
    category: 'business_opportunity',
    patterns: [/\bopportunit|contract|rfp|grant|hiring|startup|smb|buyer|lead|automation|saas\b/i],
    weight: 74,
  },
  {
    category: 'operational_risk',
    patterns: [/\brisk|warning|layoff|closure|shortage|slowdown|fraud|breach|outage|degraded|supply chain\b/i],
    weight: 82,
  },
  {
    category: 'infrastructure',
    patterns: [/\binfrastructure|power grid|utility|bridge|road|port|rail|pipeline|broadband|datacenter\b/i],
    weight: 72,
  },
  {
    category: 'AI_industry',
    patterns: [/\bAI\b|artificial intelligence|openai|anthropic|model|agent|llm|chip|nvidia|automation platform\b/i],
    weight: 75,
  },
]

const LEGACY_CATEGORY_HINTS: Partial<Record<string, IntelligenceCategory>> = {
  economic_warning: 'operational_risk',
  Ohio_business: 'local_economy',
  local_Akron: 'local_economy',
  AI_trends: 'AI_industry',
  app_factory_opportunity: 'business_opportunity',
  SMB_automation: 'business_opportunity',
  freight: 'infrastructure',
  job: 'business_opportunity',
  gig: 'business_opportunity',
}

export function classifyIntelligenceCategory(text: string, legacyCategory?: string): {
  category: IntelligenceCategory
  confidence: number
} {
  let best: IntelligenceCategory = 'business_opportunity'
  let bestScore = 0

  for (const rule of CATEGORY_RULES) {
    const hits = rule.patterns.filter(pattern => pattern.test(text)).length
    if (!hits) continue
    const score = rule.weight + hits * 6
    if (score > bestScore) {
      bestScore = score
      best = rule.category
    }
  }

  if (bestScore < 70 && legacyCategory && LEGACY_CATEGORY_HINTS[legacyCategory]) {
    return {
      category: LEGACY_CATEGORY_HINTS[legacyCategory]!,
      confidence: 52,
    }
  }

  return {
    category: best,
    confidence: Math.max(35, Math.min(92, bestScore || 42)),
  }
}
