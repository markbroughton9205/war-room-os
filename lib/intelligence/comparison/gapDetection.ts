import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

export type LiveRetrievalPlan = {
  shouldRunLiveResearch: boolean
  reasons: string[]
  skipReasons: string[]
  catalogOnly: boolean
}

const CURRENT_STATE = /\b(?:latest|current|today|this week|this month|what has changed|changed from|now)\b/i
const SOURCE_CATALOG = /\b(?:machine-accessible sources|already know about|actually implemented|source catalog|which of them are actually implemented)\b/i

export function planLiveRetrieval(args: {
  decree: string
  prior: IntelligenceEvidenceItem[]
  researchIntentSaysGo: boolean
}): LiveRetrievalPlan {
  const reasons: string[] = []
  const skipReasons: string[] = []
  const catalogOnly = SOURCE_CATALOG.test(args.decree)

  if (catalogOnly) {
    skipReasons.push('catalog_implementation_state_query')
    return { shouldRunLiveResearch: false, reasons, skipReasons, catalogOnly: true }
  }

  if (!args.researchIntentSaysGo) {
    skipReasons.push('research_intent_negative')
    return { shouldRunLiveResearch: false, reasons, skipReasons, catalogOnly: false }
  }

  if (CURRENT_STATE.test(args.decree)) reasons.push('current_state_explicitly_requested')
  if (!args.prior.length) reasons.push('no_prior_intelligence')
  if (args.prior.some(item => item.freshness === 'stale' || item.freshness === 'unknown' || item.origin_type === 'KIMI_WAVE')) {
    reasons.push('prior_evidence_stale_or_unvalidated')
  }
  if (args.prior.some(item => item.contradiction_flags.length > 0)) reasons.push('prior_contradiction_flags')
  if (args.prior.some(item => item.confidence_tier === 'unsupported' || item.verified_level === 'unverified')) {
    reasons.push('key_claim_lacks_current_verification')
  }

  if (!reasons.length) reasons.push('research_intent_requires_live_evidence')

  return {
    shouldRunLiveResearch: true,
    reasons,
    skipReasons,
    catalogOnly: false,
  }
}
