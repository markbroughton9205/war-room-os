import type { StableGroupFamily } from '@/lib/council/councilMode'
import type { StableGroupPriorReply } from '@/lib/council/stableGroupChat'

export type CouncilConfidenceInput = {
  responseText: string
  decreeText: string
  priorReplies: StableGroupPriorReply[]
  family: StableGroupFamily
  hasLiveSignals?: boolean
}

const LOCAL_RELEVANCE_RE =
  /\b(?:akron|ohio|broughton|transports?|freight|logistics|shipper|carrier|regional|local)\b/i
const EXECUTION_RE =
  /\b(?:next step|sequence|ship|build|implement|rollback|verify|deploy|this week|today|tomorrow)\b/i
const SPECIFICITY_RE =
  /\b(?:\d{1,3}%?|\$\d|within \d|by (?:mon|tue|wed|thu|fri|monday|tuesday)|phase \d)\b/i
const FRESH_SIGNAL_RE = /\b(?:today|this week|current|live|fresh|now|latest|recent)\b/i
const STALE_SIGNAL_RE = /\b(?:always|evergreen|timeless|in general|historically)\b/i

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3),
  )
}

/** Provider agreement: acknowledges or extends prior family content without pure repetition. */
function scoreAgreement(response: string, prior: StableGroupPriorReply[]): number {
  if (!prior.length) return 0.55
  const resp = tokenSet(response)
  if (!resp.size) return 0.4
  let best = 0.35
  for (const p of prior) {
    const priorTokens = tokenSet(p.content)
    if (!priorTokens.size) continue
    let overlap = 0
    for (const t of priorTokens) {
      if (resp.has(t)) overlap++
    }
    const ratio = overlap / priorTokens.size
    const acknowledges =
      /\b(?:building on|prior|earlier|agree|extends?|following|noted)\b/i.test(response) ||
      ratio >= 0.12
    const repetitive = ratio >= 0.45
    const score = acknowledges && !repetitive ? 0.82 : repetitive ? 0.38 : 0.58
    best = Math.max(best, score)
  }
  return best
}

function scoreSpecificity(text: string): number {
  const len = text.trim().length
  if (len < 40) return 0.42
  let s = 0.5
  if (SPECIFICITY_RE.test(text)) s += 0.22
  if (/\b(?:because|therefore|if .{8,40} then)\b/i.test(text)) s += 0.08
  if (len > 120 && len < 900) s += 0.06
  return clamp01(s)
}

function scoreLocalRelevance(text: string, decree: string): number {
  const combined = `${text} ${decree}`
  if (LOCAL_RELEVANCE_RE.test(combined)) return 0.78
  if (/\b(?:operator|business|revenue|customer)\b/i.test(combined)) return 0.62
  return 0.48
}

function scoreExecutionClarity(text: string): number {
  if (EXECUTION_RE.test(text)) return 0.8
  if (/\b(?:should|could|consider|maybe)\b/i.test(text) && !EXECUTION_RE.test(text)) return 0.52
  return 0.46
}

function scoreSignalFreshness(text: string, hasLiveSignals?: boolean): number {
  if (hasLiveSignals) return 0.86
  if (FRESH_SIGNAL_RE.test(text)) return 0.74
  if (STALE_SIGNAL_RE.test(text)) return 0.44
  return 0.56
}

/**
 * Lightweight council confidence (0–1). Replaces static 0.42 placeholders.
 * Weighted: agreement 25%, specificity 20%, local 15%, execution 25%, freshness 15%.
 */
export function computeCouncilFamilyConfidence(input: CouncilConfidenceInput): number {
  const text = input.responseText.trim()
  if (!text) return 0.35

  const agreement = scoreAgreement(text, input.priorReplies)
  const specificity = scoreSpecificity(text)
  const local = scoreLocalRelevance(text, input.decreeText)
  const execution = scoreExecutionClarity(text)
  const freshness = scoreSignalFreshness(text, input.hasLiveSignals)

  const weighted =
    agreement * 0.25 +
    specificity * 0.2 +
    local * 0.15 +
    execution * 0.25 +
    freshness * 0.15

  return Number(clamp01(weighted).toFixed(2))
}

/** UI-friendly 0–100 integer (FamilySeat / mockCouncilData convention). */
export function councilConfidenceToPercent(score: number): number {
  return Math.round(clamp01(score) * 100)
}
