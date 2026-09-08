/**
 * Lightweight, deterministic seat-distinctness helpers.
 *
 * Used to (1) compress prior-seat context so later seats are not handed a full essay to copy,
 * (2) attach role-specific anti-echo directives, and (3) score near-repetition in regression
 * fixtures. This is not a recursive Council loop — it never re-asks a seat.
 */

import type { NebulaAgentId } from '@/lib/council/nebula/identity'

const STOP = new Set([
  'that', 'this', 'with', 'from', 'into', 'about', 'there', 'their', 'should', 'would',
  'could', 'have', 'has', 'what', 'when', 'where', 'which', 'while', 'your', 'you',
  'they', 'them', 'been', 'being', 'were', 'will', 'also', 'just', 'like', 'over',
  'such', 'only', 'council', 'family', 'war', 'room', 'the', 'and', 'for', 'not',
])

export const SEAT_BRIEF_MAX_CHARS = 280

export function compressSeatBrief(content: string, maxChars = SEAT_BRIEF_MAX_CHARS): string {
  const cleaned = content.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean)
  let brief = sentences.slice(0, 2).join(' ')
  if (brief.length > maxChars) brief = `${brief.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
  return brief
}

export type SeatBriefInput = {
  family: string
  content: string
  roleHint?: string
}

export function formatPriorSeatBriefs(prior: SeatBriefInput[], opts?: { maxChars?: number }): string {
  if (!prior.length) return 'Prior seat briefs this turn: (none yet — you speak first after Ra\'el).'
  const maxChars = opts?.maxChars ?? SEAT_BRIEF_MAX_CHARS
  return [
    'Prior seat briefs this turn (critique, verify, or challenge these — do not copy, paraphrase as your own analysis, or rewrite them):',
    ...prior.map(item => {
      const role = item.roleHint?.trim() ? ` [${item.roleHint.trim()}]` : ''
      return `- ${item.family}${role}: ${compressSeatBrief(item.content, maxChars)}`
    }),
  ].join('\n')
}

function significantTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !STOP.has(word))
  return new Set(words)
}

/** Jaccard overlap on significant tokens. 1 = identical token set, 0 = disjoint. */
export function tokenJaccardSimilarity(a: string, b: string): number {
  const left = significantTokens(a)
  const right = significantTokens(b)
  if (!left.size && !right.size) return 1
  if (!left.size || !right.size) return 0
  let inter = 0
  for (const token of left) {
    if (right.has(token)) inter += 1
  }
  const union = new Set([...left, ...right]).size
  return union ? inter / union : 0
}

export const NEAR_ECHO_THRESHOLD = 0.62

export function isNearEcho(a: string, b: string, threshold = NEAR_ECHO_THRESHOLD): boolean {
  if (!a.trim() || !b.trim()) return false
  return tokenJaccardSimilarity(a, b) >= threshold
}

export function priorSeatsWereNearEcho(prior: Array<{ content: string }>): boolean {
  if (prior.length < 2) return false
  for (let i = 1; i < prior.length; i++) {
    if (isNearEcho(prior[i - 1]!.content, prior[i]!.content)) return true
  }
  return false
}

export const DISTINCTNESS_NUDGE =
  'Previous seats in this round were too similar. Do your own role — verify, challenge, or synthesize survivors. Do not repeat or politely rewrite the prior answer.'

export const SEAT_ANTI_ECHO: Record<NebulaAgentId, string> = {
  orion:
    'Do engineering/runtime architecture work: components, interfaces, data models, operational hazards, tests. Do not write a generic reliability essay. Do not claim current War Room state as verified without same-round evidence.',
  lumen:
    'Verify; do not write a second analysis. Classify prior claims as supported, unsupported, or unresolved from evidence actually in this round. Explicitly verify the old-vs-new comparison: still supported, stale, contradicted, insufficient, or only partially supported. Reject unsupported operational/system-state claims. Do not treat KIMI_WAVE or STORED_RESEARCH as live proof. Do not echo, paraphrase, or agree with ORION or PULSAR as a substitute for verification. Agreement is not proof.',
  aurora:
    'Final synthesis only after distinct seat work. Current facts first. Distinguish historical/stored context from live evidence. Name meaningful change over time and unresolved gaps. Weave only what survived verification. Do not rewrite ORION, PULSAR, or LUMEN. Do not restate rejected or unverified old claims as current facts. If no live source confirms an old claim, say so. Preserve dissent and uncertainty.',
  phoenix:
    'Adversarial failure-mode challenge: attack assumptions, name counterexamples, bound likelihood/impact, propose recovery. Do not restate prior analysis.',
  nova:
    'Strategy and sequencing only: objective, options, phases, dependencies, what would change the plan. Do not repeat engineering analysis or act as final synthesizer.',
  pulsar:
    'Evidence discovery and provenance: what was found, what was missing, contradictions. Distinguish PRIOR KIMI INTELLIGENCE, PRIOR WAR ROOM RESEARCH, CURRENT LIVE EVIDENCE, CURRENT RUNTIME/TERRA EVIDENCE, and MODEL INFERENCE. Never treat KIMI_WAVE or STORED_RESEARCH as live proof. Do not deliver a verdict or rewrite another seat.',
  solara:
    'Human/practical impact only. Do not take over engineering, verification, or final synthesis.',
  astra:
    'Orchestration only. Do not answer the mission as a Council deliberating seat or copy another agent\'s findings as your own.',
}

export function antiEchoDirectiveFor(agentId: NebulaAgentId): string {
  return SEAT_ANTI_ECHO[agentId]
}
