/** Deterministic "continue where we stopped": only states what the persisted record proves. */
import type { Stage1TurnRecord } from './record'

export function buildContinuationResponse(turns: Stage1TurnRecord[]): { text: string; status: 'COMPLETED' | 'WAITING' } {
  const usable = turns.filter(t => t.decree && t.status !== 'QUEUED' && t.mode !== 'stage1_clarification' && !t.understanding.continuation)
  if (usable.length === 0) {
    return {
      status: 'WAITING',
      text: 'I have no recorded earlier discussion in this session to continue from. Tell me the subject (or reopen the session you mean) and I will pick it up from there.',
    }
  }
  const last = usable[usable.length - 1]
  const unfinished = last.status !== 'COMPLETED'
  const recent = usable.slice(-3)
  const lines: string[] = []
  lines.push(`We stopped at: “${last.decree}” (${last.status}${last.statusReason ? ` — ${last.statusReason}` : ''}).`)
  if (last.contributions.length) {
    lines.push('Who had contributed: ' + last.contributions.map(c => `${c.member} (${c.status.toLowerCase()})`).join(', ') + '.')
  }
  const pending = last.decision.members.filter(m => !last.contributions.some(c => c.member.toUpperCase() === m.toUpperCase()))
  if (pending.length && last.decision.route !== 'self_knowledge') lines.push(`Selected but did not speak: ${pending.join(', ')}.`)
  if (last.responsePreview) lines.push(`Last answer began: “${last.responsePreview}”`)
  if (recent.length > 1) lines.push('Earlier in this session: ' + recent.slice(0, -1).map(t => `“${t.decree}”`).join('; ') + '.')
  lines.push(unfinished
    ? 'That turn did not finish cleanly, so I will not treat it as settled. Say “redo it” to run it again, or give me the next point.'
    : 'That turn finished. Give me the next point and I will build on it.')
  return { status: 'COMPLETED', text: lines.join('\n\n') }
}
