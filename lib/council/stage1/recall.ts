/**
 * Conversation recall: "what did you say before about it?" is answered from this conversation's own record.
 * Deterministic: no model call, no external research, nothing is paraphrased into a new claim.
 */
import type { HistoryTurn, TurnUnderstanding } from './types'

const MAX_ITEMS = 2
const MAX_CHARS = 700

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3))
}

/** True when a member message is the kind of non-answer a recall should not present as a statement of fact. */
function isFailureBrief(text: string): boolean {
  return /^(?:i could not (?:fully )?verify|i couldn't verify|i do not have verified evidence|on that: i do not yet have verified)/i.test(text.trim())
}

export function answerRecall(u: TurnUnderstanding, history: HistoryTurn[]): { text: string; found: number } {
  const members = history.filter(h => h.role === 'member' && h.text.trim())
  if (!members.length) {
    return { text: 'There is no earlier member reply in this conversation to recall yet. Nothing has been said that I could repeat.', found: 0 }
  }
  const topicWords = new Set<string>()
  for (const t of u.topics) for (const w of words(t)) topicWords.add(w)
  for (const r of u.references) if (r.resolvedTo) for (const w of words(r.resolvedTo)) topicWords.add(w)
  const scored = members
    .map((h, i) => {
      const hw = words(h.text)
      let hit = 0
      for (const w of topicWords) if (hw.has(w)) hit++
      return { h, i, hit }
    })
  const relevant = topicWords.size ? scored.filter(x => x.hit > 0) : []
  const picked = (relevant.length ? relevant : scored).sort((a, b) => b.i - a.i).slice(0, MAX_ITEMS).sort((a, b) => a.i - b.i)
  const lines: string[] = []
  const subject = u.topics.filter(t => t !== 'war room')[0]
  lines.push(subject
    ? `Here is what was said earlier in this conversation about ${subject}:`
    : 'Here is what was said most recently in this conversation:')
  for (const { h } of picked) {
    const body = h.text.trim().replace(/\s+/g, ' ')
    const clipped = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}…` : body
    lines.push(`- ${h.memberId ?? 'A member'} said: “${clipped}”${isFailureBrief(h.text) ? ' (that reply was itself an inability to verify, not an answer)' : ''}`)
  }
  if (!relevant.length && topicWords.size) lines.push('No earlier reply matched that subject closely, so these are the latest replies.')
  lines.push('Source: this conversation\'s record. No model was called and no external research was run.')
  return { text: lines.join('\n'), found: picked.length }
}
