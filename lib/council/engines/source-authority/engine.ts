import {
  classifyResearchIntent,
  classifySourceAuthority,
  evaluateSourceRelevance,
  extractFreshnessWindowDays,
  identityKey,
  satisfiesStrictWindow,
} from '@/lib/browser-broker/researchPolicy'
import { extractionLooksUsable, hostOf, unwrapSearchResultUrl } from '@/lib/browser-broker/researchDiscovery'
import { createEngineReceipt } from '../receipts'
import { assessmentCacheKey, readAssessmentCache, writeAssessmentCache } from './cache'
import type {
  ExtractabilityState,
  IndependenceState,
  SourceAssessment,
  SourceAuthorityInput,
  SourceAuthorityResult,
  SourceDecision,
} from './types'

function unsafeUrl(url: string): boolean {
  const unwrapped = unwrapSearchResultUrl(url) || url
  try {
    const parsed = new URL(unwrapped)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    if (!parsed.hostname) return true
    return false
  } catch {
    return true
  }
}

function independenceState(input: SourceAuthorityInput): IndependenceState {
  const identity = identityKey(input.url)
  if (input.duplicate) return 'DUPLICATE'
  if (input.accepted_identities?.includes(identity)) return 'DUPLICATE'
  if (/arxiv\.org\/(abs|pdf|html)\//i.test(input.url) || /doi\.org\//i.test(input.url)) return 'INDEPENDENT'
  return identity ? 'INDEPENDENT' : 'UNKNOWN'
}

function extractabilityState(input: SourceAuthorityInput): ExtractabilityState {
  if (unsafeUrl(input.url)) return 'UNSAFE'
  if (input.extraction_ok === false) return 'FAILED'
  if (input.text != null || input.title != null) {
    if (!extractionLooksUsable({ url: input.url, title: input.title, text: input.text || input.title || '' }) && (input.text || '').length < 80) {
      return input.extraction_ok === true ? 'USABLE' : 'INSUFFICIENT'
    }
    return 'USABLE'
  }
  return 'INSUFFICIENT'
}

function promptFingerprint(prompt: string): string {
  const intent = classifyResearchIntent(prompt)
  return `${intent.research_domain}:${intent.freshness_window_days ?? 'none'}:${intent.requested_source_authority}`
}

export function assessSourceAuthority(input: SourceAuthorityInput): SourceAssessment {
  const identity = identityKey(input.url) || input.url
  if (unsafeUrl(input.url) || !hostOf(input.url)) {
    return {
      candidate_id: identity,
      url: input.url,
      relevance_score: 0,
      authority_score: 0,
      primaryness_score: 0,
      freshness_state: 'DATE_UNKNOWN',
      independence_state: 'UNKNOWN',
      extractability_state: 'UNSAFE',
      source_class: 'UNKNOWN',
      decision: 'REJECT_UNSAFE_OR_INVALID',
      reasons: ['url is not a safe http(s) source'],
    }
  }

  const windowDays = extractFreshnessWindowDays(input.prompt)
  const cacheKey = assessmentCacheKey({
    identity,
    content_hash: input.content_hash,
    freshness_window_days: windowDays,
    prompt_fingerprint: `${promptFingerprint(input.prompt)}:dup=${input.duplicate === true || Boolean(input.accepted_identities?.includes(identity))}:x=${input.extraction_ok !== false}`,
  })
  const cached = readAssessmentCache(cacheKey)
  if (cached && cached.decision !== 'DATE_UNKNOWN' && cached.decision !== 'REJECT_DUPLICATE') return cached

  const duplicate = input.duplicate === true || (input.accepted_identities?.includes(identity) ?? false)
  const relevance = evaluateSourceRelevance({
    prompt: input.prompt,
    url: input.url,
    title: input.title,
    text: input.text,
    published_at: input.published_at,
    updated_at: input.updated_at,
    retrieved_at: input.retrieved_at,
    duplicate,
    extraction_ok: input.extraction_ok,
    now: input.now,
  })

  const independence = independenceState({ ...input, duplicate })
  const extractability = extractabilityState(input)
  let decision: SourceDecision = relevance.relevance_decision
  const reasons = [relevance.relevance_reason]
  if (duplicate || independence === 'DUPLICATE') {
    decision = 'REJECT_DUPLICATE'
    reasons.unshift('same underlying source identity already counted')
  }
  if (windowDays != null && relevance.freshness.freshness_decision === 'DATE_UNKNOWN') {
    decision = 'DATE_UNKNOWN'
    reasons.unshift('DATE_UNKNOWN cannot satisfy a strict freshness window; retrieved_at is not publication freshness')
  }
  if (windowDays != null && !satisfiesStrictWindow(relevance.freshness.freshness_decision) && decision === 'ACCEPT') {
    decision = 'REJECT_STALE'
  }

  const assessment: SourceAssessment = {
    candidate_id: identity,
    url: input.url,
    relevance_score: relevance.scores.relevance,
    authority_score: relevance.scores.authority,
    primaryness_score: relevance.scores.primaryness,
    freshness_state: relevance.freshness.freshness_decision,
    independence_state: independence,
    extractability_state: extractability,
    source_class: relevance.authority_class || classifySourceAuthority(input.url),
    decision,
    reasons,
  }
  if (decision !== 'DATE_UNKNOWN' && decision !== 'REJECT_DUPLICATE') writeAssessmentCache(cacheKey, assessment)
  return assessment
}

export function runSourceAuthorityEngine(input: SourceAuthorityInput): SourceAuthorityResult {
  const started = Date.now()
  const assessment = assessSourceAuthority(input)
  return {
    assessment,
    receipt: createEngineReceipt({
      engine: 'source-authority',
      mission_id: input.mission_id,
      input_refs: [input.url],
      output_refs: [assessment.candidate_id, assessment.decision],
      started_at: started,
      decision_count: 1,
      failure_state: assessment.decision === 'ACCEPT' ? 'none' : 'none',
    }),
  }
}

export function sourcesAreIndependent(urlA: string, urlB: string): boolean {
  const a = identityKey(urlA)
  const b = identityKey(urlB)
  return Boolean(a && b && a !== b)
}
