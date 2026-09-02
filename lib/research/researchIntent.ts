import type { IntentKind } from '@/lib/council/intentClassifier'
import { isEconomicOpsCommand } from '@/lib/economic/routing'
import { evaluateMandatoryLiveRetrieval } from '@/lib/intelligence/sources/retrievalOrchestrator'

export type ResearchIntentContext = {
  /** Server-side attendance wave / attendance command — never triggers live research. */
  attendanceFlow?: boolean
  /** Sequential diagnostics must not wait on or depend on internet research. */
  sequentialDiagnostic?: boolean
  /** Decree-soft gather prelude — skip live research to preserve budgets. */
  councilGatherPhase?: 'decree_soft' | null
  /** Classified decree intent — used only to suppress casual/internal-only browsing. */
  intentKind?: IntentKind
}

export type ResearchIntentResult = {
  shouldResearch: boolean
  reasons: string[]
  /** 0–1 heuristic: higher when multiple independent trigger families match. */
  confidence: number
}

/** Strong signals that the user wants time-sensitive or external-web grounding. */
const LIVE_CURRENT_TRIGGERS: RegExp[] = [
  /\b(?:latest|breaking|today|right\s*now|as\s+of|this\s+week|this\s+month|current\s+events?)\b/i,
  /\b(?:what\s+happened|news\s+from|headlines?|developing\s+story)\b/i,
  /\b(?:fact[-\s]?check|verify\s+online|confirm\s+on\s+the\s+web)\b/i,
]

/** Natural world-state questions still require current evidence even when the user omits
 * explicit words such as "latest", "today", or "search". */
const WORLD_STATE_TRIGGERS: RegExp[] = [
  /\bwhat(?:'s|s|\s+is)\s+(?:the\s+)?world\s+(?:up\s+to{1,2}|doing|like)\b/i,
  /\bwhat(?:'s|s|\s+is)\s+(?:going\s+on|happening)\s+(?:in|around|with)\s+(?:the\s+)?world\b/i,
  /\bcouncil[,!]?\s+what(?:'s|s|\s+is)\s+going\s+on\s+with\s+(?:the\s+)?world\b/i,
  /\b(?:catch|bring)\s+me\s+up\s+(?:on|to\s+speed)\b/i,
  /\b(?:world|global|national|local)\s+(?:news|update|briefing|outlook)\b/i,
  /\bhow(?:'s|s|\s+is|\s+are)\s+(?:the\s+)?(?:economy|markets?|politics|weather|technology|tech\s+sector|job\s+market|housing\s+market)\b/i,
  /\bwhat\s+(?:are|is)\s+(?:the\s+)?(?:economy|markets?|politics|weather|technology|tech\s+sector|job\s+market|housing\s+market)\s+(?:doing|like)\b/i,
  /\bwhat(?:'s|s|\s+is)\s+(?:happening|going\s+on)\s+(?:today|right\s+now)\b/i,
  /\bwhat(?:'s|s|\s+is)\s+going\s+on\s+with\s+(?:ai|artificial\s+intelligence)\b/i,
  /\bbitcoin\b.{0,40}\b(?:price|trading|at|worth)\b/i,
]

const INTERNET_EXPLICIT: RegExp[] = [
  /\b(?:search\s+the\s+web|web\s+search|live\s+web|use\s+the\s+internet|internet\s+research)\b/i,
  /\binternet\b/i,
  /\b(?:browse|look\s+up\s+online|google\s+it|duckduckgo)\b/i,
]

const SOCIAL_REALTIME_TRIGGERS: RegExp[] = [
  /\b(?:twitter|x\.com|\bx\b\s+post|trending\s+on\s+x|social\s+media\s+sentiment)\b/i,
  /\b(?:reddit|threads|mastodon|bluesky)\b/i,
]

const DOMAIN_TRIGGERS: RegExp[] = [
  /\b(?:racism|anti[-\s]?black|black\s+empowerment|reparations|civil\s+rights\s+movement)\b/i,
  /\b(?:election\s+results?|polling|legislation|bill\s+\d+|supreme\s+court)\b/i,
  /\b(?:stock\s+price|market\s+cap|earnings\s+call)\b/i,
]

/** Internal runtime / council plumbing — excluded unless paired with explicit external check triggers. */
const INTERNAL_ONLY_RUNTIME: RegExp[] = [
  /\b(?:DATABASE_URL|SUPABASE_SERVICE_ROLE|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/i,
  /\bconnection\s+string\b.*\bpostgres\b/i,
  /\.env\.local\b/i,
  /(?:^|[\s/])\.env\b(?![a-z0-9_-])/i,
]

const RUNTIME_STATUS_ALLOWED: RegExp[] = [
  /\b(?:runtime\s+status|engine\s+status|provider\s+outage|status\s+page|uptime|incident)\b/i,
  /\b(?:is\s+\w+\s+down|outage\s+report|degraded\s+service)\b/i,
]

const RESEARCH_VERB_TRIGGERS: RegExp[] = [
  /\b(?:research|investigate|source|cite|citation|references?|literature)\b/i,
  /\b(?:what\s+do\s+experts|peer[-\s]?reviewed)\b/i,
]

/**
 * Real-world planning / relocation / logistics language — a narrow news/current-event vocabulary
 * previously missed requests like "how can we get to Panama" or "how can we relocate somewhere"
 * entirely (zero trigger matches), so they fell through to pure model judgment with no live
 * grounding and no signal that no research was attempted.
 */
const PLANNING_LOGISTICS_TRIGGERS: RegExp[] = [
  /\bhow\s+(?:can|do|would|could)\s+we\s+(?:get\s+to|relocate|move|travel|accomplish|achieve|reach)\b/i,
  /\brelocat(?:e|ion|ing)\b/i,
  /\bimmigrat(?:e|ion|ing)\b/i,
  /\bemigrat(?:e|ion|ing)\b/i,
  /\b(?:move|moving)\s+to\b/i,
  /\bplan(?:ning)?\s+(?:our|my|the|a)\s+(?:move|relocation|trip)\b/i,
  /\btravel\s*(?:plan(?:ning)?|logistics|requirements?)\b/i,
  /\bvisa\s+requirements?\b/i,
  /\b(?:housing|transportation)\s*logistics\b/i,
  /\bcurrent\s+(?:requirements?|costs?|prices?|availability)\b/i,
  /\breal[-\s]?world\s+objective\b/i,
]

/**
 * Code/meta-discussion nouns that indicate a relocation/travel/logistics-shaped word is being
 * used about code, a variable, or the word itself — not a real-world planning request. An
 * independent review confirmed these exact false-positive shapes against the planning triggers
 * above before this exclusion existed: "relocate this function into another file", "update the
 * relocation variable name", "immigration is a word in this document", "test the travel planning
 * regex". Scoped to `PLANNING_LOGISTICS_TRIGGERS` only — it must not suppress unrelated trigger
 * families (news/weather/research-verbs/etc).
 */
const PLANNING_CODE_OR_META_CONTEXT =
  /\b(?:function|file|variable|method|class|module|component|regex|code|script|directory|folder|word|document|constant|property|parameter|argument)\b/i

/** User pasted a public URL — safe direct fetch may apply (still routed + validated server-side). */
const URL_PASTE_TRIGGER = /https?:\/\/[^\s\])>'"]{8,}/i

/** Casual / presence-only — do not auto-browse without stronger signals. */
const CASUAL_ONLY: RegExp[] = [
  /^\s*(?:hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening))\b/i,
  /\bhow\s+(?:are|is)\s+everyone\b/i,
  /\b(?:small\s+talk|off\s+topic|just\s+chatting)\b/i,
]

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0
  for (const p of patterns) {
    if (p.test(text)) n += 1
  }
  return n
}

function firstMatchingReason(text: string, patterns: RegExp[], label: string): string | null {
  for (const p of patterns) {
    if (p.test(text)) return `${label}:${p.source.slice(0, 48)}`
  }
  return null
}

/**
 * Detect when a decree or question should invoke **live** internet research.
 * Conservative: attendance, diagnostics, decree-soft gather, and casual-only decrees stay off.
 */
export function detectResearchIntent(text: string, ctx?: ResearchIntentContext): ResearchIntentResult {
  const raw = typeof text === 'string' ? text : ''
  const t = raw.trim()
  if (!t) {
    return { shouldResearch: false, reasons: ['empty_text'], confidence: 0 }
  }

  const reasons: string[] = []

  if (isEconomicOpsCommand(t) || ctx?.intentKind === 'economic_ops') {
    return { shouldResearch: false, reasons: ['excluded_economic_ops'], confidence: 0 }
  }

  const mandatoryRetrieval = evaluateMandatoryLiveRetrieval(t)

  if (ctx?.attendanceFlow) {
    if (!mandatoryRetrieval.required) {
      return { shouldResearch: false, reasons: ['excluded_attendance_flow'], confidence: 0 }
    }
    reasons.push(...mandatoryRetrieval.reasons.map(reason => `mandatory_retrieval:${reason}`))
  }
  if (ctx?.sequentialDiagnostic) {
    return { shouldResearch: false, reasons: ['excluded_sequential_diagnostic'], confidence: 0 }
  }
  if (ctx?.councilGatherPhase === 'decree_soft') {
    if (!mandatoryRetrieval.required) {
      return { shouldResearch: false, reasons: ['excluded_decree_soft_gather'], confidence: 0 }
    }
    reasons.push('decree_soft_overridden_by_mandatory_retrieval')
  }

  const internalHit = INTERNAL_ONLY_RUNTIME.some(p => p.test(t))
  const runtimeStatusHit = RUNTIME_STATUS_ALLOWED.some(p => p.test(t))
  if (internalHit && !runtimeStatusHit && !INTERNET_EXPLICIT.some(p => p.test(t))) {
    return { shouldResearch: false, reasons: ['excluded_internal_runtime_only'], confidence: 0 }
  }

  const intent = ctx?.intentKind
  const casualIntent = intent === 'greeting' || intent === 'natural'
  const casualShape = CASUAL_ONLY.some(p => p.test(t)) && t.length < 220
  const explicitInternet = INTERNET_EXPLICIT.some(p => p.test(t))
  const liveHits = countMatches(t, LIVE_CURRENT_TRIGGERS)
  const worldStateHits = countMatches(t, WORLD_STATE_TRIGGERS)
  const socialHits = countMatches(t, SOCIAL_REALTIME_TRIGGERS)
  const domainHits = countMatches(t, DOMAIN_TRIGGERS)
  const researchVerbHits = countMatches(t, RESEARCH_VERB_TRIGGERS)
  const planningHits = PLANNING_CODE_OR_META_CONTEXT.test(t) ? 0 : countMatches(t, PLANNING_LOGISTICS_TRIGGERS)

  const pushReason = (label: string, patterns: RegExp[]) => {
    const r = firstMatchingReason(t, patterns, label)
    if (r) reasons.push(r)
  }

  if (explicitInternet) pushReason('internet_explicit', INTERNET_EXPLICIT)
  if (liveHits) pushReason('live_current', LIVE_CURRENT_TRIGGERS)
  if (worldStateHits) pushReason('world_state', WORLD_STATE_TRIGGERS)
  if (socialHits) pushReason('social_realtime', SOCIAL_REALTIME_TRIGGERS)
  if (domainHits) pushReason('domain_topic', DOMAIN_TRIGGERS)
  if (researchVerbHits) pushReason('research_verbs', RESEARCH_VERB_TRIGGERS)
  if (planningHits) pushReason('planning_logistics', PLANNING_LOGISTICS_TRIGGERS)
  if (URL_PASTE_TRIGGER.test(t)) reasons.push('url_paste:https')
  if (mandatoryRetrieval.required) {
    reasons.push(...mandatoryRetrieval.reasons.map(reason => `mandatory_retrieval:${reason}`))
  }

  if (intent === 'research' && (researchVerbHits || explicitInternet)) {
    reasons.push('intent_classifier:research')
  }

  if (casualIntent && casualShape && reasons.length === 0) {
    return { shouldResearch: false, reasons: ['excluded_casual_no_triggers'], confidence: 0 }
  }

  if (reasons.length === 0) {
    return { shouldResearch: false, reasons: ['no_triggers'], confidence: 0 }
  }

  const breadth = new Set(reasons.map(r => r.split(':')[0] ?? r)).size
  const confidence = Math.min(1, Math.max(mandatoryRetrieval.confidence, 0.35 + breadth * 0.18 + Math.min(3, reasons.length) * 0.12))

  return { shouldResearch: true, reasons, confidence }
}
