import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

/** Keywords that widen scope to business / ops / geography — extend here only. */
export const TOPIC_SCOPE_KEYWORDS = [
  'business',
  'income',
  'revenue',
  'panama',
  'freight',
  'deposits',
  'operations',
  'cash flow',
  'payroll',
  'logistics',
  'invoice',
  'contract',
] as const

export type TopicScopeLock = {
  /** When true, families must not introduce the listed operational/business topics. */
  locked: boolean
  forbiddenLabels: string[]
  /** Regexes built from keyword list — used for stripping / drift detection. */
  forbiddenPatterns: RegExp[]
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\u2019/g, "'")
}

function mentionsAny(text: string, words: readonly string[]): boolean {
  const t = normalize(text)
  return words.some(w => t.includes(w.toLowerCase()))
}

/**
 * If Ra’el directive + optional user message do **not** mention scope keywords,
 * the lock forbids reintroducing those topics (families drift → strip or warn).
 */
export function deriveTopicScopeLock(raelDirectiveText: string, userMessage?: string): TopicScopeLock {
  const combined = [raelDirectiveText, userMessage].filter(Boolean).join('\n')
  const mentioned = mentionsAny(combined, TOPIC_SCOPE_KEYWORDS)
  if (mentioned) {
    return { locked: false, forbiddenLabels: [], forbiddenPatterns: [] }
  }
  const forbiddenPatterns = TOPIC_SCOPE_KEYWORDS.map(
    w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  )
  return {
    locked: true,
    forbiddenLabels: [...TOPIC_SCOPE_KEYWORDS],
    forbiddenPatterns,
  }
}

/** True if text matches a forbidden topic under an active lock. */
export function textViolatesTopicLock(lock: TopicScopeLock, text: string): boolean {
  if (!lock.locked) return false
  return lock.forbiddenPatterns.some(p => p.test(text))
}

/**
 * Remove lines that clearly reintroduce locked topics (conservative: whole line only).
 * Red Team lines may be preserved when `family === 'red_team'` for verification framing.
 */
export function stripLockedTopicLines(
  text: string,
  lock: TopicScopeLock,
  family: CouncilOrchestrationFamily,
): { text: string; strippedLineCount: number } {
  if (!lock.locked || !text.trim()) return { text, strippedLineCount: 0 }
  const lines = text.split('\n')
  let strippedLineCount = 0
  const kept: string[] = []
  for (const line of lines) {
    const hit = lock.forbiddenPatterns.some(p => p.test(line))
    if (hit && family !== 'red_team') {
      strippedLineCount += 1
      continue
    }
    kept.push(line)
  }
  return { text: kept.join('\n').trim(), strippedLineCount }
}
