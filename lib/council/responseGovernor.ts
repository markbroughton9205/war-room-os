import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import { familyMentionedInDirective } from '@/lib/council/commandParser'
import { effectiveMaxCharsForFamily } from '@/lib/council/familyPermissions'
import type { IntentKind } from '@/lib/council/intentClassifier'
import type { ActiveScope } from '@/lib/council/intentScope'
import {
  enforceAttendancePresenceShape,
  isVerificationHeavyContext,
  stripCrossTalkLines,
  stripForbiddenScopeLines,
  stripGreetingStrategicBoilerplate,
  stripStrategicPivotLanguage,
  textViolatesForbiddenScope,
} from '@/lib/council/intentScope'

const FLUFF_LINE = new RegExp(
  String.raw`^\s*(remember|believe in yourself|you've got this|stay strong|keep pushing|dream big|manifest|the universe|deep breath|you are enough)[^.]*$`,
  'i',
)

export const COUNCIL_GOVERNOR_SILENT_SKIP = 'council_governor_silent_skip'

export type GovernorContext = {
  /** Latest Ra’el decree text — required for silent-mode invocation checks. */
  raelDirectiveText: string
  councilIntentKind?: IntentKind
  councilActiveScope?: ActiveScope
}

/** ChatGPT: favor crisp synthesis — trim long hedging intros when over cap. */
function softChatgptTrim(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastPara = cut.lastIndexOf('\n\n')
  return lastPara > 40 ? cut.slice(0, lastPara).trim() : cut.trim()
}

/** Claude: prefer first structured block when attendance squeezes length. */
function softClaudeTrim(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).replace(/\s+\S*$/, '').trim()
}

/** Grok: strip duplicate “signal” hype lines under tight caps. */
function softGrokTrim(text: string): string {
  return text.replace(/\b(live\s*feed|breaking)\b[^.!?]*[.!?]\s*/gi, '')
}

/** Gemini: collapse overly long enumerated lists when char cap is low. */
function softGeminiTrim(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const lines = text.split('\n')
  const kept: string[] = []
  let n = 0
  for (const line of lines) {
    if (n + line.length > maxChars) break
    kept.push(line)
    n += line.length + 1
  }
  return kept.join('\n').trim()
}

/** Red Team: keep contradiction lead; drop trailing pep when capped. */
function softRedTeamTrim(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trim()
}

function stripBulletStrategy(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const s = line.trim()
      if (!s) return true
      if (/^[-*•]\s+/.test(s) && /\b(strategy|roadmap|plan|phase\s*\d|okr|kpi)\b/i.test(s)) return false
      return true
    })
    .join('\n')
    .trim()
}

function collapseRepeatedBlocks(text: string): string {
  const paras = text.split(/\n\n+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paras) {
    const key = p.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join('\n\n').trim()
}

function collapseRepeatedLines(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let prevNorm = ''
  for (const line of lines) {
    const norm = line.trim().toLowerCase()
    if (norm && norm === prevNorm) continue
    out.push(line)
    prevNorm = norm
  }
  return out.join('\n').trim()
}

function stripExecutionFluff(text: string): string {
  return text
    .split('\n')
    .filter(line => !FLUFF_LINE.test(line))
    .join('\n')
    .replace(/\b(in conclusion|to summarize|remember that)\b[^.!?]*[.!?]\s*/gi, '')
    .trim()
}

function applyFamilySoftRules(text: string, family: string, maxChars: number): string {
  const f = family as CouncilOrchestrationFamily
  let t = text
  switch (f) {
    case 'chatgpt':
      t = softChatgptTrim(t, maxChars)
      break
    case 'claude':
      t = softClaudeTrim(t, maxChars)
      break
    case 'grok':
      t = softGrokTrim(t)
      t = t.length > maxChars ? t.slice(0, maxChars).trim() : t
      break
    case 'gemini':
      t = softGeminiTrim(t, maxChars)
      break
    case 'red_team':
      t = softRedTeamTrim(t, maxChars)
      break
    default:
      t = t.length > maxChars ? t.slice(0, maxChars).trim() : t
  }
  return t
}

function silentFamilyInvoked(cmd: CouncilCommand, family: CouncilOrchestrationFamily, raelDirective: string): boolean {
  if (cmd.targetFamilies.length > 0) return cmd.targetFamilies.includes(family)
  return familyMentionedInDirective(raelDirective, family)
}

function scopeLog(tag: string) {
  console.warn(`[council-scope] ${tag}`)
}

function applyActiveScopeTail(args: {
  text: string
  family: CouncilOrchestrationFamily
  cmd: CouncilCommand
  intent?: IntentKind
  scope?: ActiveScope
  warnings: string[]
}): string {
  let t = args.text
  const { family, cmd, intent, scope, warnings } = args
  const ik = intent ?? scope?.intent

  if (scope) {
    const allowStrip =
      family !== 'red_team' || !isVerificationHeavyContext(cmd, scope.intent)
    if (allowStrip) {
      const st = stripForbiddenScopeLines(t, scope)
      t = st.text
      if (st.stripped > 0) {
        warnings.push('council_governor_stripped_active_scope_topic')
        scopeLog('stripped_forbidden_topic_lines')
      }
      if (textViolatesForbiddenScope(scope, t)) {
        warnings.push('protocol_drift_active_scope_residual')
        scopeLog('residual_forbidden_topic')
      }
    }
  }

  if (scope && !scope.crossTalkAllowed) {
    const cx = stripCrossTalkLines(t)
    t = cx.text
    if (cx.stripped > 0) {
      warnings.push('council_governor_stripped_cross_talk')
      scopeLog('stripped_cross_talk')
    }
  }

  if (family === 'red_team' && !isVerificationHeavyContext(cmd, ik ?? 'natural')) {
    const cap = 520
    if (t.length > cap) {
      t = t.slice(0, cap).trim()
      warnings.push('council_governor_red_team_length_capped')
      scopeLog('red_team_capped_non_verification')
    }
    const pv = stripStrategicPivotLanguage(t)
    t = pv.text
    if (pv.stripped > 0) {
      warnings.push('council_governor_red_team_stripped_pivot_language')
      scopeLog('red_team_stripped_pivot')
    }
  }

  if (ik === 'greeting') {
    const gr = stripGreetingStrategicBoilerplate(t)
    t = gr.text
    if (gr.stripped > 0) {
      warnings.push('council_governor_greeting_stripped_boilerplate')
      scopeLog('greeting_stripped_strategic')
    }
    if (t.length > 420) {
      t = `${t.slice(0, 417).trim()}…`
      warnings.push('council_governor_greeting_length_capped')
    }
  }

  return t.trim()
}

/**
 * Post-process model output before UI / API returns. Pure function — no I/O.
 */
export function applyGovernor(
  text: string,
  family: string,
  cmd: CouncilCommand,
  context?: GovernorContext,
): { text: string; warnings?: string[] } {
  const warnings: string[] = []
  const orch = family as CouncilOrchestrationFamily
  let t = (text ?? '').trim()
  const intent = context?.councilIntentKind
  const scope = context?.councilActiveScope

  let maxChars = Math.max(80, effectiveMaxCharsForFamily(orch, cmd.responseLimits.maxChars))
  if (scope?.familyPermissions?.maxCharsPerFamily) {
    maxChars = Math.min(maxChars, Math.max(80, scope.familyPermissions.maxCharsPerFamily))
  }

  const raelDirective = context?.raelDirectiveText?.trim() ?? ''

  if (cmd.mode === 'silent') {
    if (!silentFamilyInvoked(cmd, orch, raelDirective)) {
      return { text: '', warnings: [COUNCIL_GOVERNOR_SILENT_SKIP] }
    }
  }

  t = collapseRepeatedBlocks(t)
  t = collapseRepeatedLines(t)

  if (cmd.mode === 'attendance' || intent === 'attendance') {
    t = stripBulletStrategy(t)
    t = t.replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim()
    const cap = Math.min(380, maxChars)
    if (t.length > cap) t = `${t.slice(0, cap - 1).trim()}…`
    if (!/[.!?]$/.test(t)) t = `${t}.`
    const presence = t.toLowerCase().startsWith('present') ? t : `Present — ${t}`
    const shaped = enforceAttendancePresenceShape(presence)
    if (shaped.adjusted) warnings.push('council_governor_attendance_scope_shaped')
    t = applyActiveScopeTail({
      text: shaped.text,
      family: orch,
      cmd,
      intent,
      scope,
      warnings,
    })
    return { text: t, warnings: warnings.length ? warnings : undefined }
  }

  if (cmd.mode === 'execution') {
    t = stripExecutionFluff(t)
  }

  t = applyFamilySoftRules(t, family, maxChars)

  t = applyActiveScopeTail({ text: t, family: orch, cmd, intent, scope, warnings })

  if (!t.trim()) {
    warnings.push('council_governor_empty_after_trim')
  }

  return { text: t.trim(), warnings: warnings.length ? warnings : undefined }
}
