import type { PreRouterMatch } from './types'

// Deterministic, fixed-phrase detection — not general NLU. Order matters: the GIVE_* patterns are
// checked before WHATS_NEXT/REMEMBER_DIRECTIVE so a message can't accidentally double-match.
const GIVE_CLAUDE_PATTERN = /\bgive\s+claude(\s+code)?\s+(the\s+)?next\s+prompt\b/i
const GIVE_CODEX_PATTERN = /\bgive\s+codex\s+(the\s+)?(next|build)\s+prompt\b/i
const GIVE_KIMI_PATTERN = /\bgive\s+kimi\s+(the\s+)?(next\s+)?research\s+prompt\b/i
const WHATS_NEXT_PATTERN = /\b(what'?s\s+next|what\s+are\s+we\s+working\s+on|what\s+are\s+we\s+waiting\s+on)\b/i
const REMEMBER_PATTERN = /^\s*remember(?:\s+that)?\s*[:,]?\s+(.+)/i
const DECISION_PATTERN = /^\s*(?:the\s+)?(?:new\s+)?decision\s+is(?:\s+now)?\s*[:,]?\s+(.+)/i

export function detectPreRouterIntent(message: string): PreRouterMatch | null {
  const trimmed = message.trim()
  if (!trimmed) return null

  if (GIVE_CLAUDE_PATTERN.test(trimmed)) return { intent: 'GIVE_CLAUDE_NEXT_PROMPT' }
  if (GIVE_CODEX_PATTERN.test(trimmed)) return { intent: 'GIVE_CODEX_BUILD_PROMPT' }
  if (GIVE_KIMI_PATTERN.test(trimmed)) return { intent: 'GIVE_KIMI_RESEARCH_PROMPT' }
  if (WHATS_NEXT_PATTERN.test(trimmed)) return { intent: 'WHATS_NEXT' }

  const rememberMatch = trimmed.match(REMEMBER_PATTERN)
  if (rememberMatch?.[1]) return { intent: 'REMEMBER_DIRECTIVE', directiveContent: rememberMatch[1].trim() }

  const decisionMatch = trimmed.match(DECISION_PATTERN)
  if (decisionMatch?.[1]) return { intent: 'REMEMBER_DIRECTIVE', directiveContent: decisionMatch[1].trim() }

  return null
}
