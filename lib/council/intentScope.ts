import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { IntentKind } from '@/lib/council/intentClassifier'
import { TOPIC_SCOPE_KEYWORDS } from '@/lib/council/topicScope'

export type ResponseLength = 'presence' | 'brief' | 'standard' | 'extended'

export type ResponseStyle = 'warm' | 'neutral' | 'analytical' | 'procedural' | 'adversarial'

/** Snapshot of numeric caps for this decree — merged with orchestration elsewhere. */
export type ActiveScopeFamilyPermissions = {
  maxResponsesPerFamily: number
  maxCharsPerFamily: number
}

export type ActiveScope = {
  intent: IntentKind
  /** When true, Panama / revenue / logistics-style topics are allowed by decree intent. */
  businessTopicsAllowed: boolean
  allowedTopics: string[]
  forbiddenTopics: string[]
  responseLength: ResponseLength
  responseStyle: ResponseStyle
  familyPermissions: ActiveScopeFamilyPermissions
  crossTalkAllowed: boolean
  sessionDuration: 'single_burst' | 'short' | 'standard' | 'extended'
}

const DEFAULT_BUSINESS_LABELS = [...TOPIC_SCOPE_KEYWORDS] as string[]

const EXTRA_FORBIDDEN = ['sovereignty', 'panama canal', 'invoice', 'payroll'] as const

/** Red Team and long-form contradiction passes allowed in these contexts. */
export function isVerificationHeavyContext(cmd: CouncilCommand, intent: IntentKind): boolean {
  if (['analysis', 'debate', 'research', 'execution', 'red_team_only'].includes(cmd.mode)) return true
  return ['research', 'debugging', 'architecture', 'council_analysis', 'execution', 'business_ops'].includes(intent)
}

export function buildActiveScope(args: {
  decreeText: string
  councilCommand: CouncilCommand
  intent: IntentKind
}): ActiveScope {
  const { councilCommand: cmd, intent } = args
  const businessTopicsAllowed = intent === 'business_ops'

  const forbiddenTopics = businessTopicsAllowed
    ? []
    : [...new Set([...DEFAULT_BUSINESS_LABELS, ...EXTRA_FORBIDDEN])]

  const allowedTopics =
    businessTopicsAllowed
      ? [...DEFAULT_BUSINESS_LABELS, 'panama', 'sovereignty', 'logistics']
      : intent === 'greeting' || intent === 'attendance' || intent === 'silent'
        ? ['tone', 'presence', 'coordination']
        : intent === 'council_analysis' || cmd.mode === 'analysis' || cmd.mode === 'debate'
          ? ['analysis', 'strategy', 'risk', 'recommendation']
          : []

  let responseLength: ResponseLength = 'standard'
  let responseStyle: ResponseStyle = 'neutral'
  let sessionDuration: ActiveScope['sessionDuration'] = 'standard'

  if (intent === 'attendance' || cmd.mode === 'attendance') {
    responseLength = 'presence'
    responseStyle = 'warm'
    sessionDuration = 'single_burst'
  } else if (intent === 'greeting') {
    responseLength = 'brief'
    responseStyle = 'warm'
    sessionDuration = 'single_burst'
  } else if (intent === 'silent' || cmd.mode === 'silent') {
    responseLength = 'presence'
    sessionDuration = 'single_burst'
  } else if (intent === 'research' || cmd.mode === 'research') {
    responseLength = 'extended'
    responseStyle = 'analytical'
    sessionDuration = 'extended'
  } else if (intent === 'architecture' || intent === 'debugging') {
    responseLength = 'standard'
    responseStyle = 'analytical'
    sessionDuration = 'short'
  } else if (intent === 'execution' || cmd.mode === 'execution') {
    responseLength = 'standard'
    responseStyle = 'procedural'
    sessionDuration = 'short'
  } else if (intent === 'council_analysis' || cmd.mode === 'analysis') {
    responseLength = 'extended'
    responseStyle = 'analytical'
    sessionDuration = 'extended'
  } else if (intent === 'brainstorming' || cmd.mode === 'debate') {
    responseLength = 'standard'
    responseStyle = 'neutral'
    sessionDuration = 'standard'
  }

  const crossTalkAllowed =
    intent === 'brainstorming'
    || intent === 'council_analysis'
    || cmd.mode === 'debate'
    || cmd.mode === 'analysis'

  const familyPermissions: ActiveScopeFamilyPermissions = {
    maxResponsesPerFamily: cmd.responseLimits.maxResponsesPerFamily,
    maxCharsPerFamily: cmd.responseLimits.maxChars,
  }

  if (intent === 'greeting') {
    familyPermissions.maxCharsPerFamily = Math.min(familyPermissions.maxCharsPerFamily, 900)
  }
  if (intent === 'attendance') {
    familyPermissions.maxCharsPerFamily = Math.min(familyPermissions.maxCharsPerFamily, 420)
  }
  if (intent === 'silent') {
    familyPermissions.maxCharsPerFamily = Math.min(familyPermissions.maxCharsPerFamily, 400)
  }

  return {
    intent,
    businessTopicsAllowed,
    allowedTopics,
    forbiddenTopics,
    responseLength,
    responseStyle,
    familyPermissions,
    crossTalkAllowed,
    sessionDuration,
  }
}

/** Build regex patterns for scope forbidden labels (whole-token style). */
export function forbiddenTopicPatterns(scope: ActiveScope): RegExp[] {
  return scope.forbiddenTopics.map(w => {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${esc}\\b`, 'i')
  })
}

const STRATEGIC_PIVOT = /\b(pivot|reframe|instead\s+let's|ignore\s+the\s+above|new\s+strategy|okr|kpi|roadmap\s+reset)\b/gi

const CROSS_TALK_LINE =
  /^\s*(?:@)?(chatgpt|claude|grok|gemini|red\s*team|baby|kimi|bridge)(?:\s+family)?\b[^:]{0,80}:/i

const DIRECT_OTHER = /\b(claude|chatgpt|grok|gemini),?\s+you\b|\bhey\s+(claude|chatgpt|grok|gemini)\b/gi

export function stripCrossTalkLines(text: string): { text: string; stripped: number } {
  const lines = text.split('\n')
  let stripped = 0
  const out: string[] = []
  for (const line of lines) {
    if (CROSS_TALK_LINE.test(line) || DIRECT_OTHER.test(line)) {
      stripped += 1
      continue
    }
    out.push(line)
  }
  return { text: out.join('\n').trim(), stripped }
}

export function stripStrategicPivotLanguage(text: string): { text: string; stripped: number } {
  const before = text
  const next = text.replace(STRATEGIC_PIVOT, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text: next, stripped: before === next ? 0 : 1 }
}

export function textViolatesForbiddenScope(scope: ActiveScope, text: string): boolean {
  if (!scope.forbiddenTopics.length) return false
  return forbiddenTopicPatterns(scope).some(p => p.test(text))
}

export function stripForbiddenScopeLines(text: string, scope: ActiveScope): { text: string; stripped: number } {
  if (!scope.forbiddenTopics.length || !text.trim()) return { text, stripped: 0 }
  const pats = forbiddenTopicPatterns(scope)
  const lines = text.split('\n')
  let stripped = 0
  const kept: string[] = []
  for (const line of lines) {
    if (pats.some(p => p.test(line))) {
      stripped += 1
      continue
    }
    kept.push(line)
  }
  return { text: kept.join('\n').trim(), stripped }
}

/** Greeting: block mission steering / off-decree business drift — not general helpful substance. */
const GREETING_STEERING_FORBIDDEN =
  /\b(panama|revenue|logistics|sovereignty|business|invoice|contract|roadmap|okr|kpi|agenda|what\s+objective|objective\s+today|capital allocation|boardroom|north\s*star|stakeholder|operating\s+model|go-?to-?market)\b/i

/** Attendance: off-topic ops / roll-call strategy — allow brief "operational" presence lines. */
const ATT_FORBIDDEN =
  /\b(panama|revenue|logistics|sovereignty|business|invoice|contract|roadmap|okr|kpi|agenda|capital allocation|boardroom|north\s*star|stakeholder|operating\s+model|go-?to-?market|infrastructure\s+(?:status|narrative)|diagnostic)\b/i

const ATTENDANCE_VOICE_FLUFF =
  /\b(locked\s+in|accounted\s+for|all\s+present\s+and|roll\s*call\s+complete|nodes?\s+aligned|spectral|signal\s+lock|battle\s+rhythm)\b/gi

/** Strip roll-call filler / diagnostics tone before shaping `{Family} present.` */
export function stripAttendanceDisplayNoise(text: string): string {
  let t = text.replace(ATTENDANCE_VOICE_FLUFF, ' ').replace(/\s+/g, ' ').trim()
  t = t.replace(/[\uFE0F\u200D]/g, '')
  t = t.replace(/[\u{1F300}-\u{1FAFF}]{2,}/gu, ' ')
  return t.replace(/\s{2,}/g, ' ').trim()
}

/** Loosely enforce presence-style single line for attendance intent. */
export function enforceAttendancePresenceShape(text: string): { text: string; adjusted: boolean } {
  let t = text.replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim()
  let adjusted = false
  const firstSentence = t.split(/(?<=[.!?])\s+/)[0] ?? t
  if (ATT_FORBIDDEN.test(firstSentence)) {
    const m = t.match(/^.{0,80}?\bpresent\b[^.!?]*[.!?]?/i)
    t = (m ? m[0] : 'Present.').trim()
    adjusted = true
  } else if (t.length > 120) {
    t = `${t.slice(0, 117).trim()}…`
    adjusted = true
  }
  if (!/\bpresent\b/i.test(t)) {
    t = t.toLowerCase().startsWith('present') ? t : `Present — ${t}`
    adjusted = true
  }
  return { text: t.trim(), adjusted }
}

export function stripGreetingStrategicBoilerplate(text: string): { text: string; stripped: number } {
  const lines = text.split('\n')
  let stripped = 0
  const out: string[] = []
  for (const line of lines) {
    if (GREETING_STEERING_FORBIDDEN.test(line) && line.length > 48) {
      stripped += 1
      continue
    }
    out.push(line)
  }
  const joined = out.join('\n').trim()
  const cap = joined.slice(0, 640)
  return { text: cap, stripped: stripped + (joined.length > cap.length ? 1 : 0) }
}
