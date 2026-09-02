/**
 * Decree-only intent classification (keyword / phrase heuristics, case-insensitive).
 * Latest Ra’el decree is authoritative — not chat history.
 * Multi-family **greeting** widening is handled in `conversationIntent` + `greetingRouting`, not here.
 */
import { resolveEconomicOpsRouting } from '@/lib/economic/routing'
import { isSocialCouncilCheckin } from '@/lib/council/live-orchestration/socialCheckin'

export type IntentKind =
  | 'greeting'
  | 'attendance'
  | 'natural'
  | 'research'
  | 'architecture'
  | 'council_analysis'
  | 'execution'
  | 'debugging'
  | 'brainstorming'
  | 'silent'
  | 'economic_ops'
  /** Explicit Panama / sovereignty / revenue / ops framing in the decree — widens business topics. */
  | 'business_ops'

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\u2019/g, "'")
}

const GREETING_LINE = /^\s*(hi+|hello|hey+|yo+|sup|what'?s up|good\s+(morning|afternoon|evening)|howdy)\b[!?.\s]*$/i
const GREETING_PREFIX = /^\s*(hi+|hello|hey+|yo+)\b[,!\s]/i

export function classifyIntentFromDecree(text: string): IntentKind {
  const raw = typeof text === 'string' ? text : ''
  const t = norm(raw)
  if (!t) return 'natural'

  if (/\bsilent\b|\bhold\s*responses\b|\bno\s*responses\b/i.test(t)) return 'silent'

  if (GREETING_LINE.test(raw.trim()) || (GREETING_PREFIX.test(raw) && raw.length < 80)) return 'greeting'

  if (isSocialCouncilCheckin(raw)) return 'greeting'

  if (/\battendance\b|\bcheck-?in\b|\broll\s*call\b|\bpresence\s*only\b|\bpresence\b.*\bcheck\b/i.test(t)) return 'attendance'

  if (resolveEconomicOpsRouting(raw).mode === 'economic_ops') return 'economic_ops'

  if (/\bresearch\b|\blit(?:erature)?\s*review\b|\binvestigate\b|\blook\s*up\b|\bsource(?:s)?\b/i.test(t)) return 'research'

  if (
    /\barchitecture\b|\bsystem\s*design\b|\bdata\s*model\b|\bschema\b|\binterface\s*contract\b|\bdependency\s*graph\b|\bcomponent\s*boundar(?:y|ies)\b/i.test(
      t,
    )
  ) {
    return 'architecture'
  }

  if (/\bcouncil\s+analysis\b|\bwar\s*council\s+analysis\b|\banalyze\s+the\s+council\b|\bcouncil\s+performance\b/i.test(t)) {
    return 'council_analysis'
  }

  if (/\bexecution\b|\bexecute\b|\bops\s*mode\b|\bship\s*it\b|\bdeploy\b/i.test(t)) return 'execution'

  if (/\bdebug(?:ging)?\b|\bstack\s*trace\b|\btraceback\b|\bregression\b|\brepro\b|\bstack\b/i.test(t)) return 'debugging'

  if (/\bbrainstorm\b|\bbrainstorming\b|\bideate\b|\bspitball\b|\briff\b|\bwhiteboard\b/i.test(t)) return 'brainstorming'

  if (
    /\bpanama\b|\bsovereignty\b|\blogistics\b|\bfreight\b|\brevenue\b|\bbusiness\b|\boperations\b|\bcash\s*flow\b|\bcontract\b|\binvoice\b|\bpayroll\b|\bdeposits\b|\bincome\b/i.test(
      t,
    )
  ) {
    return 'business_ops'
  }

  return 'natural'
}
