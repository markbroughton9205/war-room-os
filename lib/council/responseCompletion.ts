/**
 * Council response completion — distinguishes clean stops vs likely truncation
 * (max tokens, mid-clause cuts) without auto-repairing copy.
 */

export type CouncilResponseCompletion = 'complete' | 'partial' | 'truncated'

const SENTENCE_END = /[.!?…]["')\]]*\s*$/u
/** Looks like an incomplete clause / open structure */
const OPEN_TAIL = /(?:\b(?:and|or|but|because|that|which|when|where|while|the|a|an)\s+)$/i
const DANGLING_CONNECTOR = /(?:\b(?:we're|we are|i'm|i am|it's|it is)\s+seeing\s+a)\s*$/i

export function assessCouncilTextCompletion(
  text: string,
  opts?: { providerFinishReason?: string | null },
): CouncilResponseCompletion {
  const t = (text ?? '').trim()
  if (!t) return 'partial'

  const fr = (opts?.providerFinishReason ?? '').trim().toUpperCase()
  if (fr === 'MAX_TOKENS' || fr === 'LENGTH' || fr === 'OTHER') return 'truncated'

  if (SENTENCE_END.test(t)) return 'complete'

  const fenceOpens = (t.match(/```/g) ?? []).length
  if (fenceOpens % 2 === 1) return 'truncated'

  if (t.length >= 120 && (OPEN_TAIL.test(t) || DANGLING_CONNECTOR.test(t))) return 'truncated'

  if (t.length <= 48 && !t.includes('\n')) return 'complete'

  if (t.length >= 200 && !SENTENCE_END.test(t)) return 'partial'

  return 'complete'
}
