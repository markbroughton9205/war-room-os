/**
 * Council coordinator: picks the smallest competent member set for a turn and records why.
 * Deterministic. It never invents members; it only selects from the live roster passed in.
 */
import type { CoordinatorDecision, TurnUnderstanding } from './types'
import { isSelfKnowledgeQuestion } from './knowledge'
import { classifyAstraIntent, selectAgentsForIntent } from '@/lib/council/nebula/roundFlow'

export type RosterMember = {
  id: string // 'ORION'
  role: string
  /** Keywords that indicate this member's expertise. */
  expertise: string[]
  /** Installed local model that would serve this member for this turn. */
  model: string
  heavy: boolean
}

export type CoordinatorInput = {
  turnId: string
  understanding: TurnUnderstanding
  roster: RosterMember[]
  /** Members that already contributed earlier in this discussion (for continuity). */
  priorParticipants?: string[]
  /** Commander named a member ("ask ORION ..."). */
  addressed?: string[]
  /** Question needs live external evidence. */
  externalEvidenceNeeded?: boolean
  /** Hard cap per turn. */
  maxMembers?: number
}

const SUBSTANTIVE_RE = /\b(architecture|design|tradeoff|trade-off|should we|how should|why does|compare|strategy|plan|integrat|coordinat|reliab|persist|scal|security|boundary|failure|migrat|orchestrat)\b/
const RESEARCH_RE = /\b(research|investigate|find out|look up|sources?|evidence|study|studies|literature|what does the (data|evidence) say)\b/

function score(m: RosterMember, text: string): number {
  let s = 0
  for (const k of m.expertise) if (text.includes(k)) s += 1
  return s
}

export function coordinate(input: CoordinatorInput): CoordinatorDecision {
  const u = input.understanding
  const reasons: string[] = []
  const excluded: CoordinatorDecision['excluded'] = []
  const base = { turnId: input.turnId, serializeHeavyLocal: true }
  const cap = Math.max(1, Math.min(input.maxMembers ?? 4, input.roster.length))

  if (u.clarification && u.act !== 'follow_up') {
    return { ...base, complexity: 'trivial', route: 'clarify', members: [], excluded: [], externalResearch: false, reasons: ['missing information materially affects execution'] }
  }
  if (u.executionRequested) {
    return { ...base, complexity: 'simple', route: 'handoff', members: [], excluded: [], externalResearch: false, reasons: ['execution request: Stage 1 discusses; execution is handed off under Commander authority gates'] }
  }
  if (u.recall) {
    return { ...base, serializeHeavyLocal: false, complexity: 'trivial', route: 'self_knowledge', members: [], excluded: input.roster.map(m => ({ member: m.id, reason: 'not needed: answered from this conversation record' })), externalResearch: false, reasons: ['Commander asked what was said earlier; answered from the conversation record with no model call'] }
  }
  if (isSelfKnowledgeQuestion(u)) {
    return { ...base, serializeHeavyLocal: false, complexity: 'trivial', route: 'self_knowledge', members: [], excluded: input.roster.map(m => ({ member: m.id, reason: 'not needed: answered from installed War Room state' })), externalResearch: false, reasons: ['question about War Room itself; answered from local knowledge with no model call'] }
  }
  if (u.act === 'social') {
    const m = input.roster.find(r => r.id === (input.priorParticipants?.[0] ?? '')) ?? input.roster[0]
    return { ...base, complexity: 'trivial', route: 'direct_member', members: m ? [m.id] : [], excluded: input.roster.filter(r => r !== m).map(r => ({ member: r.id, reason: 'social turn needs one voice' })), externalResearch: false, reasons: ['social turn'] }
  }

  const text = u.normalized
  const research = Boolean(input.externalEvidenceNeeded) || RESEARCH_RE.test(text)
  const substantive = SUBSTANTIVE_RE.test(text) || text.split(' ').length > 18
  const complexity: CoordinatorDecision['complexity'] = research ? 'research' : substantive ? 'substantive' : 'simple'

  if (input.addressed?.length) {
    const ids = input.addressed.filter(id => input.roster.some(r => r.id === id))
    for (const r of input.roster) if (!ids.includes(r.id)) excluded.push({ member: r.id, reason: 'not addressed by Commander' })
    return { ...base, complexity, route: ids.length > 1 ? 'small_group' : 'direct_member', members: ids, excluded, externalResearch: research, reasons: ['Commander addressed specific member(s)'] }
  }

  // Reuse the existing ASTRA intent plan as the candidate set (no second orchestration system);
  // Stage 1 only narrows it. Fall back to the whole roster if ASTRA names nobody we can run.
  const astraNames = selectAgentsForIntent(classifyAstraIntent(input.understanding.normalized)).map(id => id.toUpperCase())
  const fromAstra = input.roster.filter(r => astraNames.includes(r.id))
  const candidates = fromAstra.length ? fromAstra : input.roster
  const want = Math.min(complexity === 'simple' ? 1 : 3, cap, candidates.length)
  const ranked = [...candidates]
    .map(m => ({ m, s: score(m, text) + (input.priorParticipants?.includes(m.id) ? 0.5 : 0) }))
    .sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id))
  let picked = ranked.slice(0, want).map(x => x.m)
  // Keep the synthesizer when more than one voice speaks, so disagreement is integrated, not hidden.
  const synth = candidates.find(r => /integrat|synthes/i.test(r.role))
  if (picked.length > 1 && synth && !picked.includes(synth)) picked = [...picked.slice(0, want - 1), synth]
  if (fromAstra.length) reasons.push(`ASTRA intent plan offered ${fromAstra.map(f => f.id).join(', ')}`)
  for (const r of input.roster) if (!picked.includes(r)) excluded.push({ member: r.id, reason: complexity === 'simple' ? 'simple question: one competent member is enough' : 'lower relevance to this question' })
  reasons.push(`${complexity} question -> ${picked.length} member(s)`)
  if (research) reasons.push('question requires external evidence')
  const models = new Set(picked.map(p => p.model))
  if (models.size > 1) reasons.push(`members map to ${models.size} different local models; they will run one at a time to avoid GPU contention`)
  return {
    ...base,
    complexity,
    route: research ? 'research' : picked.length > 1 ? 'group_discussion' : 'direct_member',
    members: picked.map(p => p.id),
    excluded,
    externalResearch: research,
    reasons,
  }
}

/** Orders members so each distinct model loads once (resident model first). */
export function planSerialExecution(members: RosterMember[], residentModel: string | null): RosterMember[] {
  const byModel = new Map<string, RosterMember[]>()
  for (const m of members) byModel.set(m.model, [...(byModel.get(m.model) ?? []), m])
  const order = [...byModel.keys()].sort((a, b) => (a === residentModel ? -1 : b === residentModel ? 1 : a.localeCompare(b)))
  return order.flatMap(k => byModel.get(k) as RosterMember[])
}
