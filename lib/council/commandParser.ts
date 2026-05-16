import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  DEFAULT_COUNCIL_COMMAND,
  type CouncilCommand,
  type CouncilDisciplineMode,
  type CouncilExecutionPermission,
  type CouncilResponseLimits,
} from '@/lib/council/councilCommandTypes'
import { detectDirectInvocation } from '@/lib/council/directInvocation'
import { resolveEconomicOpsRouting } from '@/lib/economic/routing'

/** Full orchestration id list for command filtering (order-agnostic). */
export const ALL_ORCHESTRATION_FAMILIES: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'red_team',
  'bridge_architect',
  'baby',
]

const FAMILY_SYNONYMS: { id: CouncilOrchestrationFamily; patterns: RegExp[] }[] = [
  { id: 'chatgpt', patterns: [/\bchatgpt\b/i, /\bopenai\b/i, /\bgpt-?4\b/i] },
  { id: 'claude', patterns: [/\bclaude\b/i, /\banthropic\b/i] },
  { id: 'grok', patterns: [/\bgrok\b/i, /\bxai\b/i] },
  { id: 'gemini', patterns: [/\bgemini\b/i, /\bgoogle\s*(ai)?\b/i] },
  { id: 'red_team', patterns: [/\bred\s*team\b/i, /\bredteam\b/i] },
  { id: 'baby', patterns: [/\bbaby\b/i, /\bobserver\b/i] },
  { id: 'kimi', patterns: [/\bkimi\b/i, /\bmoonshot\b/i] },
  { id: 'bridge_architect', patterns: [/\bbridge\b/i, /\bbridge\s*architect\b/i] },
]

function normalizeInput(input: string) {
  return input.trim().toLowerCase().replace(/\u2019/g, "'")
}

function parseFamilyOnlyPhrase(t: string): CouncilOrchestrationFamily[] | null {
  const m = t.match(/\b(chatgpt|openai|gpt|claude|anthropic|grok|xai|gemini|google|red\s*team|redteam|baby|observer|kimi|moonshot|bridge(?:\s*architect)?)\s+only\b/)
  if (!m) return null
  const g = m[1]!.toLowerCase().replace(/\s+/g, ' ')
  if (g.includes('red')) return ['red_team']
  if (g.includes('chatgpt') || g === 'openai' || g.includes('gpt')) return ['chatgpt']
  if (g.includes('claude') || g.includes('anthropic')) return ['claude']
  if (g.includes('grok') || g === 'xai') return ['grok']
  if (g.includes('gemini') || g.includes('google')) return ['gemini']
  if (g.includes('baby') || g.includes('observer')) return ['baby']
  if (g.includes('kimi') || g.includes('moonshot')) return ['kimi']
  if (g.includes('bridge')) return ['bridge_architect']
  return null
}

function parseContinuationTarget(t: string): CouncilOrchestrationFamily[] | null {
  const m = t.match(/^\s*continue\s+(chatgpt|chat\s*gpt|openai|claude|anthropic|grok|xai|gemini|google|red\s*team|redteam|baby|observer|kimi|moonshot|bridge(?:\s*architect)?)\b/i)
  if (!m) return null
  const g = m[1]!.toLowerCase().replace(/\s+/g, ' ')
  if (g.includes('red')) return ['red_team']
  if (g.includes('chat') || g === 'openai') return ['chatgpt']
  if (g.includes('claude') || g.includes('anthropic')) return ['claude']
  if (g.includes('grok') || g === 'xai') return ['grok']
  if (g.includes('gemini') || g.includes('google')) return ['gemini']
  if (g.includes('baby') || g.includes('observer')) return ['baby']
  if (g.includes('kimi') || g.includes('moonshot')) return ['kimi']
  if (g.includes('bridge')) return ['bridge_architect']
  return null
}

function parseExceptFamilies(t: string): CouncilOrchestrationFamily[] {
  const out: CouncilOrchestrationFamily[] = []
  const re = /\bexcept\s+(chatgpt|openai|claude|anthropic|grok|xai|gemini|google|red\s*team|baby|kimi|moonshot|bridge(?:\s*architect)?)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const g = m[1]!.toLowerCase()
    if (g.includes('red')) out.push('red_team')
    else if (g.includes('chatgpt') || g.includes('openai')) out.push('chatgpt')
    else if (g.includes('claude') || g.includes('anthropic')) out.push('claude')
    else if (g.includes('grok') || g === 'xai') out.push('grok')
    else if (g.includes('gemini') || g.includes('google')) out.push('gemini')
    else if (g.includes('baby')) out.push('baby')
    else if (g.includes('kimi') || g.includes('moonshot')) out.push('kimi')
    else if (g.includes('bridge')) out.push('bridge_architect')
  }
  return [...new Set(out)]
}

function detectMode(t: string): CouncilDisciplineMode {
  if (/\b(emergency|code\s*red|drop\s*everything)\b/i.test(t)) return 'emergency'
  if (/\bred\s*team\s*only\b/i.test(t)) return 'red_team_only'
  if (/^\s*hold\s*$/i.test(t) || /\bsilent\b|\bhold\s*responses\b|\bno\s*responses\b/i.test(t)) return 'silent'
  if (/\battendance\s*only\b|\broll\s*call\b|\bpresence\s*only\b/i.test(t)) return 'attendance'
  if (/\bno\s+strategy\b|\bstrategy\s*off\b/i.test(t)) return 'attendance'
  if (/\bone\s*response\s*each\b|\bone\s*line\s*each\b/i.test(t)) return 'attendance'
  if (resolveEconomicOpsRouting(t).mode === 'economic_ops') return 'economic_ops'
  if (/\bexecution\b|\bexecute\b|\bops\s*mode\b/i.test(t)) return 'execution'
  if (/\bresearch\b|\blit\s*review\b|\binvestigate\b/i.test(t)) return 'research'
  if (/\bdebate\b|\bsparring\b|\bchallenge\b/i.test(t)) return 'debate'
  if (/\banalysis\b|\banalyze\b|\bdiagnostic\b/i.test(t)) return 'analysis'
  if (/\bcouncil\b|\bwar\s*council\b/i.test(t)) return 'council'
  return 'council'
}

function mergeLimits(base: CouncilCommand, maxPerFamily: number, maxChars: number): CouncilResponseLimits {
  return {
    maxResponsesPerFamily: Math.min(base.responseLimits.maxResponsesPerFamily, maxPerFamily),
    maxChars: Math.min(base.responseLimits.maxChars, maxChars),
  }
}

/**
 * Parse Ra’el / user free-text into structured council command.
 * Heuristic only — no LLM. Case-insensitive; supports common synonyms.
 */
export function parseCouncilCommand(input: string): CouncilCommand {
  const raw = typeof input === 'string' ? input : ''
  const t = normalizeInput(raw)
  if (!t) return { ...DEFAULT_COUNCIL_COMMAND }

  const mode = detectMode(t)
  const excludedFamilies = parseExceptFamilies(t)
  let targetFamilies = parseContinuationTarget(t) ?? parseFamilyOnlyPhrase(t) ?? []

  if (mode === 'red_team_only') {
    targetFamilies = ['red_team']
  }

  let executionPermission: CouncilExecutionPermission = 'open'
  if (/\bno\s*execution\b|\bexecution\s*off\b|\bdo\s*not\s*execute\b/i.test(t)) {
    executionPermission = 'limited'
  }

  let responseLimits = { ...DEFAULT_COUNCIL_COMMAND.responseLimits }

  if (mode === 'attendance' || /\bone\s*response\s*each\b/i.test(t)) {
    responseLimits = mergeLimits(DEFAULT_COUNCIL_COMMAND, 1, 360)
  }
  if (mode === 'emergency') {
    responseLimits = mergeLimits(DEFAULT_COUNCIL_COMMAND, 2, 8000)
  }
  if (mode === 'execution') {
    responseLimits = mergeLimits(DEFAULT_COUNCIL_COMMAND, 2, 6000)
  }
  if (mode === 'research' || mode === 'analysis') {
    responseLimits = mergeLimits(DEFAULT_COUNCIL_COMMAND, 3, 9000)
  }
  if (mode === 'economic_ops') {
    responseLimits = mergeLimits(DEFAULT_COUNCIL_COMMAND, 1, 1200)
  }
  if (mode === 'silent') {
    responseLimits = mergeLimits(DEFAULT_COUNCIL_COMMAND, 1, 400)
  }

  const direct = detectDirectInvocation(raw)
  if (mode !== 'attendance' && direct.invoked && direct.family) {
    targetFamilies = [direct.family]
    return {
      mode: 'council',
      authority: 'rael_explicit',
      scope: 'session',
      targetFamilies,
      excludedFamilies,
      directInvocation: true,
      directInvocationRemainder: direct.remainder,
      executionPermission,
      responseLimits: mergeLimits(DEFAULT_COUNCIL_COMMAND, 2, 4000),
    }
  }

  if (/^\s*continue\s+/i.test(t) && targetFamilies.length === 1) {
    return {
      mode: 'council',
      authority: 'rael_explicit',
      scope: 'session',
      targetFamilies,
      excludedFamilies,
      directInvocation: true,
      directInvocationRemainder: 'permissioned continuation',
      executionPermission,
      responseLimits: mergeLimits(DEFAULT_COUNCIL_COMMAND, 1, 4000),
    }
  }

  return {
    mode,
    authority: 'rael_explicit',
    scope: 'session',
    targetFamilies,
    excludedFamilies,
    directInvocation: false,
    directInvocationRemainder: '',
    executionPermission,
    responseLimits,
  }
}

/** True if `family` is named in the directive (for silent-mode invocation). */
export function familyMentionedInDirective(directive: string, family: CouncilOrchestrationFamily): boolean {
  const row = FAMILY_SYNONYMS.find(x => x.id === family)
  if (!row) return false
  return row.patterns.some(p => p.test(directive))
}

/**
 * Filter orchestration order using parsed command + Ra’el directive text.
 * `raelDirectiveText` should be the latest user decree, not the synthetic “continue council” line.
 */
export function filterOrchestrationOrderByCommand(
  order: CouncilOrchestrationFamily[],
  cmd: CouncilCommand,
  raelDirectiveText: string,
): CouncilOrchestrationFamily[] {
  if (cmd.directInvocation && cmd.targetFamilies.length === 1) {
    const only = cmd.targetFamilies[0]!
    return order.includes(only) ? [only] : [only]
  }

  let next = [...order]

  if (cmd.mode === 'red_team_only') {
    next = next.filter(f => f === 'red_team')
  }

  if (cmd.excludedFamilies.length) {
    next = next.filter(f => !cmd.excludedFamilies.includes(f))
  }

  if (cmd.targetFamilies.length) {
    const targets = cmd.targetFamilies.filter(f => !cmd.excludedFamilies.includes(f))
    next = next.filter(f => targets.includes(f))
    for (const family of targets) {
      if (!next.includes(family)) next.push(family)
    }
  }

  if (cmd.mode === 'silent') {
    const d = raelDirectiveText.trim()
    const mentioned = ALL_ORCHESTRATION_FAMILIES.filter(f => familyMentionedInDirective(d, f))
    if (cmd.targetFamilies.length) {
      next = next.filter(f => cmd.targetFamilies.includes(f))
    } else if (mentioned.length) {
      next = next.filter(f => mentioned.includes(f))
    } else {
      next = []
    }
  }

  return next
}
