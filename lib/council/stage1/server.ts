/**
 * Server adapter for Council Stage 1. Reads real installed state (stamp + probes + live roster)
 * and produces either a final deterministic response (self-knowledge, clarification) or a
 * turn analysis that execute.ts folds into the normal Council path. No model is called here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { NEBULA_AGENTS } from '@/lib/council/nebula/identity'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'
import { answerSelfKnowledge, collectInstalledState, isSelfKnowledgeQuestion, type InstalledState } from './knowledge'
import { coordinate, type RosterMember } from './coordinator'
import { COORDINATOR_ACTOR, createLedger, deterministicActor, record, summarizeLedger } from './provenance'
import { understandTurn } from './language'
import { buildContinuationResponse } from './continuation'
import { answerRecall } from './recall'
import type { Stage1TurnRecord } from './record'
import type { CoordinatorDecision, HistoryTurn, KnowledgeClaim, Stage1Status, TurnUnderstanding } from './types'

const COMMANDER_SENDERS = /^(ra'?el|commander|user|you|me)$/i

export function historyFromThread(thread: unknown): HistoryTurn[] {
  if (!Array.isArray(thread)) return []
  const out: HistoryTurn[] = []
  for (const row of thread.slice(-24)) {
    if (!row || typeof row !== 'object') continue
    const sender = String((row as { sender?: unknown }).sender ?? '').trim()
    const text = String((row as { content?: unknown }).content ?? '').trim()
    if (!text) continue
    if (COMMANDER_SENDERS.test(sender.replace(/’/g, "'"))) out.push({ role: 'commander', text })
    else if (/^system$/i.test(sender)) out.push({ role: 'system', text })
    else out.push({ role: 'member', memberId: sender.toUpperCase(), text })
  }
  return out
}

function findUp(start: string, name: string, max = 8): string | null {
  let dir = start
  for (let i = 0; i < max; i++) {
    const p = path.join(dir, name)
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

let stateCache: { at: number; state: InstalledState } | null = null

export function readInstalledState(opts: { now?: number; root?: string } = {}): InstalledState {
  const now = opts.now ?? Date.now()
  if (stateCache && now - stateCache.at < 30_000 && !opts.root) return stateCache.state
  const root = opts.root ?? process.cwd()
  const roster = NEBULA_AGENTS.map(a => ({ id: a.id, name: a.name, role: a.role, status: a.status }))
  const state = collectInstalledState({
    exists: rel => { try { return fs.existsSync(path.join(root, rel)) } catch { return false } },
    readStamp: () => {
      const candidates = [
        process.env.WAR_ROOM_INSTALL_STAMP,
        findUp(root, 'INSTALL_STAMP.json'),
        findUp(path.dirname(process.execPath), 'INSTALL_STAMP.json'),
      ].filter((x): x is string => Boolean(x))
      for (const c of candidates) {
        try { return fs.readFileSync(c, 'utf8') } catch { /* try next */ }
      }
      return null
    },
    roster,
    sharedLocalModel: NEBULA_SHARED_LOCAL_MODEL_ID,
  })
  if (!opts.root) stateCache = { at: now, state }
  return state
}

/** Roster used for coordination: only active identities, mapped to the model that would serve them. */
export function coordinationRoster(): RosterMember[] {
  const expertise: Record<string, string[]> = {
    aurora: ['synthesis', 'integrat', 'summar', 'overall'],
    orion: ['architecture', 'design', 'boundary', 'persist', 'orchestrat', 'system', 'integrat', 'coordinat', 'schema', 'api'],
    pulsar: ['research', 'evidence', 'source', 'signal', 'investigat', 'study'],
    lumen: ['risk', 'failure', 'security', 'reliab', 'privacy', 'leak', 'isolation', 'attack', 'safe'],
    nova: ['plan', 'strategy', 'sequence', 'roadmap', 'next', 'step', 'stage'],
    phoenix: ['challenge', 'wrong', 'flaw', 'assum', 'red team', 'break'],
  }
  return NEBULA_AGENTS.filter(a => a.status === 'active' && a.id !== 'astra' && a.id !== 'solara').map(a => ({
    id: a.name,
    role: a.role,
    expertise: expertise[a.id] ?? [],
    model: NEBULA_SHARED_LOCAL_MODEL_ID,
    heavy: false,
  }))
}

export type Stage1TurnResult = {
  understanding: TurnUnderstanding
  decision: CoordinatorDecision
  /** Present when Stage 1 answered the turn itself (no model call). */
  finalResponse: null | {
    text: string
    status: Stage1Status
    claims: KnowledgeClaim[]
    mode: 'stage1_self_knowledge' | 'stage1_clarification' | 'stage1_recall'
  }
  /** Decree text with resolved references attached; used by downstream routing. */
  effectiveText: string
  provenance: ReturnType<typeof summarizeLedger> & { entries: ReturnType<typeof createLedger>['entries'] }
}

export function runStage1Turn(input: {
  turnId: string
  text: string
  thread: unknown
  state?: InstalledState
  addressed?: string[]
  /** Persisted turn records for this owner+conversation (used only to recover "continue"). */
  priorTurns?: Stage1TurnRecord[]
}): Stage1TurnResult {
  const history = historyFromThread(input.thread)
  // The thread already contains this very decree when the client appends before sending.
  const trimmed = history.length && history[history.length - 1].role === 'commander' && history[history.length - 1].text === input.text.trim()
    ? history.slice(0, -1)
    : history
  const understanding = understandTurn({ text: input.text, history: trimmed })
  const state = input.state ?? readInstalledState()
  const roster = coordinationRoster()
  const decision = coordinate({
    turnId: input.turnId,
    understanding,
    roster,
    priorParticipants: Array.from(new Set(trimmed.filter(h => h.role === 'member' && h.memberId).map(h => h.memberId as string))),
    addressed: input.addressed,
  })
  const ledger = createLedger(input.turnId)
  record(ledger, deterministicActor('language', 'Language understanding (deterministic)'), 'understand',
    `act=${understanding.act}; topics=${understanding.topics.join(',') || 'none'}; refs=${understanding.references.map(r => `${r.phrase}->${r.resolvedTo ?? '?'}`).join(',') || 'none'}`, 'COMPLETED')
  record(ledger, COORDINATOR_ACTOR, 'coordinate',
    `route=${decision.route}; members=${decision.members.join(',') || 'none'}; ${decision.reasons.join('; ')}`, 'COMPLETED')

  let finalResponse: Stage1TurnResult['finalResponse'] = null
  if (understanding.recall && decision.route !== 'handoff') {
    const rc = answerRecall(understanding, trimmed)
    finalResponse = { text: rc.text, status: 'COMPLETED', claims: [], mode: 'stage1_recall' }
    record(ledger, deterministicActor('recall', 'Conversation record (deterministic)'), 'answer',
      `${rc.found} earlier member reply(ies) quoted; external research: none`, 'COMPLETED')
  } else if (decision.route === 'clarify' && understanding.clarification) {
    finalResponse = { text: understanding.clarification, status: 'WAITING', claims: [], mode: 'stage1_clarification' }
    record(ledger, deterministicActor('clarify', 'Clarification (deterministic)'), 'ask', understanding.clarification, 'WAITING')
  } else if (decision.route === 'self_knowledge' && isSelfKnowledgeQuestion(understanding)) {
    const ans = answerSelfKnowledge(understanding, state)
    finalResponse = { text: ans.text, status: 'COMPLETED', claims: ans.claims, mode: 'stage1_self_knowledge' }
    ledger.localKnowledge.push(...ans.claims.map(c => ({ claimId: c.id, source: c.source, status: c.status })))
    record(ledger, deterministicActor('war-room-knowledge', 'War Room knowledge (installed state + docs)'), 'answer',
      `${ans.claims.length} claims; tiers ${ans.tiersConsulted.join(',')}; external research: none`, 'COMPLETED')
  }

  if (!finalResponse && understanding.act === 'correction' && !understanding.correction?.replacement
      && understanding.normalized.split(' ').length <= 9) {
    const prev = understanding.correction?.supersedes
    const text = prev
      ? `Understood — I am setting aside my previous reading of “${prev.slice(0, 160)}”. What did you mean? A few words on the subject, or what you wanted instead, is enough.`
      : 'Understood. I have no earlier request in this session to correct. What did you mean?'
    finalResponse = { text, status: 'WAITING', claims: [], mode: 'stage1_clarification' }
    record(ledger, deterministicActor('correction', 'Correction handling (deterministic)'), 'ask', 'correction without replacement; asked for the intended meaning', 'WAITING')
  } else if (!finalResponse && understanding.continuation && input.priorTurns) {
    const cont = buildContinuationResponse(input.priorTurns)
    finalResponse = { text: cont.text, status: cont.status, claims: [], mode: 'stage1_clarification' }
    record(ledger, deterministicActor('continuation', 'Session recovery (persisted turn records)'), 'recover',
      `${input.priorTurns.length} persisted turn(s) read`, cont.status)
  }

  let effectiveText = input.text
  const notes: string[] = []
  for (const r of understanding.references) if (r.resolvedTo) notes.push(`"${r.phrase}" = ${r.resolvedTo}`)
  if (understanding.correction) {
    notes.push('this is a CORRECTION of the previous interpretation; do not defend the earlier reading')
    if (understanding.correction.replacement) notes.push(`Commander meant: ${understanding.correction.replacement}`)
  }
  if (understanding.continuation) notes.push('Commander asks to continue the earlier discussion')
  if (notes.length) effectiveText = `${input.text}\n[Stage1 context: ${notes.join('; ')}]`

  return { understanding, decision, finalResponse, effectiveText, provenance: { ...summarizeLedger(ledger), entries: ledger.entries } }
}
